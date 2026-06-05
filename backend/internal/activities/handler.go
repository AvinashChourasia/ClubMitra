package activities

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
	"github.com/avinash/virtual-run-tracker/backend/pkg/geo"
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
	// Static routes before the {id} param so "stats" isn't parsed as an id.
	r.Get("/stats", h.stats)
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

	act, err := h.svc.Record(r.Context(), userID, points, count)
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

// geojson returns the route as a GeoJSON geometry. PostGIS already produced a
// valid JSON string, so we write it through directly with the right content type
// rather than decoding and re-encoding it.
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

	geo, err := h.svc.RouteGeoJSON(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "activity not found")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/geo+json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(geo))
}
