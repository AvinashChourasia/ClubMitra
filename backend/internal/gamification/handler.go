package gamification

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// Handler exposes the gamification endpoints (mounted behind auth).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.profile)          // XP, level, full badge wall (+ awards lazily)
	r.Put("/announce", h.announce) // toggle club-chat badge announcements
	return r
}

func (h *Handler) profile(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	p, err := h.svc.Evaluate(r.Context(), userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

type announceRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *Handler) announce(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req announceRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.SetAnnounce(r.Context(), userID, req.Enabled); err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"enabled": req.Enabled})
}
