// Package races is the community race calendar: anyone lists a race, everyone
// browses upcoming ones by city and marks themselves going. Deliberately small —
// discovery map view / recommendations are later phases.
package races

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Race is one calendar entry, annotated for the requesting user.
type Race struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	City       string    `json:"city"`
	RaceDate   string    `json:"race_date"` // YYYY-MM-DD
	Distances  string    `json:"distances"`
	Location   *string   `json:"location,omitempty"`
	URL        *string   `json:"url,omitempty"`
	CreatedBy  *string   `json:"created_by,omitempty"`
	GoingCount int       `json:"going_count"`
	Going      bool      `json:"going"` // is the requester going?
}

// Repository + Service collapsed: the package is small enough that splitting
// them would be ceremony. Handler methods sit on the same type.
type Handler struct {
	db *pgxpool.Pool

	// MarathonMitra feed: races are submitted + approved over there and pulled
	// from its get-all-marathons API here. Empty sourceURL = local rows only.
	sourceURL string
	client    *http.Client
	syncMu    sync.Mutex
	lastSync  time.Time
}

// NewHandler wires the race calendar to the database pool and the (optional)
// MarathonMitra API.
func NewHandler(db *pgxpool.Pool, marathonMitraURL string) *Handler {
	return &Handler{
		db:        db,
		sourceURL: strings.TrimSpace(marathonMitraURL),
		client:    &http.Client{Timeout: 6 * time.Second},
	}
}

// mmRace tolerates the field-name variants a marathon feed is likely to use.
type mmRace struct {
	ID        any    `json:"id"`
	Title     string `json:"title"`
	Name      string `json:"name"`
	City      string `json:"city"`
	Date      string `json:"date"`
	RaceDate  string `json:"race_date"`
	Distances string `json:"distances"`
	Location  string `json:"location"`
	URL       string `json:"url"`
	Link      string `json:"link"`
}

func (m mmRace) title() string {
	if m.Title != "" {
		return m.Title
	}
	return m.Name
}
func (m mmRace) date() string {
	if m.RaceDate != "" {
		return m.RaceDate
	}
	return m.Date
}
func (m mmRace) link() string {
	if m.URL != "" {
		return m.URL
	}
	return m.Link
}

// syncFromMarathonMitra pulls the feed and upserts by external_id. Throttled to
// once per 10 minutes and always best-effort: a dead feed must never take the
// calendar down — stale rows keep serving.
func (h *Handler) syncFromMarathonMitra(ctx context.Context) {
	if h.sourceURL == "" {
		return
	}
	h.syncMu.Lock()
	if time.Since(h.lastSync) < 10*time.Minute {
		h.syncMu.Unlock()
		return
	}
	h.lastSync = time.Now()
	h.syncMu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.sourceURL, nil)
	if err != nil {
		return
	}
	resp, err := h.client.Do(req)
	if err != nil {
		log.Printf("races: marathonmitra fetch failed: %v", err)
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("races: marathonmitra fetch status=%d err=%v", resp.StatusCode, err)
		return
	}

	// Accept a bare array or an object wrapping it ({"races":[…]} / {"data":[…]}).
	var list []mmRace
	if err := json.Unmarshal(raw, &list); err != nil {
		var wrapped struct {
			Races []mmRace `json:"races"`
			Data  []mmRace `json:"data"`
		}
		if err := json.Unmarshal(raw, &wrapped); err != nil {
			log.Printf("races: marathonmitra feed didn't parse: %v", err)
			return
		}
		list = wrapped.Races
		if len(list) == 0 {
			list = wrapped.Data
		}
	}

	for _, m := range list {
		extID := strings.TrimSpace(fmt.Sprint(m.ID))
		title := strings.TrimSpace(m.title())
		city := strings.TrimSpace(m.City)
		d, err := time.Parse("2006-01-02", strings.TrimSpace(m.date()))
		if extID == "" || extID == "<nil>" || title == "" || city == "" || err != nil {
			continue // skip rows we can't represent
		}
		_, err = h.db.Exec(ctx, `
			INSERT INTO races (external_id, title, city, race_date, distances, location, url)
			VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''))
			ON CONFLICT (external_id) DO UPDATE SET
				title = EXCLUDED.title, city = EXCLUDED.city, race_date = EXCLUDED.race_date,
				distances = EXCLUDED.distances, location = EXCLUDED.location, url = EXCLUDED.url,
				deleted_at = NULL`,
			extID, title, city, d, strings.TrimSpace(m.Distances), strings.TrimSpace(m.Location), strings.TrimSpace(m.link()))
		if err != nil {
			log.Printf("races: upsert %q failed: %v", title, err)
		}
	}
}

// Routes returns the /races sub-router (mounted behind auth).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.list)    // ?city= (upcoming only)
	r.Post("/", h.create) // anyone can list a race
	r.Route("/{raceID}", func(r chi.Router) {
		r.Post("/interest", h.toggleInterest) // I'm going / not going
		r.Delete("/", h.remove)               // creator only
	})
	return r
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	h.syncFromMarathonMitra(r.Context()) // refresh from MarathonMitra (throttled, best-effort)
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	const q = `
		SELECT rc.id, rc.title, rc.city, rc.race_date::text, rc.distances, rc.location, rc.url, rc.created_by,
		       (SELECT count(*) FROM race_interests ri WHERE ri.race_id = rc.id)::int,
		       EXISTS (SELECT 1 FROM race_interests ri WHERE ri.race_id = rc.id AND ri.user_id = $1)
		FROM races rc
		WHERE rc.deleted_at IS NULL
		  AND rc.race_date >= CURRENT_DATE
		  AND ($2 = '' OR lower(rc.city) = lower($2))
		ORDER BY rc.race_date ASC
		LIMIT 100`
	rows, err := h.db.Query(r.Context(), q, userID, city)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	defer rows.Close()
	out := make([]Race, 0)
	for rows.Next() {
		var rc Race
		if err := rows.Scan(&rc.ID, &rc.Title, &rc.City, &rc.RaceDate, &rc.Distances, &rc.Location, &rc.URL,
			&rc.CreatedBy, &rc.GoingCount, &rc.Going); err != nil {
			httpx.InternalError(w, err)
			return
		}
		// race_date::text comes back as "2026-08-15" already; keep date-only.
		if len(rc.RaceDate) > 10 {
			rc.RaceDate = rc.RaceDate[:10]
		}
		out = append(out, rc)
	}
	if err := rows.Err(); err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type createRequest struct {
	Title     string  `json:"title"`
	City      string  `json:"city"`
	RaceDate  string  `json:"race_date"` // YYYY-MM-DD
	Distances string  `json:"distances"`
	Location  *string `json:"location"`
	URL       *string `json:"url"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.City = strings.TrimSpace(req.City)
	if req.Title == "" || req.City == "" {
		httpx.Error(w, http.StatusBadRequest, "title and city are required")
		return
	}
	d, err := time.Parse("2006-01-02", strings.TrimSpace(req.RaceDate))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "race_date must be YYYY-MM-DD")
		return
	}
	if d.Before(time.Now().AddDate(0, 0, -1)) {
		httpx.Error(w, http.StatusBadRequest, "the race date is in the past")
		return
	}

	var rc Race
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO races (title, city, race_date, distances, location, url, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, title, city, race_date::text, distances, location, url, created_by`,
		req.Title, req.City, d, strings.TrimSpace(req.Distances), req.Location, req.URL, userID).
		Scan(&rc.ID, &rc.Title, &rc.City, &rc.RaceDate, &rc.Distances, &rc.Location, &rc.URL, &rc.CreatedBy)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	if len(rc.RaceDate) > 10 {
		rc.RaceDate = rc.RaceDate[:10]
	}
	httpx.JSON(w, http.StatusCreated, rc)
}

// toggleInterest flips the caller's "I'm going" and returns the new state.
func (h *Handler) toggleInterest(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	raceID, err := uuid.Parse(chi.URLParam(r, "raceID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid race id")
		return
	}
	// Confirm the race exists (and is live) before writing interest.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM races WHERE id = $1 AND deleted_at IS NULL)`, raceID).Scan(&exists); err != nil {
		httpx.InternalError(w, err)
		return
	}
	if !exists {
		httpx.Error(w, http.StatusNotFound, "race not found")
		return
	}

	tag, err := h.db.Exec(r.Context(),
		`DELETE FROM race_interests WHERE race_id = $1 AND user_id = $2`, raceID, userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	going := false
	if tag.RowsAffected() == 0 { // wasn't going — now they are
		if _, err := h.db.Exec(r.Context(),
			`INSERT INTO race_interests (race_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, raceID, userID); err != nil {
			httpx.InternalError(w, err)
			return
		}
		going = true
	}
	var count int
	_ = h.db.QueryRow(r.Context(), `SELECT count(*) FROM race_interests WHERE race_id = $1`, raceID).Scan(&count)
	httpx.JSON(w, http.StatusOK, map[string]any{"going": going, "going_count": count})
}

// remove soft-deletes a race the caller created.
func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	raceID, err := uuid.Parse(chi.URLParam(r, "raceID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid race id")
		return
	}
	tag, err := h.db.Exec(r.Context(),
		`UPDATE races SET deleted_at = now() WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL`, raceID, userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "race not found")
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}
