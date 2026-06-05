package challenges

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
)

// Handler exposes the challenge endpoints. Mounted behind the auth middleware,
// so a verified user id is always in the request context.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler to the service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Routes returns the /challenges sub-router.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.list)            // browse all (or ?joined=true for mine)
	r.Post("/", h.create)
	r.Get("/{id}", h.get)
	r.Post("/{id}/join", h.join)
	r.Get("/{id}/leaderboard", h.leaderboard)
	return r
}

func parseID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid challenge id")
		return uuid.Nil, false
	}
	return id, true
}

// --- request shapes ---

type createRequest struct {
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	TargetDistanceM float64   `json:"target_distance_m"`
	StartsAt        time.Time `json:"starts_at"`
	EndsAt          time.Time `json:"ends_at"`
}

// --- handlers ---

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
	ch, err := h.svc.Create(r.Context(), NewChallenge{
		CreatorID:       userID,
		Name:            req.Name,
		Description:     req.Description,
		TargetDistanceM: req.TargetDistanceM,
		StartsAt:        req.StartsAt,
		EndsAt:          req.EndsAt,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, ch)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	joinedOnly := r.URL.Query().Get("joined") == "true"
	list, err := h.svc.List(r.Context(), userID, joinedOnly)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
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
	ch, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	ch, err := h.svc.Join(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

func (h *Handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := httpx.UserIDFromContext(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := h.svc.Leaderboard(r.Context(), id, limit)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, entries)
}

// writeErr maps domain errors to HTTP statuses, consistent with the other
// handlers.
func writeErr(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "challenge not found")
	default:
		httpx.InternalError(w, err)
	}
}
