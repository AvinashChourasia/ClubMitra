package users

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
)

// Handler exposes user endpoints over HTTP. Like the auth handler, it only
// translates between HTTP and the repository — no business logic lives here.
type Handler struct {
	repo *Repository
}

// NewHandler wires the handler to the user repository.
func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// Routes returns the /users sub-router. It's mounted behind the auth middleware
// in main, so every handler here can assume a verified user is in the context.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/me", h.me)
	return r
}

// me returns the currently authenticated user's profile.
//
// We return the users.User struct directly: its PasswordHash field is tagged
// json:"-", so it can never be serialized into the response.
func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		// Should be impossible behind RequireAuth, but never trust that a
		// middleware ran — defend the endpoint on its own.
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	user, err := h.repo.GetByID(r.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// The token is valid but the user row is gone (e.g. deleted account).
			httpx.Error(w, http.StatusNotFound, "user not found")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, user)
}
