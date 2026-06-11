package messaging

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// ErrForbidden is returned when a caller isn't a member of the chapter whose
// chat they're trying to read or post to.
var ErrForbidden = errors.New("forbidden")

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// notifier fans an announcement out as push. Narrow interface over the
// notifications package so messaging doesn't depend on its concrete type.
type notifier interface {
	NotifyChapterMembers(ctx context.Context, chapterID uuid.UUID, exclude, title, body string, data map[string]string)
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// adminChecker reports whether a user holds an admin role for a chapter (used to
// gate announcements). Satisfied by *permissions.Checker.
type adminChecker interface {
	HasChapterRole(ctx context.Context, userID string, chapterID uuid.UUID, allowed ...string) (bool, error)
}

// Publisher pushes realtime events to connected users (the websocket hub).
// Narrow interface so messaging doesn't depend on the hub's concrete type.
type Publisher interface {
	Publish(userIDs []string, event any)
}

// RTEvent is what the client receives over the websocket. For DMs, ID is the
// PEER's user id from each receiver's perspective (their thread key).
type RTEvent struct {
	Type    string   `json:"type"`  // "message" | "update" | "typing"
	Scope   string   `json:"scope"` // "chapter" | "dm"
	ID      string   `json:"id"`
	UserID  string   `json:"user_id,omitempty"` // who triggered it (typing)
	Name    string   `json:"name,omitempty"`    // their display name (typing)
	Payload *Message `json:"payload,omitempty"` // the new message, when Type=="message"
}

// Service holds messaging logic: access control, conversation bootstrap, and the
// announcement broadcast.
type Service struct {
	repo   *Repository
	check  adminChecker
	notify notifier
	rt     Publisher

	// Push throttle: at most one chat push per conversation+recipient per
	// window, so a burst of 30 messages buzzes once, not 30 times. In-memory is
	// fine — a restart just means one extra buzz.
	pushMu   sync.Mutex
	lastPush map[string]time.Time
}

// NewService wires the service together.
func NewService(repo *Repository, check adminChecker, notify notifier) *Service {
	return &Service{repo: repo, check: check, notify: notify, lastPush: make(map[string]time.Time)}
}

// SetRealtime registers the websocket hub (optional — nil means poll-only).
func (s *Service) SetRealtime(p Publisher) { s.rt = p }

// fanout pushes an event to everyone in a conversation. Chapter events fan to
// all chapter members under the chapter id; direct events go to both ends, each
// keyed by THEIR peer's id. Best-effort: realtime is a bonus, never an error.
func (s *Service) fanout(ctx context.Context, convType string, chapterID *uuid.UUID, convID uuid.UUID, evType string, payload *Message) {
	if s.rt == nil {
		return
	}
	switch {
	case convType == "chapter" && chapterID != nil:
		ids, err := s.repo.ListChapterMemberIDs(ctx, *chapterID)
		if err != nil {
			return
		}
		s.rt.Publish(ids, RTEvent{Type: evType, Scope: "chapter", ID: chapterID.String(), Payload: payload})
	case convType == "direct":
		ids, err := s.repo.directMemberIDs(ctx, convID)
		if err != nil || len(ids) != 2 {
			return
		}
		s.rt.Publish([]string{ids[0]}, RTEvent{Type: evType, Scope: "dm", ID: ids[1], Payload: payload})
		s.rt.Publish([]string{ids[1]}, RTEvent{Type: evType, Scope: "dm", ID: ids[0], Payload: payload})
	}
}

// RelayTyping forwards a typing signal to the conversation's other members.
// Membership is enforced for chapters; DM typing goes only to the named peer.
func (s *Service) RelayTyping(ctx context.Context, senderID, scope, id string) {
	if s.rt == nil {
		return
	}
	sender, err := s.repo.getUser(ctx, senderID)
	if err != nil {
		return
	}
	switch scope {
	case "chapter":
		cid, err := uuid.Parse(id)
		if err != nil {
			return
		}
		if ok, err := s.repo.IsChapterMember(ctx, cid, senderID); err != nil || !ok {
			return
		}
		ids, err := s.repo.ListChapterMemberIDs(ctx, cid)
		if err != nil {
			return
		}
		out := make([]string, 0, len(ids))
		for _, u := range ids {
			if u != senderID {
				out = append(out, u)
			}
		}
		s.rt.Publish(out, RTEvent{Type: "typing", Scope: "chapter", ID: id, UserID: senderID, Name: sender.Name})
	case "dm":
		// id = the peer being typed to; their thread key for us is the sender.
		s.rt.Publish([]string{id}, RTEvent{Type: "typing", Scope: "dm", ID: senderID, UserID: senderID, Name: sender.Name})
	}
}

const pushThrottleWindow = 25 * time.Second

// throttledRecipients filters out recipients pushed for this conversation
// within the window, and stamps the survivors.
func (s *Service) throttledRecipients(convID uuid.UUID, ids []string) []string {
	now := time.Now()
	s.pushMu.Lock()
	defer s.pushMu.Unlock()
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		key := convID.String() + ":" + id
		if now.Sub(s.lastPush[key]) < pushThrottleWindow {
			continue
		}
		s.lastPush[key] = now
		out = append(out, id)
	}
	// Opportunistic sweep so the map doesn't grow forever.
	if len(s.lastPush) > 4096 {
		for k, t := range s.lastPush {
			if now.Sub(t) > pushThrottleWindow {
				delete(s.lastPush, k)
			}
		}
	}
	return out
}

// pushMessage sends the device push for a new chat message: muted users and
// the sender are skipped, bursts are throttled per recipient, and the payload
// deep-links straight into the right thread. Best-effort — chat must never
// fail because push did.
func (s *Service) pushMessage(ctx context.Context, convType string, chapterID *uuid.UUID, convID uuid.UUID, msg *Message) {
	if s.notify == nil || msg.IsAnnouncement { // announcements already push
		return
	}
	preview := deref(preview(msg.Body, msg.MediaType))
	if preview == "" {
		preview = "New message"
	}
	muted, err := s.repo.mutedUserIDs(ctx, convID)
	if err != nil {
		muted = map[string]bool{}
	}

	switch {
	case convType == "chapter" && chapterID != nil:
		name, err := s.repo.chapterName(ctx, *chapterID)
		if err != nil || name == "" {
			name = "Club chat"
		}
		ids, err := s.repo.ListChapterMemberIDs(ctx, *chapterID)
		if err != nil {
			return
		}
		recipients := make([]string, 0, len(ids))
		for _, id := range ids {
			if id != msg.SenderID && !muted[id] {
				recipients = append(recipients, id)
			}
		}
		recipients = s.throttledRecipients(convID, recipients)
		if len(recipients) == 0 {
			return
		}
		s.notify.NotifyUsers(ctx, recipients, name, msg.SenderName+": "+preview, map[string]string{
			"type": "chat_message", "scope": "chapter", "id": chapterID.String(),
		})
	case convType == "direct":
		ids, err := s.repo.directMemberIDs(ctx, convID)
		if err != nil || len(ids) != 2 {
			return
		}
		other := ids[0]
		if other == msg.SenderID {
			other = ids[1]
		}
		if muted[other] {
			return
		}
		if len(s.throttledRecipients(convID, []string{other})) == 0 {
			return
		}
		// The receiver's thread key for this DM is the sender's id.
		s.notify.NotifyUsers(ctx, []string{other}, msg.SenderName, preview, map[string]string{
			"type": "chat_message", "scope": "dm", "id": msg.SenderID,
		})
	}
}

// requireMember returns ErrForbidden unless the user can access the chapter's chat.
func (s *Service) requireMember(ctx context.Context, chapterID uuid.UUID, userID string) error {
	ok, err := s.repo.IsChapterMember(ctx, chapterID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// ChapterMessages lists a chapter chat (creating it on first use) and marks it read.
func (s *Service) ChapterMessages(ctx context.Context, userID string, chapterID uuid.UUID) ([]Message, error) {
	if err := s.requireMember(ctx, chapterID, userID); err != nil {
		return nil, err
	}
	convID, err := s.repo.ensureChapterConversation(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	msgs, err := s.repo.listMessages(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.markRead(ctx, convID, userID) // best-effort
	return msgs, nil
}

// PostChapter posts a message to a chapter chat (optionally quoting another).
func (s *Service) PostChapter(ctx context.Context, userID string, chapterID uuid.UUID, body, mediaURL, mediaType *string, replyToID *uuid.UUID) (*Message, error) {
	if err := s.requireMember(ctx, chapterID, userID); err != nil {
		return nil, err
	}
	if err := validateContent(body, mediaURL); err != nil {
		return nil, err
	}
	convID, err := s.repo.ensureChapterConversation(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	msg, err := s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false, replyToID)
	if err != nil {
		return nil, err
	}
	s.fanout(ctx, "chapter", &chapterID, convID, "message", msg)
	s.pushMessage(ctx, "chapter", &chapterID, convID, msg)
	return msg, nil
}

// Announce posts an announcement to a chapter chat and pushes it to all members.
// Admin-only (org / chapter / co-admin per the permission table).
func (s *Service) Announce(ctx context.Context, userID string, chapterID uuid.UUID, body string) (*Message, error) {
	ok, err := s.check.HasChapterRole(ctx, userID, chapterID,
		permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrForbidden
	}
	if strings.TrimSpace(body) == "" {
		return nil, ValidationError{Msg: "an announcement needs a message"}
	}
	convID, err := s.repo.ensureChapterConversation(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	msg, err := s.repo.postMessage(ctx, convID, userID, &body, nil, nil, true, nil)
	if err != nil {
		return nil, err
	}
	s.fanout(ctx, "chapter", &chapterID, convID, "message", msg)
	if s.notify != nil {
		s.notify.NotifyChapterMembers(ctx, chapterID, userID, "📣 Club announcement", body,
			map[string]string{"type": "announcement", "chapter_id": chapterID.String()})
	}
	return msg, nil
}

// RunMessages lists a run's event chat (member-gated via the run's chapter).
func (s *Service) RunMessages(ctx context.Context, userID string, runID uuid.UUID) ([]Message, error) {
	chapterID, err := s.repo.RunChapter(ctx, runID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMember(ctx, chapterID, userID); err != nil {
		return nil, err
	}
	convID, err := s.repo.ensureRunConversation(ctx, chapterID, runID)
	if err != nil {
		return nil, err
	}
	msgs, err := s.repo.listMessages(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.markRead(ctx, convID, userID)
	return msgs, nil
}

// PostRun posts a message to a run's event chat.
func (s *Service) PostRun(ctx context.Context, userID string, runID uuid.UUID, body, mediaURL, mediaType *string) (*Message, error) {
	chapterID, err := s.repo.RunChapter(ctx, runID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMember(ctx, chapterID, userID); err != nil {
		return nil, err
	}
	if err := validateContent(body, mediaURL); err != nil {
		return nil, err
	}
	convID, err := s.repo.ensureRunConversation(ctx, chapterID, runID)
	if err != nil {
		return nil, err
	}
	return s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false, nil)
}

// DirectThread bundles the other participant + messages for the DM screen.
// OtherLastReadAt powers read receipts: a message you sent is "read" once its
// created_at is at or before this timestamp.
type DirectThread struct {
	Other           OtherUser  `json:"other"`
	Messages        []Message  `json:"messages"`
	OtherLastReadAt *time.Time `json:"other_last_read_at,omitempty"`
}

// Inbox returns the user's chat list — club groups + direct chats — most recent
// first (chats with no messages yet sort to the bottom).
func (s *Service) Inbox(ctx context.Context, userID string) ([]InboxItem, error) {
	clubs, err := s.repo.clubInbox(ctx, userID)
	if err != nil {
		return nil, err
	}
	directs, err := s.repo.directInbox(ctx, userID)
	if err != nil {
		return nil, err
	}
	items := append(clubs, directs...)
	sort.SliceStable(items, func(i, j int) bool {
		ai, aj := items[i].LastAt, items[j].LastAt
		if (ai == nil) != (aj == nil) {
			return ai != nil // ones with messages come first
		}
		if ai == nil {
			return false
		}
		return ai.After(*aj) // most recent first
	})
	return items, nil
}

// DirectThread opens (or starts) a 1:1 chat with another user and returns it.
func (s *Service) DirectThread(ctx context.Context, userID, otherID string) (*DirectThread, error) {
	if otherID == userID {
		return nil, ValidationError{Msg: "you can't message yourself"}
	}
	other, err := s.repo.getUser(ctx, otherID)
	if err != nil {
		return nil, err
	}
	// Don't create the conversation just for viewing — it's created on first send,
	// so we never litter inboxes with empty chats. No conversation yet = no messages.
	convID, found, err := s.repo.findDirect(ctx, userID, otherID)
	if err != nil {
		return nil, err
	}
	if !found {
		return &DirectThread{Other: *other, Messages: []Message{}}, nil
	}
	msgs, err := s.repo.listMessages(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	otherRead, err := s.repo.lastReadAt(ctx, convID, otherID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.markRead(ctx, convID, userID)
	return &DirectThread{Other: *other, Messages: msgs, OtherLastReadAt: otherRead}, nil
}

// PostDirect posts a message to the 1:1 chat with another user.
func (s *Service) PostDirect(ctx context.Context, userID, otherID string, body, mediaURL, mediaType *string, replyToID *uuid.UUID) (*Message, error) {
	if otherID == userID {
		return nil, ValidationError{Msg: "you can't message yourself"}
	}
	if _, err := s.repo.getUser(ctx, otherID); err != nil {
		return nil, err
	}
	if err := validateContent(body, mediaURL); err != nil {
		return nil, err
	}
	convID, err := s.repo.findOrCreateDirect(ctx, userID, otherID)
	if err != nil {
		return nil, err
	}
	msg, err := s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false, replyToID)
	if err != nil {
		return nil, err
	}
	s.fanout(ctx, "direct", nil, convID, "message", msg)
	s.pushMessage(ctx, "direct", nil, convID, msg)
	return msg, nil
}

// DeleteMessage soft-deletes a message the caller sent (WhatsApp "delete for
// everyone"). Non-owners / missing messages get ErrNotFound.
func (s *Service) DeleteMessage(ctx context.Context, userID string, messageID uuid.UUID) error {
	return s.repo.softDeleteMessage(ctx, messageID, userID)
}

// EditMessage rewrites the caller's own message text and nudges the
// conversation so other clients refresh (and shows them the "edited" label).
func (s *Service) EditMessage(ctx context.Context, userID string, messageID uuid.UUID, body string) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return ValidationError{Msg: "message can't be empty"}
	}
	if err := s.repo.editMessage(ctx, messageID, userID, body); err != nil {
		return err
	}
	convID, convType, chapterID, err := s.repo.messageConversation(ctx, messageID)
	if err == nil {
		s.fanout(ctx, convType, chapterID, convID, "update", nil)
	}
	return nil
}

// MessageInfo returns sender-only read receipts for one message.
func (s *Service) MessageInfo(ctx context.Context, userID string, messageID uuid.UUID) (*MessageInfo, error) {
	return s.repo.messageInfo(ctx, messageID, userID)
}

// SetReaction sets (or clears, with an empty emoji) the caller's reaction on a
// message they can see, then nudges the conversation so other clients refresh.
func (s *Service) SetReaction(ctx context.Context, userID string, messageID uuid.UUID, emoji string) error {
	emoji = strings.TrimSpace(emoji)
	if len([]rune(emoji)) > 8 {
		return ValidationError{Msg: "that reaction is too long"}
	}
	convID, convType, chapterID, err := s.repo.messageConversation(ctx, messageID)
	if err != nil {
		return err
	}
	// Access: chapter chats require membership; direct chats require being a party.
	switch convType {
	case "chapter", "event":
		if chapterID == nil {
			return ErrNotFound
		}
		if err := s.requireMember(ctx, *chapterID, userID); err != nil {
			return err
		}
	case "direct":
		ok, err := s.repo.isDirectMember(ctx, convID, userID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
	}
	if err := s.repo.setReaction(ctx, messageID, userID, emoji); err != nil {
		return err
	}
	s.fanout(ctx, convType, chapterID, convID, "update", nil)
	return nil
}

// SetPrefs sets the caller's mute/archive flags for a conversation. kind is
// "club" (id = chapter id) or "direct" (id = the other user's id). Nil flags
// are left unchanged.
func (s *Service) SetPrefs(ctx context.Context, userID, kind, id string, muted, archived *bool) error {
	switch kind {
	case "club":
		chapterID, err := uuid.Parse(id)
		if err != nil {
			return ValidationError{Msg: "invalid club id"}
		}
		if err := s.requireMember(ctx, chapterID, userID); err != nil {
			return err
		}
		convID, err := s.repo.ensureChapterConversation(ctx, chapterID)
		if err != nil {
			return err
		}
		return s.repo.setPrefs(ctx, convID, userID, muted, archived)
	case "direct":
		convID, found, err := s.repo.findDirect(ctx, userID, id)
		if err != nil {
			return err
		}
		if !found {
			return ValidationError{Msg: "no conversation with this user yet"}
		}
		return s.repo.setPrefs(ctx, convID, userID, muted, archived)
	default:
		return ValidationError{Msg: "kind must be club or direct"}
	}
}

// validateContent requires a message to carry text or media.
func validateContent(body, mediaURL *string) error {
	hasBody := body != nil && strings.TrimSpace(*body) != ""
	hasMedia := mediaURL != nil && strings.TrimSpace(*mediaURL) != ""
	if !hasBody && !hasMedia {
		return ValidationError{Msg: "message can't be empty"}
	}
	return nil
}
