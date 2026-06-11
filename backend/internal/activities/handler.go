package activities

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/pkg/geo"
)

// Handler exposes the activity endpoints. Like the others, it only translates
// between HTTP and the service. It's mounted behind the auth middleware, so a
// verified user id is always in the context.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler to the service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Routes returns the /activities sub-router.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/", h.create)
	r.Get("/", h.list)
	// Static routes before the {id} param so they aren't parsed as an id.
	r.Get("/stats", h.stats)
	r.Get("/city-leaderboard", h.cityLeaderboard)
	r.Get("/feed/{chapterID}", h.chapterFeed) // club activity feed (members only)
	r.Post("/import-gpx", h.importGPX)        // watch exports (Garmin/Polar/Suunto)
	// chi captures the {id} path segment; read it with chi.URLParam.
	r.Get("/{id}", h.get)
	r.Get("/{id}/geojson", h.geojson)
	return r
}

// parseID pulls the {id} path param and parses it as a UUID, writing a 400 and
// returning ok=false on a malformed id so handlers can just return.
func parseID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid activity id")
		return uuid.Nil, false
	}
	return id, true
}

// --- request shapes ---

// pointInput is one GPS sample as the mobile app sends it. We accept lat/lng in
// human order here (the API's contract); the geo package handles the PostGIS
// lng-first conversion internally.
type pointInput struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Altitude  float64   `json:"altitude"`
	Timestamp time.Time `json:"timestamp"` // RFC 3339, e.g. "2026-06-01T10:00:00Z"
}

type createRequest struct {
	Points []pointInput `json:"points"`
	// Pointer so we can tell "omitted" (older clients / queued runs) from an
	// explicit false. Omitted defaults to true: count toward challenges.
	CountTowardChallenges *bool `json:"count_toward_challenges"`
	// Auto-paused seconds the client detected; subtracted from duration so the
	// stored time/pace reflect MOVING time. Omitted (older clients) → 0.
	PausedS *float64 `json:"paused_s"`
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

	// Translate the API's point shape into the geo domain type.
	points := make([]geo.Point, len(req.Points))
	for i, p := range req.Points {
		points[i] = geo.Point{Lat: p.Lat, Lng: p.Lng, Altitude: p.Altitude, Timestamp: p.Timestamp}
	}

	// Default to counting toward challenges unless the client explicitly opts out.
	count := req.CountTowardChallenges == nil || *req.CountTowardChallenges

	var pausedS float64
	if req.PausedS != nil && *req.PausedS > 0 {
		pausedS = *req.PausedS
	}

	act, err := h.svc.Record(r.Context(), userID, points, count, pausedS)
	if err != nil {
		var ve ValidationError
		if errors.As(err, &ve) {
			httpx.Error(w, http.StatusBadRequest, ve.Msg)
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, act)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	// Optional ?limit= & ?offset= query params; invalid values fall back to
	// defaults inside the service.
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	acts, err := h.svc.List(r.Context(), userID, limit, offset)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, acts)
}

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	s, err := h.svc.Stats(r.Context(), userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, s)
}

// cityLeaderboard ranks GPS-verified runners in a city. ?period=week|month|all
// (default week); ?city= overrides the requester's own city.
func (h *Handler) cityLeaderboard(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	period := r.URL.Query().Get("period")
	city := r.URL.Query().Get("city")
	view, err := h.svc.CityLeaderboard(r.Context(), userID, city, period)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, view)
}

// gpxFile mirrors the GPX track structure we care about: every <trkpt> in
// every segment of every track, in document order.
type gpxFile struct {
	Tracks []struct {
		Segments []struct {
			Points []struct {
				Lat  float64    `xml:"lat,attr"`
				Lon  float64    `xml:"lon,attr"`
				Ele  float64    `xml:"ele"`
				Time *time.Time `xml:"time"`
			} `xml:"trkpt"`
		} `xml:"trkseg"`
	} `xml:"trk"`
}

// importGPX accepts a GPX file (multipart field "file") from a watch export and
// records it through the exact same pipeline as a live run — PostGIS distance,
// pace, route, challenge + leaderboard credit.
func (h *Handler) importGPX(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil { // 16MB cap
		httpx.Error(w, http.StatusBadRequest, "couldn't read the upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "attach the GPX as the \"file\" field")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 16<<20))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "couldn't read the upload")
		return
	}

	var gpx gpxFile
	if err := xml.Unmarshal(raw, &gpx); err != nil {
		httpx.Error(w, http.StatusBadRequest, "that doesn't look like a valid GPX file")
		return
	}
	points := make([]geo.Point, 0, 1024)
	missingTime := 0
	for _, trk := range gpx.Tracks {
		for _, seg := range trk.Segments {
			for _, pt := range seg.Points {
				if pt.Time == nil || pt.Time.IsZero() {
					missingTime++
					continue
				}
				points = append(points, geo.Point{Lat: pt.Lat, Lng: pt.Lon, Altitude: pt.Ele, Timestamp: pt.Time.UTC()})
			}
		}
	}
	if len(points) < 2 {
		msg := "this GPX has no track points"
		if missingTime > 0 {
			msg = "this GPX has no timestamps — export it with time data"
		}
		httpx.Error(w, http.StatusBadRequest, msg)
		return
	}
	// Some exporters interleave segments oddly; sort defensively by time.
	sort.Slice(points, func(i, j int) bool { return points[i].Timestamp.Before(points[j].Timestamp) })

	act, err := h.svc.Record(r.Context(), userID, points, true, 0)
	if err != nil {
		var ve ValidationError
		if errors.As(err, &ve) {
			httpx.Error(w, http.StatusBadRequest, ve.Msg)
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, act)
}

// chapterFeed lists a club's recent member runs for the club page Feed tab.
func (h *Handler) chapterFeed(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, err := uuid.Parse(chi.URLParam(r, "chapterID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter id")
		return
	}
	feed, err := h.svc.ChapterFeed(r.Context(), userID, chapterID)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			httpx.Error(w, http.StatusForbidden, "you're not a member of this club")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, feed)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	act, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "activity not found")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, act)
}

// geojson returns the route as a GeoJSON geometry plus per-vertex pace data.
// PostGIS already produced a valid GeoJSON geometry string; we embed it as raw
// JSON (no decode/re-encode) under "geometry" and attach the seconds-from-start
// offsets so the client can colour the route by pace.
func (h *Handler) geojson(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	geometry, offsets, err := h.svc.RouteWithMeta(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "activity not found")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, routeResponse{
		Geometry: json.RawMessage(geometry),
		OffsetsS: offsets,
	})
}

// routeResponse is the route endpoint's body: the GeoJSON geometry plus the
// per-vertex seconds-from-start offsets (null for runs recorded before offsets
// were stored).
type routeResponse struct {
	Geometry json.RawMessage `json:"geometry"`
	OffsetsS []float64       `json:"offsets_s"`
}
