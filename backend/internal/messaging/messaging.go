// Package messaging is the club's in-app chat: a group conversation per chapter
// and an event conversation per run. Members read + post; admins can broadcast
// announcements (also pushed). Delivery is pull-on-open — clients fetch on entry
// and on refresh; there are no websockets yet.
package messaging

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a referenced run/conversation doesn't exist.
var ErrNotFound = errors.New("not found")

// InboxItem is one row in a user's chat list: a club group or a direct chat,
// with the last message for a preview. Sorted by recency client-side/service.
type InboxItem struct {
	Kind        string  `json:"kind"` // "club" | "direct"
	ChapterID   *string `json:"chapter_id,omitempty"`
	UserID      *string `json:"user_id,omitempty"` // the other person, for direct
	Title       string  `json:"title"`
	PhotoURL    *string `json:"photo_url,omitempty"`
	LastMessage *string `json:"last_message,omitempty"`
	LastAt      *string `json:"last_at,omitempty"`
	Unread      int     `json:"unread"`
}

// OtherUser is the counterpart in a direct chat (for the DM screen header).
type OtherUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Photo *string `json:"profile_photo,omitempty"`
}

// Message is one chat message, joined with the sender's name for display.
type Message struct {
	ID             uuid.UUID `json:"id"`
	SenderID       string    `json:"sender_id"`
	SenderName     string    `json:"sender_name"`
	Body           *string   `json:"body,omitempty"`
	MediaURL       *string   `json:"media_url,omitempty"`
	MediaType      *string   `json:"media_type,omitempty"`
	IsAnnouncement bool      `json:"is_announcement"`
	IsPinned       bool      `json:"is_pinned"`
	CreatedAt      string    `json:"created_at"`
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
// renders bottom-up). Capped at 100 — pagination can come later.
func (r *Repository) listMessages(ctx context.Context, conversationID uuid.UUID) ([]Message, error) {
	const q = `
		SELECT m.id, m.sender_id, u.name, m.body, m.media_url, m.media_type,
		       m.is_announcement, m.is_pinned, m.created_at::text
		FROM messages m JOIN users u ON u.id = m.sender_id
		WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.created_at DESC
		LIMIT 100`
	rows, err := r.db.Query(ctx, q, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Message, 0)
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SenderID, &m.SenderName, &m.Body, &m.MediaURL, &m.MediaType,
			&m.IsAnnouncement, &m.IsPinned, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	// Reverse to chronological order for the client.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// postMessage inserts a message and returns it (joined with the sender name).
func (r *Repository) postMessage(ctx context.Context, conversationID uuid.UUID, senderID string, body, mediaURL, mediaType *string, isAnnouncement bool) (*Message, error) {
	const q = `
		WITH ins AS (
			INSERT INTO messages (conversation_id, sender_id, body, media_url, media_type, is_announcement)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, sender_id, body, media_url, media_type, is_announcement, is_pinned, created_at
		)
		SELECT ins.id, ins.sender_id, u.name, ins.body, ins.media_url, ins.media_type,
		       ins.is_announcement, ins.is_pinned, ins.created_at::text
		FROM ins JOIN users u ON u.id = ins.sender_id`
	var m Message
	err := r.db.QueryRow(ctx, q, conversationID, senderID, body, mediaURL, mediaType, isAnnouncement).Scan(
		&m.ID, &m.SenderID, &m.SenderName, &m.Body, &m.MediaURL, &m.MediaType,
		&m.IsAnnouncement, &m.IsPinned, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &m, nil
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
		SELECT c.id::text, c.name, c.logo, lm.body, lm.media_type, lm.created_at::text,
		       COALESCE((SELECT count(*) FROM messages msg
		         WHERE msg.conversation_id = conv.id AND msg.deleted_at IS NULL AND msg.sender_id <> $1
		           AND msg.created_at > COALESCE(
		             (SELECT last_read_at FROM message_reads WHERE conversation_id = conv.id AND user_id = $1),
		             'epoch')), 0) AS unread
		FROM chapters c
		JOIN chapter_members m ON m.chapter_id = c.id AND m.user_id = $1 AND m.deleted_at IS NULL
		LEFT JOIN conversations conv ON conv.chapter_id = c.id AND conv.type = 'chapter'
		LEFT JOIN LATERAL (
			SELECT body, media_type, created_at FROM messages
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
		if err := rows.Scan(&chapterID, &it.Title, &it.PhotoURL, &it.LastMessage, &mediaType, &it.LastAt, &it.Unread); err != nil {
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
		SELECT other.id, other.name, other.profile_photo, lm.body, lm.media_type, lm.created_at::text,
		       COALESCE((SELECT count(*) FROM messages msg
		         WHERE msg.conversation_id = conv.id AND msg.deleted_at IS NULL AND msg.sender_id <> $1
		           AND msg.created_at > COALESCE(
		             (SELECT last_read_at FROM message_reads WHERE conversation_id = conv.id AND user_id = $1),
		             'epoch')), 0) AS unread
		FROM conversations conv
		JOIN conversation_members me ON me.conversation_id = conv.id AND me.user_id = $1
		JOIN conversation_members ot ON ot.conversation_id = conv.id AND ot.user_id <> $1
		JOIN users other ON other.id = ot.user_id
		LEFT JOIN LATERAL (
			SELECT body, media_type, created_at FROM messages
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
		if err := rows.Scan(&otherID, &it.Title, &it.PhotoURL, &it.LastMessage, &mediaType, &it.LastAt, &it.Unread); err != nil {
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
		}
		return &label
	}
	return nil
}

// lastReadAt returns when a user last read a conversation (nil = never), used to
// derive read receipts for the other party's view.
func (r *Repository) lastReadAt(ctx context.Context, conversationID uuid.UUID, userID string) (*string, error) {
	var ts *string
	err := r.db.QueryRow(ctx,
		`SELECT last_read_at::text FROM message_reads WHERE conversation_id = $1 AND user_id = $2`,
		conversationID, userID).Scan(&ts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return ts, err
}

// markRead upserts the caller's read marker for a conversation.
func (r *Repository) markRead(ctx context.Context, conversationID uuid.UUID, userID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO message_reads (user_id, conversation_id, last_read_at) VALUES ($1, $2, now())
		 ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_at = now()`,
		userID, conversationID)
	return err
}
