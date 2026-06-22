package analytics

import (
	"net/http"
	"strconv"

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
		r.Get("/inactive", h.inactive)
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

// inactive returns the list of members quiet for ≥ ?days (default 14, max 365).
func (h *Handler) inactive(w http.ResponseWriter, r *http.Request) {
	id, ok := chapterID(w, r)
	if !ok {
		return
	}
	days := 14
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 365 {
			days = n
		}
	}
	list, err := h.repo.InactiveMembers(r.Context(), id, days)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
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
