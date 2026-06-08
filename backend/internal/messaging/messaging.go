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

// markRead upserts the caller's read marker for a conversation.
func (r *Repository) markRead(ctx context.Context, conversationID uuid.UUID, userID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO message_reads (user_id, conversation_id, last_read_at) VALUES ($1, $2, now())
		 ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_at = now()`,
		userID, conversationID)
	return err
}
