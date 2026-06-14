// Package messaging is the club's in-app chat: a group conversation per chapter
// and an event conversation per run. Members read + post; admins can broadcast
// announcements (also pushed). Delivery is realtime-first (the websocket hub
// pushes new messages/typing) with pull-on-open as the fallback.
package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a referenced run/conversation doesn't exist.
var ErrNotFound = errors.New("not found")

// InboxItem is one row in a user's chat list: a club group or a direct chat,
// with the last message for a preview. Sorted by recency client-side/service.
type InboxItem struct {
	Kind         string     `json:"kind"` // "club" | "direct"
	ChapterID    *string    `json:"chapter_id,omitempty"`
	UserID       *string    `json:"user_id,omitempty"` // the other person, for direct
	Title        string     `json:"title"`
	PhotoURL     *string    `json:"photo_url,omitempty"`
	LastMessage  *string    `json:"last_message,omitempty"`
	LastSenderID *string    `json:"last_sender_id,omitempty"` // who sent it ("You: " prefix client-side)
	LastAt       *time.Time `json:"last_at,omitempty"`
	Unread       int        `json:"unread"`
	Muted        bool       `json:"muted"`
	Archived     bool       `json:"archived"`
}

// OtherUser is the counterpart in a direct chat (for the DM screen header).
type OtherUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Photo *string `json:"profile_photo,omitempty"`
}

// ReplyRef is the quoted message shown above a reply (a compact preview, not
// the full message — enough to render the WhatsApp-style quote block).
type ReplyRef struct {
	ID         uuid.UUID `json:"id"`
	SenderName string    `json:"sender_name"`
	Preview    string    `json:"preview"`
}

// Reaction is one emoji's aggregate on a message (count + whether it's mine).
type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

// Poll hangs off a kind="poll" message: the question, its options with live
// tallies, whether multiple choices are allowed, and the distinct voter count.
type Poll struct {
	Question   string       `json:"question"`
	Multi      bool         `json:"multi"`
	TotalVotes int          `json:"total_votes"` // distinct voters (for % bars)
	Options    []PollOption `json:"options"`
}

// PollOption is one choice on a poll, with its vote count and whether the
// viewer picked it.
type PollOption struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Votes int    `json:"votes"`
	Mine  bool   `json:"mine"`
}

// Message is one chat message, joined with the sender's name for display.
// Kind: "user" = a normal message; "badge" = an automatic achievement
// announcement the client renders as a centered system chip.
type Message struct {
	ID             uuid.UUID  `json:"id"`
	SenderID       string     `json:"sender_id"`
	SenderName     string     `json:"sender_name"`
	Kind           string     `json:"kind"`
	Body           *string    `json:"body,omitempty"`
	MediaURL       *string    `json:"media_url,omitempty"`
	MediaType      *string    `json:"media_type,omitempty"`
	IsAnnouncement bool       `json:"is_announcement"`
	IsPinned       bool       `json:"is_pinned"`
	ReplyTo        *ReplyRef  `json:"reply_to,omitempty"`
	Reactions      []Reaction `json:"reactions,omitempty"`
	Poll           *Poll      `json:"poll,omitempty"` // set when Kind == "poll"
	EditedAt       *time.Time `json:"edited_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Repository is the messaging data-access layer.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// IsChapterMember reports whether a user may access a chapter's chat: they hold
// a (non-deleted) membership OR an admin role scoping the chapter.
func (r *Repository) IsChapterMember(ctx context.Context, chapterID uuid.UUID, userID string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM chapter_members m
			WHERE m.chapter_id = $1 AND m.user_id = $2 AND m.deleted_at IS NULL
		) OR EXISTS (
			SELECT 1 FROM org_roles r JOIN chapters c ON c.id = $1
			WHERE r.user_id = $2 AND r.deleted_at IS NULL
			  AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id))
		)`
	var ok bool
	err := r.db.QueryRow(ctx, q, chapterID, userID).Scan(&ok)
	return ok, err
}

// RunChapter returns the chapter a run belongs to (for event-chat access checks).
func (r *Repository) RunChapter(ctx context.Context, runID uuid.UUID) (uuid.UUID, error) {
	var cid uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT chapter_id FROM runs WHERE id = $1 AND deleted_at IS NULL`, runID).Scan(&cid)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return cid, err
}

// ensureConversation returns the conversation id for a context, creating it on
// first use. selectQ finds an existing row; insertQ creates one. The unique
// indexes make a concurrent create a no-op, so we re-select after insert.
func (r *Repository) ensureChapterConversation(ctx context.Context, chapterID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT id FROM conversations WHERE chapter_id = $1 AND type = 'chapter'`, chapterID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	_, _ = r.db.Exec(ctx, `INSERT INTO conversations (chapter_id, type) VALUES ($1, 'chapter') ON CONFLICT DO NOTHING`, chapterID)
	err = r.db.QueryRow(ctx, `SELECT id FROM conversations WHERE chapter_id = $1 AND type = 'chapter'`, chapterID).Scan(&id)
	return id, err
}

func (r *Repository) ensureRunConversation(ctx context.Context, chapterID, runID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT id FROM conversations WHERE run_id = $1`, runID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	_, _ = r.db.Exec(ctx, `INSERT INTO conversations (chapter_id, run_id, type) VALUES ($1, $2, 'event') ON CONFLICT DO NOTHING`, chapterID, runID)
	err = r.db.QueryRow(ctx, `SELECT id FROM conversations WHERE run_id = $1`, runID).Scan(&id)
	return id, err
}

// listMessages returns a conversation's recent messages, oldest-last (the client
// renders bottom-up), each carrying its reply preview and aggregated reactions
// (with the viewer's own reaction flagged). Capped at 100 — pagination later.
func (r *Repository) listMessages(ctx context.Context, conversationID uuid.UUID, viewerID string) ([]Message, error) {
	const q = `
		SELECT m.id, m.sender_id, u.name, m.kind, m.body, m.media_url, m.media_type,
		       m.is_announcement, m.is_pinned, m.edited_at, m.created_at,
		       rm.id, ru.name, rm.body, rm.media_type,
		       COALESCE(rx.agg, '[]'::json)::text
		FROM messages m
		JOIN users u ON u.id = m.sender_id
		LEFT JOIN messages rm ON rm.id = m.reply_to_id
		LEFT JOIN users ru ON ru.id = rm.sender_id
		LEFT JOIN LATERAL (
			SELECT json_agg(json_build_object('emoji', t.emoji, 'count', t.cnt, 'mine', t.mine) ORDER BY t.cnt DESC) AS agg
			FROM (
				SELECT emoji, count(*)::int AS cnt, bool_or(user_id = $2) AS mine
				FROM message_reactions WHERE message_id = m.id GROUP BY emoji
			) t
		) rx ON true
		WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.created_at DESC
		LIMIT 100`
	rows, err := r.db.Query(ctx, q, conversationID, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Message, 0)
	for rows.Next() {
		var m Message
		var rID *uuid.UUID
		var rName, rBody, rMedia *string
		var reactionsJSON string
		if err := rows.Scan(&m.ID, &m.SenderID, &m.SenderName, &m.Kind, &m.Body, &m.MediaURL, &m.MediaType,
			&m.IsAnnouncement, &m.IsPinned, &m.EditedAt, &m.CreatedAt,
			&rID, &rName, &rBody, &rMedia, &reactionsJSON); err != nil {
			return nil, err
		}
		if rID != nil {
			m.ReplyTo = &ReplyRef{ID: *rID, SenderName: deref(rName), Preview: deref(preview(rBody, rMedia))}
		}
		if reactionsJSON != "" && reactionsJSON != "[]" {
			_ = json.Unmarshal([]byte(reactionsJSON), &m.Reactions)
		}
		out = append(out, m)
	}
	// Reverse to chronological order for the client.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.loadPolls(ctx, out, viewerID); err != nil {
		return nil, err
	}
	return out, nil
}

// createPoll writes a poll + its options for a freshly-posted poll message.
func (r *Repository) createPoll(ctx context.Context, messageID uuid.UUID, question string, options []string, multi bool) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO polls (message_id, question, multi) VALUES ($1, $2, $3)`, messageID, question, multi); err != nil {
		return err
	}
	for i, opt := range options {
		if _, err := tx.Exec(ctx, `INSERT INTO poll_options (message_id, idx, text) VALUES ($1, $2, $3)`, messageID, i, opt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// loadPolls attaches poll data (options, live tallies, the viewer's picks) to
// every kind="poll" message in msgs, in place. One query for polls, one for
// options — no N+1.
func (r *Repository) loadPolls(ctx context.Context, msgs []Message, viewerID string) error {
	ids := make([]uuid.UUID, 0)
	at := make(map[uuid.UUID]int)
	for i := range msgs {
		if msgs[i].Kind == "poll" {
			ids = append(ids, msgs[i].ID)
			at[msgs[i].ID] = i
		}
	}
	if len(ids) == 0 {
		return nil
	}

	// Poll headers + distinct voter counts.
	prows, err := r.db.Query(ctx, `
		SELECT p.message_id, p.question, p.multi,
		       (SELECT count(DISTINCT v.user_id) FROM poll_votes v WHERE v.message_id = p.message_id)::int
		FROM polls p WHERE p.message_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	polls := make(map[uuid.UUID]*Poll)
	for prows.Next() {
		var mid uuid.UUID
		var p Poll
		if err := prows.Scan(&mid, &p.Question, &p.Multi, &p.TotalVotes); err != nil {
			prows.Close()
			return err
		}
		p.Options = []PollOption{}
		polls[mid] = &p
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return err
	}

	// Options with per-option counts + whether the viewer chose them.
	orows, err := r.db.Query(ctx, `
		SELECT po.message_id, po.id::text, po.text,
		       (SELECT count(*) FROM poll_votes v WHERE v.option_id = po.id)::int,
		       EXISTS (SELECT 1 FROM poll_votes v WHERE v.option_id = po.id AND v.user_id = $2)
		FROM poll_options po
		WHERE po.message_id = ANY($1)
		ORDER BY po.message_id, po.idx`, ids, viewerID)
	if err != nil {
		return err
	}
	defer orows.Close()
	for orows.Next() {
		var mid uuid.UUID
		var o PollOption
		if err := orows.Scan(&mid, &o.ID, &o.Text, &o.Votes, &o.Mine); err != nil {
			return err
		}
		if p := polls[mid]; p != nil {
			p.Options = append(p.Options, o)
		}
	}
	if err := orows.Err(); err != nil {
		return err
	}

	for mid, p := range polls {
		msgs[at[mid]].Poll = p
	}
	return nil
}

// votePoll records the caller's vote. Single-choice polls keep one option per
// voter (re-tapping the same option clears it; a different option replaces it);
// multi-choice polls toggle each option independently.
func (r *Repository) votePoll(ctx context.Context, messageID, optionID uuid.UUID, userID string) error {
	var multi bool
	err := r.db.QueryRow(ctx, `
		SELECT p.multi FROM polls p
		JOIN poll_options po ON po.message_id = p.message_id
		WHERE p.message_id = $1 AND po.id = $2`, messageID, optionID).Scan(&multi)
	if errors.Is(err, pgx.ErrNoRows) {
		return ValidationError{Msg: "poll option not found"}
	}
	if err != nil {
		return err
	}

	if multi {
		tag, err := r.db.Exec(ctx, `DELETE FROM poll_votes WHERE option_id = $1 AND user_id = $2`, optionID, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			return nil // toggled off
		}
		_, err = r.db.Exec(ctx, `INSERT INTO poll_votes (option_id, message_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, optionID, messageID, userID)
		return err
	}

	// Single-choice: clear the voter's prior pick, then set the new one unless
	// they tapped the option they already had (toggle off).
	var had bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM poll_votes WHERE option_id = $1 AND user_id = $2)`, optionID, userID).Scan(&had); err != nil {
		return err
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM poll_votes WHERE message_id = $1 AND user_id = $2`, messageID, userID); err != nil {
		return err
	}
	if !had {
		if _, err := tx.Exec(ctx, `INSERT INTO poll_votes (option_id, message_id, user_id) VALUES ($1, $2, $3)`, optionID, messageID, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// postMessage inserts a message and returns it (joined with the sender name).
// replyToID is kept only when it points at a message in the SAME conversation —
// anything else is silently dropped rather than trusted. kind is "user" for
// normal messages, "badge" for automatic achievement announcements.
func (r *Repository) postMessage(ctx context.Context, conversationID uuid.UUID, senderID string, body, mediaURL, mediaType *string, isAnnouncement bool, replyToID *uuid.UUID, kind string) (*Message, error) {
	const q = `
		WITH ins AS (
			INSERT INTO messages (conversation_id, sender_id, kind, body, media_url, media_type, is_announcement, reply_to_id)
			VALUES ($1, $2, $8, $3, $4, $5, $6,
			        (SELECT id FROM messages WHERE id = $7 AND conversation_id = $1 AND deleted_at IS NULL))
			RETURNING id, sender_id, kind, body, media_url, media_type, is_announcement, is_pinned, reply_to_id, created_at
		)
		SELECT ins.id, ins.sender_id, u.name, ins.kind, ins.body, ins.media_url, ins.media_type,
		       ins.is_announcement, ins.is_pinned, ins.created_at,
		       rm.id, ru.name, rm.body, rm.media_type
		FROM ins
		JOIN users u ON u.id = ins.sender_id
		LEFT JOIN messages rm ON rm.id = ins.reply_to_id
		LEFT JOIN users ru ON ru.id = rm.sender_id`
	var m Message
	var rID *uuid.UUID
	var rName, rBody, rMedia *string
	err := r.db.QueryRow(ctx, q, conversationID, senderID, body, mediaURL, mediaType, isAnnouncement, replyToID, kind).Scan(
		&m.ID, &m.SenderID, &m.SenderName, &m.Kind, &m.Body, &m.MediaURL, &m.MediaType,
		&m.IsAnnouncement, &m.IsPinned, &m.CreatedAt,
		&rID, &rName, &rBody, &rMedia)
	if err != nil {
		return nil, err
	}
	if rID != nil {
		m.ReplyTo = &ReplyRef{ID: *rID, SenderName: deref(rName), Preview: deref(preview(rBody, rMedia))}
	}
	return &m, nil
}

// userChapterIDs returns the chapters where the user holds a live membership —
// the rooms a badge announcement lands in.
func (r *Repository) userChapterIDs(ctx context.Context, userID string) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx,
		`SELECT chapter_id FROM chapter_members WHERE user_id = $1 AND deleted_at IS NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// editMessage rewrites the text of a message the sender owns (media stays).
// Returns ErrNotFound when the message isn't theirs / is deleted.
func (r *Repository) editMessage(ctx context.Context, messageID uuid.UUID, userID, body string) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE messages SET body = $3, edited_at = now()
		WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL`,
		messageID, userID, body)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// setReaction upserts the viewer's single reaction on a message (one per user,
// re-reacting replaces it); an empty emoji removes it.
func (r *Repository) setReaction(ctx context.Context, messageID uuid.UUID, userID, emoji string) error {
	if emoji == "" {
		_, err := r.db.Exec(ctx, `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`, messageID, userID)
		return err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
		ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
		messageID, userID, emoji)
	return err
}

// messageConversation resolves a message to its conversation (for access checks
// and realtime fan-out). Returns the conversation id, type, and scope ids.
func (r *Repository) messageConversation(ctx context.Context, messageID uuid.UUID) (convID uuid.UUID, convType string, chapterID *uuid.UUID, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT c.id, c.type, c.chapter_id
		FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id = $1 AND m.deleted_at IS NULL`, messageID).Scan(&convID, &convType, &chapterID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

// setPrefs upserts the viewer's mute/archive flags for a conversation. Nil
// fields are left unchanged.
func (r *Repository) setPrefs(ctx context.Context, conversationID uuid.UUID, userID string, muted, archived *bool) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO conversation_prefs (conversation_id, user_id, muted, archived)
		VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE))
		ON CONFLICT (conversation_id, user_id) DO UPDATE SET
			muted    = COALESCE($3, conversation_prefs.muted),
			archived = COALESCE($4, conversation_prefs.archived),
			updated_at = now()`,
		conversationID, userID, muted, archived)
	return err
}

// Reader is one person who has read a message (per-message info).
type Reader struct {
	UserID string     `json:"user_id"`
	Name   string     `json:"name"`
	Photo  *string    `json:"profile_photo,omitempty"`
	ReadAt time.Time  `json:"read_at"`
}

// MessageInfo is the sender-facing "message info" view: when it was sent, how
// many people it addressed, and who has read it (conversation-level reads at or
// after the message's timestamp).
type MessageInfo struct {
	SentAt     time.Time `json:"sent_at"`
	Recipients int       `json:"recipients"`
	Readers    []Reader  `json:"readers"`
}

// messageInfo computes read receipts for one message. Only the sender may ask —
// anyone else gets ErrNotFound (no leaking message existence).
func (r *Repository) messageInfo(ctx context.Context, messageID uuid.UUID, requesterID string) (*MessageInfo, error) {
	var convID uuid.UUID
	var senderID, convType string
	var chapterID *uuid.UUID
	var createdAt time.Time
	err := r.db.QueryRow(ctx, `
		SELECT m.conversation_id, m.sender_id, m.created_at, c.type, c.chapter_id
		FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id = $1 AND m.deleted_at IS NULL`, messageID).
		Scan(&convID, &senderID, &createdAt, &convType, &chapterID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if senderID != requesterID {
		return nil, ErrNotFound
	}

	info := &MessageInfo{SentAt: createdAt, Readers: make([]Reader, 0)}

	// How many people the message addressed (everyone but the sender).
	if convType == "chapter" || convType == "event" {
		if chapterID != nil {
			_ = r.db.QueryRow(ctx, `
				SELECT count(*) FROM chapter_members
				WHERE chapter_id = $1 AND deleted_at IS NULL AND user_id <> $2`,
				*chapterID, senderID).Scan(&info.Recipients)
		}
	} else {
		info.Recipients = 1
	}

	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.name, u.profile_photo, mr.last_read_at
		FROM message_reads mr JOIN users u ON u.id = mr.user_id
		WHERE mr.conversation_id = $1 AND mr.user_id <> $2 AND mr.last_read_at >= $3
		ORDER BY mr.last_read_at DESC
		LIMIT 100`, convID, senderID, createdAt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var rd Reader
		if err := rows.Scan(&rd.UserID, &rd.Name, &rd.Photo, &rd.ReadAt); err != nil {
			return nil, err
		}
		info.Readers = append(info.Readers, rd)
	}
	return info, rows.Err()
}

// mutedUserIDs returns users who muted a conversation (no pushes for them).
func (r *Repository) mutedUserIDs(ctx context.Context, conversationID uuid.UUID) (map[string]bool, error) {
	rows, err := r.db.Query(ctx, `SELECT user_id FROM conversation_prefs WHERE conversation_id = $1 AND muted`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// chapterName resolves a chapter's display name (push titles).
func (r *Repository) chapterName(ctx context.Context, chapterID uuid.UUID) (string, error) {
	var name string
	err := r.db.QueryRow(ctx, `SELECT name FROM chapters WHERE id = $1`, chapterID).Scan(&name)
	return name, err
}

// directMemberIDs returns both participants of a direct conversation.
func (r *Repository) directMemberIDs(ctx context.Context, conversationID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT user_id FROM conversation_members WHERE conversation_id = $1`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0, 2)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListChapterMemberIDs returns the user ids in a chapter's chat (active
// membership), for realtime fan-out.
func (r *Repository) ListChapterMemberIDs(ctx context.Context, chapterID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT user_id FROM chapter_members
		WHERE chapter_id = $1 AND deleted_at IS NULL`, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// getUser fetches a user's display fields for a DM header. ErrNotFound if gone.
func (r *Repository) getUser(ctx context.Context, userID string) (*OtherUser, error) {
	var u OtherUser
	err := r.db.QueryRow(ctx,
		`SELECT id, name, profile_photo FROM users WHERE id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&u.ID, &u.Name, &u.Photo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// findDirect locates the direct conversation between two users without creating
// one. found=false (id=Nil) means they've never messaged.
func (r *Repository) findDirect(ctx context.Context, a, b string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	const find = `
		SELECT c.id FROM conversations c
		WHERE c.type = 'direct'
		  AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = $1)
		  AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = $2)
		LIMIT 1`
	err := r.db.QueryRow(ctx, find, a, b).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

// findOrCreateDirect returns the direct conversation between two users, creating
// it (with both members) on first use. Called when a message is actually sent,
// so we never litter inboxes with empty conversations.
func (r *Repository) findOrCreateDirect(ctx context.Context, a, b string) (uuid.UUID, error) {
	if id, found, err := r.findDirect(ctx, a, b); err != nil {
		return uuid.Nil, err
	} else if found {
		return id, nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO conversations (type) VALUES ('direct') RETURNING id`).Scan(&id); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
		id, a, b); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// isDirectMember reports whether a user is a participant of a direct conversation.
func (r *Repository) isDirectMember(ctx context.Context, conversationID uuid.UUID, userID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2)`,
		conversationID, userID).Scan(&ok)
	return ok, err
}

// clubInbox lists the user's club group chats (from their memberships), with the
// last message for a preview. Conversations are lazily created, so last_* are
// null until someone posts.
func (r *Repository) clubInbox(ctx context.Context, userID string) ([]InboxItem, error) {
	const q = `
		SELECT c.id::text, c.name, c.logo, lm.body, lm.media_type, lm.sender_id, lm.created_at,
		       COALESCE((SELECT count(*) FROM messages msg
		         WHERE msg.conversation_id = conv.id AND msg.deleted_at IS NULL AND msg.sender_id <> $1
		           AND msg.created_at > COALESCE(
		             (SELECT last_read_at FROM message_reads WHERE conversation_id = conv.id AND user_id = $1),
		             'epoch')), 0) AS unread,
		       COALESCE(p.muted, FALSE), COALESCE(p.archived, FALSE)
		FROM chapters c
		JOIN chapter_members m ON m.chapter_id = c.id AND m.user_id = $1 AND m.deleted_at IS NULL
		LEFT JOIN conversations conv ON conv.chapter_id = c.id AND conv.type = 'chapter'
		LEFT JOIN conversation_prefs p ON p.conversation_id = conv.id AND p.user_id = $1
		LEFT JOIN LATERAL (
			SELECT body, media_type, sender_id, created_at FROM messages
			WHERE conversation_id = conv.id AND deleted_at IS NULL
			ORDER BY created_at DESC LIMIT 1
		) lm ON true
		WHERE c.deleted_at IS NULL`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]InboxItem, 0)
	for rows.Next() {
		var it InboxItem
		var chapterID string
		var mediaType *string
		if err := rows.Scan(&chapterID, &it.Title, &it.PhotoURL, &it.LastMessage, &mediaType, &it.LastSenderID, &it.LastAt, &it.Unread, &it.Muted, &it.Archived); err != nil {
			return nil, err
		}
		it.Kind = "club"
		it.ChapterID = &chapterID
		it.LastMessage = preview(it.LastMessage, mediaType)
		out = append(out, it)
	}
	return out, rows.Err()
}

// directInbox lists the user's direct chats, titled by the other participant.
func (r *Repository) directInbox(ctx context.Context, userID string) ([]InboxItem, error) {
	const q = `
		SELECT other.id, other.name, other.profile_photo, lm.body, lm.media_type, lm.sender_id, lm.created_at,
		       COALESCE((SELECT count(*) FROM messages msg
		         WHERE msg.conversation_id = conv.id AND msg.deleted_at IS NULL AND msg.sender_id <> $1
		           AND msg.created_at > COALESCE(
		             (SELECT last_read_at FROM message_reads WHERE conversation_id = conv.id AND user_id = $1),
		             'epoch')), 0) AS unread,
		       COALESCE(p.muted, FALSE), COALESCE(p.archived, FALSE)
		FROM conversations conv
		JOIN conversation_members me ON me.conversation_id = conv.id AND me.user_id = $1
		JOIN conversation_members ot ON ot.conversation_id = conv.id AND ot.user_id <> $1
		JOIN users other ON other.id = ot.user_id
		LEFT JOIN conversation_prefs p ON p.conversation_id = conv.id AND p.user_id = $1
		LEFT JOIN LATERAL (
			SELECT body, media_type, sender_id, created_at FROM messages
			WHERE conversation_id = conv.id AND deleted_at IS NULL
			ORDER BY created_at DESC LIMIT 1
		) lm ON true
		WHERE conv.type = 'direct'`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]InboxItem, 0)
	for rows.Next() {
		var it InboxItem
		var otherID string
		var mediaType *string
		if err := rows.Scan(&otherID, &it.Title, &it.PhotoURL, &it.LastMessage, &mediaType, &it.LastSenderID, &it.LastAt, &it.Unread, &it.Muted, &it.Archived); err != nil {
			return nil, err
		}
		it.Kind = "direct"
		it.UserID = &otherID
		it.LastMessage = preview(it.LastMessage, mediaType)
		out = append(out, it)
	}
	return out, rows.Err()
}

// preview turns a stored message into a one-line inbox preview (media → a label).
func preview(body, mediaType *string) *string {
	if body != nil && *body != "" {
		return body
	}
	if mediaType != nil && *mediaType != "" {
		label := "📷 Photo"
		if *mediaType == "video" {
			label = "🎥 Video"
		} else if *mediaType == "file" {
			label = "📎 File"
		} else if *mediaType == "audio" {
			label = "🎤 Voice note"
		}
		return &label
	}
	return nil
}

// lastReadAt returns when a user last read a conversation (nil = never), used to
// derive read receipts for the other party's view.
func (r *Repository) lastReadAt(ctx context.Context, conversationID uuid.UUID, userID string) (*time.Time, error) {
	var ts *time.Time
	err := r.db.QueryRow(ctx,
		`SELECT last_read_at FROM message_reads WHERE conversation_id = $1 AND user_id = $2`,
		conversationID, userID).Scan(&ts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return ts, err
}

// softDeleteMessage marks a message deleted, but only if the caller sent it.
// Returns ErrNotFound if no such (own, live) message exists.
func (r *Repository) softDeleteMessage(ctx context.Context, messageID uuid.UUID, userID string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE messages SET deleted_at = now() WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL`,
		messageID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// markRead upserts the caller's read marker for a conversation.
func (r *Repository) markRead(ctx context.Context, conversationID uuid.UUID, userID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO message_reads (user_id, conversation_id, last_read_at) VALUES ($1, $2, now())
		 ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_at = now()`,
		userID, conversationID)
	return err
}
