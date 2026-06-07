// Package notifications stores device push tokens and sends push notifications
// via the Expo Push API. It's a leaf package: other packages (attendance,
// organisations, challenges) call its high-level Notify* methods to fan a domain
// event out to the right users' devices. Sends are best-effort and asynchronous
// — a notification failure must never affect the triggering request.
//
// NOTE: actual delivery needs a real build (Expo Go can't receive remote push
// on current SDKs). The token storage + send pipeline here is production-ready;
// it simply has no devices to deliver to until the app runs as a dev/prod build.
package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// expoPushURL is Expo's push service endpoint.
const expoPushURL = "https://exp.host/--/api/v2/push/send"

// Notifier stores tokens and sends pushes.
type Notifier struct {
	db   *pgxpool.Pool
	http *http.Client
}

// NewNotifier wires the notifier to the DB pool.
func NewNotifier(db *pgxpool.Pool) *Notifier {
	return &Notifier{db: db, http: &http.Client{Timeout: 10 * time.Second}}
}

// SaveToken upserts a device token for a user. ON CONFLICT re-points an existing
// token to the current user (e.g. a shared device).
func (n *Notifier) SaveToken(ctx context.Context, userID, token, platform string) error {
	const q = `
		INSERT INTO device_tokens (user_id, token, platform)
		VALUES ($1, $2, $3)
		ON CONFLICT (token) DO UPDATE
			SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`
	_, err := n.db.Exec(ctx, q, userID, token, platform)
	return err
}

// DeleteToken removes a token (on logout / unregister).
func (n *Notifier) DeleteToken(ctx context.Context, token string) error {
	_, err := n.db.Exec(ctx, `DELETE FROM device_tokens WHERE token = $1`, token)
	return err
}

// --- high-level Notify methods (async, best-effort) ---

// NotifyUsers pushes to the given users' devices.
func (n *Notifier) NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string) {
	if len(userIDs) == 0 {
		return
	}
	n.dispatch(title, body, data, `SELECT token FROM device_tokens WHERE user_id = ANY($1)`, userIDs)
}

// NotifyChapterMembers pushes to a chapter's ACTIVE members, optionally excluding
// one user (e.g. the actor who triggered the event).
func (n *Notifier) NotifyChapterMembers(ctx context.Context, chapterID uuid.UUID, exclude string, title, body string, data map[string]string) {
	const q = `
		SELECT dt.token FROM device_tokens dt
		JOIN chapter_members m ON m.user_id = dt.user_id
		WHERE m.chapter_id = $1 AND m.deleted_at IS NULL AND m.status = 'active' AND m.user_id <> $2`
	n.dispatch(title, body, data, q, chapterID, exclude)
}

// NotifyChapterAdmins pushes to the admins governing a chapter (chapter-scoped or
// org-wide roles).
func (n *Notifier) NotifyChapterAdmins(ctx context.Context, chapterID uuid.UUID, title, body string, data map[string]string) {
	const q = `
		SELECT dt.token FROM device_tokens dt
		WHERE dt.user_id IN (
			SELECT r.user_id FROM org_roles r
			JOIN chapters c ON c.id = $1
			WHERE r.deleted_at IS NULL
			  AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id)))`
	n.dispatch(title, body, data, q, chapterID)
}

// dispatch runs the token query and sends, all in a detached goroutine so the
// caller returns immediately.
func (n *Notifier) dispatch(title, body string, data map[string]string, query string, args ...any) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		tokens, err := n.tokens(ctx, query, args...)
		if err != nil {
			log.Printf("notifications: token query failed: %v", err)
			return
		}
		if err := n.send(ctx, tokens, title, body, data); err != nil {
			log.Printf("notifications: send failed: %v", err)
		}
	}()
}

func (n *Notifier) tokens(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := n.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// pushMessage is one Expo push payload.
type pushMessage struct {
	To    string            `json:"to"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Sound string            `json:"sound"`
	Data  map[string]string `json:"data,omitempty"`
}

// send posts the messages to Expo's push API, chunked to its 100-per-request
// limit. No-op when there are no tokens.
func (n *Notifier) send(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	for start := 0; start < len(tokens); start += 100 {
		end := start + 100
		if end > len(tokens) {
			end = len(tokens)
		}
		msgs := make([]pushMessage, 0, end-start)
		for _, t := range tokens[start:end] {
			msgs = append(msgs, pushMessage{To: t, Title: title, Body: body, Sound: "default", Data: data})
		}
		payload, err := json.Marshal(msgs)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushURL, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := n.http.Do(req)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()
	}
	return nil
}
