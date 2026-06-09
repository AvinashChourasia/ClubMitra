package messaging

import (
	"context"
	"errors"
	"sort"
	"strings"

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
}

// adminChecker reports whether a user holds an admin role for a chapter (used to
// gate announcements). Satisfied by *permissions.Checker.
type adminChecker interface {
	HasChapterRole(ctx context.Context, userID string, chapterID uuid.UUID, allowed ...string) (bool, error)
}

// Service holds messaging logic: access control, conversation bootstrap, and the
// announcement broadcast.
type Service struct {
	repo   *Repository
	check  adminChecker
	notify notifier
}

// NewService wires the service together.
func NewService(repo *Repository, check adminChecker, notify notifier) *Service {
	return &Service{repo: repo, check: check, notify: notify}
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
	msgs, err := s.repo.listMessages(ctx, convID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.markRead(ctx, convID, userID) // best-effort
	return msgs, nil
}

// PostChapter posts a message to a chapter chat.
func (s *Service) PostChapter(ctx context.Context, userID string, chapterID uuid.UUID, body, mediaURL, mediaType *string) (*Message, error) {
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
	return s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false)
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
	msg, err := s.repo.postMessage(ctx, convID, userID, &body, nil, nil, true)
	if err != nil {
		return nil, err
	}
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
	msgs, err := s.repo.listMessages(ctx, convID)
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
	return s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false)
}

// DirectThread bundles the other participant + messages for the DM screen.
// OtherLastReadAt powers read receipts: a message you sent is "read" once its
// created_at is at or before this timestamp.
type DirectThread struct {
	Other           OtherUser `json:"other"`
	Messages        []Message `json:"messages"`
	OtherLastReadAt *string   `json:"other_last_read_at,omitempty"`
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
		return *ai > *aj // ISO timestamps compare lexically
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
	msgs, err := s.repo.listMessages(ctx, convID)
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
func (s *Service) PostDirect(ctx context.Context, userID, otherID string, body, mediaURL, mediaType *string) (*Message, error) {
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
	return s.repo.postMessage(ctx, convID, userID, body, mediaURL, mediaType, false)
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
