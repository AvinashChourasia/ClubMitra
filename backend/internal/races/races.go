// Package races is the race calendar, fed by MarathonMitra's official public
// events API (api.marathonmitra.com — documented, no auth, JSON). A throttled
// background sync pulls all upcoming events and upserts them locally. Everyone
// browses upcoming races by city, marks themselves going, and taps through to
// the MarathonMitra event page for full details.
package races

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
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
	ImageURL   *string   `json:"image_url,omitempty"`
	Organizer  *string   `json:"organizer,omitempty"`
	CreatedBy  *string   `json:"created_by,omitempty"`
	GoingCount int       `json:"going_count"`
	Going      bool      `json:"going"` // is the requester going?
}

// Repository + Service collapsed: the package is small enough that splitting
// them would be ceremony. Handler methods sit on the same type.
type Handler struct {
	db *pgxpool.Pool

	// MarathonMitra base URL. Races are submitted + approved over there; we
	// pull the upcoming-events pages and parse their embedded JSON-LD.
	sourceURL string
	client    *http.Client
	syncMu    sync.Mutex
	lastSync  time.Time
	syncing   bool
}

// NewHandler wires the race calendar to the database pool and MarathonMitra's
// public events API. The env var (MARATHONMITRA_API_URL) overrides the base
// for testing; empty means production. A website host is normalised to the
// API host so a stale env value can't break the sync.
func NewHandler(db *pgxpool.Pool, marathonMitraURL string) *Handler {
	src := strings.TrimRight(strings.TrimSpace(marathonMitraURL), "/")
	src = strings.TrimSuffix(src, "/api")
	if src == "" || src == "https://marathonmitra.com" || src == "https://www.marathonmitra.com" {
		src = "https://api.marathonmitra.com"
	}
	return &Handler{
		db:        db,
		sourceURL: src,
		client:    &http.Client{Timeout: 12 * time.Second},
	}
}

// mmEvent is one event from GET /api/events (the documented public schema).
type mmEvent struct {
	Title        string    `json:"title"`
	Slug         string    `json:"slug"`
	CityName     string    `json:"cityName"`
	Date         string    `json:"date"` // ISO 8601
	Distances    []float64 `json:"distances"`
	DistanceUnit string    `json:"distanceUnit"` // "km" | "miles"
	Organizer    *string   `json:"organizer"`
	Venue        *string   `json:"venue"`
	ImageURL     *string   `json:"imageUrl"`
}

type mmEventsResponse struct {
	Success    bool      `json:"success"`
	Data       []mmEvent `json:"data"`
	Pagination struct {
		Limit int `json:"limit"`
		Skip  int `json:"skip"`
		Total int `json:"total"`
	} `json:"pagination"`
}

// fetchEvents pulls one page of upcoming events (limit/skip pagination).
func (h *Handler) fetchEvents(ctx context.Context, skip int) (*mmEventsResponse, error) {
	u := h.sourceURL + "/api/events?status=upcoming&limit=100&skip=" + strconv.Itoa(skip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ClubMitra/1.0 (race calendar sync)")
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("events api status %d", resp.StatusCode)
	}
	var out mmEventsResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, fmt.Errorf("events api success=false")
	}
	return &out, nil
}

// distancesLabel renders the API's numeric distances as runner-speak:
// [5 10 21.0975 42.195] km → "5K · 10K · Half Marathon · Marathon".
func distancesLabel(ds []float64, unit string) string {
	parts := make([]string, 0, len(ds))
	for _, d := range ds {
		switch {
		case unit == "miles":
			parts = append(parts, strconv.FormatFloat(d, 'f', -1, 64)+" mi")
		case d >= 21.0 && d <= 21.2:
			parts = append(parts, "Half Marathon")
		case d >= 42.1 && d <= 42.3:
			parts = append(parts, "Marathon")
		default:
			parts = append(parts, strconv.FormatFloat(d, 'f', -1, 64)+"K")
		}
	}
	return strings.Join(parts, " · ")
}

// syncFromMarathonMitra refreshes the calendar from the public events API —
// throttled to once per 10 minutes, and run in the BACKGROUND so a list
// request never waits on it. Best-effort by contract: a dead API must never
// take the calendar down; stale rows keep serving.
func (h *Handler) syncFromMarathonMitra() {
	if h.sourceURL == "" {
		return
	}
	h.syncMu.Lock()
	if h.syncing || time.Since(h.lastSync) < 10*time.Minute {
		h.syncMu.Unlock()
		return
	}
	h.lastSync = time.Now()
	h.syncing = true
	h.syncMu.Unlock()

	go func() {
		defer func() {
			h.syncMu.Lock()
			h.syncing = false
			h.syncMu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()

		total := 0
		for skip := 0; skip < 500; { // 500-event ceiling, far above today's ~110
			page, err := h.fetchEvents(ctx, skip)
			if err != nil {
				log.Printf("races: marathonmitra fetch (skip=%d) failed: %v", skip, err)
				break
			}
			if len(page.Data) == 0 {
				break
			}
			for _, e := range page.Data {
				h.upsertEvent(ctx, e)
			}
			total += len(page.Data)
			skip += len(page.Data)
			if skip >= page.Pagination.Total {
				break
			}
		}
		log.Printf("races: marathonmitra sync done, %d events", total)
	}()
}

// upsertEvent maps one API event onto the races table. The slug is the stable
// external id, so repeat syncs update in place and "I'm going" interest rows
// survive; it also builds the public event-page URL we hand the user to.
func (h *Handler) upsertEvent(ctx context.Context, e mmEvent) {
	title := strings.TrimSpace(e.Title)
	slug := strings.TrimSpace(e.Slug)
	if title == "" || slug == "" {
		return
	}
	var day time.Time
	if t, err := time.Parse(time.RFC3339, e.Date); err == nil {
		day = t
	} else if t, err := time.Parse("2006-01-02", e.Date); err == nil {
		day = t
	} else {
		return
	}
	city := strings.TrimSpace(e.CityName)
	if city == "" {
		city = "India"
	}
	venue := ""
	if e.Venue != nil {
		venue = strings.TrimSpace(*e.Venue)
	}
	organizer := ""
	if e.Organizer != nil {
		organizer = strings.TrimSpace(*e.Organizer)
	}
	imageURL := ""
	if e.ImageURL != nil {
		imageURL = strings.TrimSpace(*e.ImageURL)
	}

	if _, err := h.db.Exec(ctx, `
		INSERT INTO races (external_id, title, city, race_date, distances, location, url, image_url, organizer)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''), NULLIF($9, ''))
		ON CONFLICT (external_id) DO UPDATE SET
			title = EXCLUDED.title, city = EXCLUDED.city, race_date = EXCLUDED.race_date,
			distances = EXCLUDED.distances, location = EXCLUDED.location, url = EXCLUDED.url,
			image_url = EXCLUDED.image_url, organizer = EXCLUDED.organizer,
			deleted_at = NULL`,
		slug, title, city, day.Format("2006-01-02"), distancesLabel(e.Distances, e.DistanceUnit),
		venue, "https://marathonmitra.com/events/"+slug, imageURL, organizer); err != nil {
		log.Printf("races: upsert %q failed: %v", title, err)
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
	h.syncFromMarathonMitra() // refresh from MarathonMitra (throttled, background)
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	// City matching is prefix-tolerant both ways: a stored "Bengaluru Urban"
	// matches a profile city "Bengaluru", and vice versa.
	const q = `
		SELECT rc.id, rc.title, rc.city, rc.race_date::text, rc.distances, rc.location, rc.url,
		       rc.image_url, rc.organizer, rc.created_by,
		       (SELECT count(*) FROM race_interests ri WHERE ri.race_id = rc.id)::int,
		       EXISTS (SELECT 1 FROM race_interests ri WHERE ri.race_id = rc.id AND ri.user_id = $1)
		FROM races rc
		WHERE rc.deleted_at IS NULL
		  AND rc.race_date >= CURRENT_DATE
		  AND ($2 = '' OR lower(rc.city) LIKE lower($2) || '%' OR lower($2) LIKE lower(rc.city) || '%')
		ORDER BY rc.race_date ASC
		LIMIT 200`
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
			&rc.ImageURL, &rc.Organizer, &rc.CreatedBy, &rc.GoingCount, &rc.Going); err != nil {
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
