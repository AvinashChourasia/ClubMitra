package users

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/trust"
)

// trustReader exposes a user's trust standing for the profile endpoint. Kept as
// an interface so users depends on trust's behaviour, not its construction.
type trustReader interface {
	Snapshot(ctx context.Context, userID string) (trust.Snapshot, error)
}

// Handler exposes user endpoints over HTTP. Like the auth handler, it only
// translates between HTTP and the repository — no business logic lives here.
type Handler struct {
	repo  *Repository
	trust trustReader
}

// NewHandler wires the handler to the user repository and trust reader.
func NewHandler(repo *Repository, trustReader trustReader) *Handler {
	return &Handler{repo: repo, trust: trustReader}
}

// Routes returns the /users sub-router. It's mounted behind the auth middleware
// in main, so every handler here can assume a verified user is in the context.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/me", h.me)
	r.Put("/me", h.updateMe)
	r.Get("/me/trust-score", h.trustScore)
	return r
}

// trustScore returns the caller's trust score, tier, and the component rates.
func (h *Handler) trustScore(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	snap, err := h.trust.Snapshot(r.Context(), userID)
	if err != nil {
		if errors.Is(err, trust.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "user not found")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snap)
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

// updateProfileRequest is the editable profile (email + password are managed by
// auth, not here). Everything except t-shirt size is required.
type updateProfileRequest struct {
	Name         string  `json:"name"`
	Phone        string  `json:"phone"`
	Age          *int    `json:"age"`
	City         *string `json:"city"`
	TshirtSize   *string `json:"tshirt_size"`
	RunningLevel *string `json:"running_level"`
	ProfilePhoto *string `json:"profile_photo"` // Cloudinary URL; nil = unchanged
}

// updateMe edits the authenticated user's own profile.
func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req updateProfileRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	switch {
	case req.Name == "":
		httpx.Error(w, http.StatusBadRequest, "name is required")
		return
	case req.Phone == "":
		httpx.Error(w, http.StatusBadRequest, "phone is required")
		return
	case req.Age == nil || *req.Age <= 0:
		httpx.Error(w, http.StatusBadRequest, "a valid age is required")
		return
	case req.City == nil || strings.TrimSpace(*req.City) == "":
		httpx.Error(w, http.StatusBadRequest, "city is required")
		return
	case req.RunningLevel == nil || !ValidRunningLevels[*req.RunningLevel]:
		httpx.Error(w, http.StatusBadRequest, "running level must be one of beginner, amateur, intermediate, advanced")
		return
	}

	user, err := h.repo.UpdateProfile(r.Context(), userID, ProfileUpdate{
		Name:         req.Name,
		Phone:        req.Phone,
		Age:          req.Age,
		City:         req.City,
		TshirtSize:   req.TshirtSize,
		RunningLevel: req.RunningLevel,
		ProfilePhoto: req.ProfilePhoto,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Error(w, http.StatusNotFound, "user not found")
		case errors.Is(err, ErrPhoneTaken):
			httpx.Error(w, http.StatusConflict, "an account with this phone already exists")
		default:
			httpx.InternalError(w, err)
		}
		return
	}
	httpx.JSON(w, http.StatusOK, user)
}
