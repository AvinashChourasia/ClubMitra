package analytics

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// Handler exposes the chapter analytics endpoints, gated to chapter/org admins
// (co-admins and members can't see drop-off data — see the permission table).
type Handler struct {
	repo  *Repository
	check *permissions.Checker
}

// NewHandler wires the handler to its repository and permission checker.
func NewHandler(repo *Repository, check *permissions.Checker) *Handler {
	return &Handler{repo: repo, check: check}
}

// Routes mounts under /analytics with {chapterID} in the path so the permission
// checker (which reads that param) can gate every endpoint.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	admin := h.check.RequireChapterRole(permissions.RoleOrgAdmin, permissions.RoleChapterAdmin)
	r.Route("/{chapterID}", func(r chi.Router) {
		r.Use(admin)
		r.Get("/dropoff", h.dropoff)
		r.Get("/engagement", h.engagement)
		r.Get("/volume", h.volume)
	})
	return r
}

func (h *Handler) dropoff(w http.ResponseWriter, r *http.Request) {
	id, ok := chapterID(w, r)
	if !ok {
		return
	}
	d, err := h.repo.Dropoff(r.Context(), id)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) engagement(w http.ResponseWriter, r *http.Request) {
	id, ok := chapterID(w, r)
	if !ok {
		return
	}
	e, err := h.repo.Engagement(r.Context(), id)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, e)
}

func (h *Handler) volume(w http.ResponseWriter, r *http.Request) {
	id, ok := chapterID(w, r)
	if !ok {
		return
	}
	v, err := h.repo.Volume(r.Context(), id)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

func chapterID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "chapterID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter id")
		return uuid.Nil, false
	}
	return id, true
}
