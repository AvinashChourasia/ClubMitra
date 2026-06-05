package auth

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
	"github.com/avinash/virtual-run-tracker/backend/internal/users"
)

// Handler exposes the auth endpoints over HTTP. It only translates between HTTP
// and the service — no business logic lives here (that's the service's job).
type Handler struct {
	svc *Service
}

// NewHandler wires the handler to the auth service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Routes returns a router with all /auth endpoints mounted, ready to attach
// under /api/v1/auth in main.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	// No /register: accounts are created on MarathonMitra (the website), not here.
	r.Post("/login", h.login)
	r.Post("/refresh", h.refresh)
	r.Post("/logout", h.logout)
	return r
}

// --- request/response shapes ---

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// authResponse is returned on login: the tokens plus the (cached) user profile.
type authResponse struct {
	*TokenPair
	User *users.User `json:"user"`
}

// --- handlers ---

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	pair, user, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, authResponse{TokenPair: pair, User: user})
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	pair, err := h.svc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, pair)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.Logout(r.Context(), req.RefreshToken); err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

// writeAuthError maps domain errors to HTTP status codes. This is the ONE place
// that decides what the client sees for each failure, keeping it consistent.
func writeAuthError(w http.ResponseWriter, err error) {
	var validationErr ValidationError
	switch {
	case errors.As(err, &validationErr):
		httpx.Error(w, http.StatusBadRequest, validationErr.Msg)
	case errors.Is(err, ErrInvalidCredentials):
		httpx.Error(w, http.StatusUnauthorized, "invalid email or password")
	case errors.Is(err, ErrInvalidRefreshToken):
		httpx.Error(w, http.StatusUnauthorized, "invalid or expired refresh token")
	default:
		// Unexpected: log the real error, return a generic message (handled by
		// the shared helper so every handler behaves identically).
		httpx.InternalError(w, err)
	}
}
