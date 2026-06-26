package auth

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/email"
	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/users"
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
// under /api/v1/auth in main. ClubMitra owns identity now, so /register lives
// here (accounts are created in-app, not on an external platform).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/register", h.register)
	r.Post("/login", h.login)
	r.Post("/refresh", h.refresh)
	r.Post("/logout", h.logout)
	// Forgot-password: public (the user is locked out), so it sits behind the
	// same IP rate-limit as the rest of /auth. Dormant until email is configured.
	r.Post("/request-reset", h.requestReset)
	r.Post("/reset-password", h.resetPassword)
	return r
}

// ProtectedRoutes are account-management endpoints that REQUIRE a logged-in user.
// Mounted under /account (the public /auth path is already taken), behind the
// auth middleware in the composition root.
func (h *Handler) ProtectedRoutes() http.Handler {
	r := chi.NewRouter()
	r.Post("/change-password", h.changePassword)
	// Verified email change: request mails a code to the new address; confirm
	// applies it. Both require the current session (these live under /account).
	r.Post("/request-email-change", h.requestEmailChange)
	r.Post("/confirm-email-change", h.confirmEmailChange)
	return r
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req changePasswordRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.ChangePassword(r.Context(), userID, req.OldPassword, req.NewPassword); err != nil {
		// A wrong CURRENT password is ErrInvalidCredentials — give a precise
		// message here rather than the generic login one.
		if errors.Is(err, ErrInvalidCredentials) {
			httpx.Error(w, http.StatusBadRequest, "your current password is incorrect")
			return
		}
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

type requestResetRequest struct {
	Email string `json:"email"`
}

func (h *Handler) requestReset(w http.ResponseWriter, r *http.Request) {
	var req requestResetRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.RequestPasswordReset(r.Context(), req.Email); err != nil {
		writeAuthError(w, err)
		return
	}
	// 204 regardless of whether the email matched an account — non-enumerating.
	httpx.JSON(w, http.StatusNoContent, nil)
}

type resetPasswordRequest struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

func (h *Handler) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.ResetPassword(r.Context(), req.Email, req.Code, req.NewPassword); err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

type requestEmailChangeRequest struct {
	NewEmail string `json:"new_email"`
}

func (h *Handler) requestEmailChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req requestEmailChangeRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.RequestEmailChange(r.Context(), userID, req.NewEmail); err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

type confirmEmailChangeRequest struct {
	Code string `json:"code"`
}

func (h *Handler) confirmEmailChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req confirmEmailChangeRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	newEmail, err := h.svc.ConfirmEmailChange(r.Context(), userID, req.Code)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"email": newEmail})
}

// --- request/response shapes ---

type registerRequest struct {
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	Phone        string  `json:"phone"`
	Password     string  `json:"password"`
	Age          *int    `json:"age"`
	TshirtSize   *string `json:"tshirt_size"`
	City         *string `json:"city"`
	RunningLevel *string `json:"running_level"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// authResponse is returned on register/login: the tokens plus the user profile.
type authResponse struct {
	*TokenPair
	User *users.User `json:"user"`
}

// --- handlers ---

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	pair, user, err := h.svc.Register(r.Context(), RegisterParams{
		Name:         req.Name,
		Email:        req.Email,
		Phone:        req.Phone,
		Password:     req.Password,
		Age:          req.Age,
		TshirtSize:   req.TshirtSize,
		City:         req.City,
		RunningLevel: req.RunningLevel,
	})
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, authResponse{TokenPair: pair, User: user})
}

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
	case errors.Is(err, ErrEmailTaken):
		httpx.Error(w, http.StatusConflict, "an account with this email already exists")
	case errors.Is(err, ErrPhoneTaken):
		httpx.Error(w, http.StatusConflict, "an account with this phone already exists")
	case errors.Is(err, ErrInvalidCredentials):
		httpx.Error(w, http.StatusUnauthorized, "invalid email or password")
	case errors.Is(err, ErrInvalidRefreshToken):
		httpx.Error(w, http.StatusUnauthorized, "invalid or expired refresh token")
	case errors.Is(err, ErrInvalidCode):
		httpx.Error(w, http.StatusBadRequest, "that code is invalid or has expired")
	case errors.Is(err, email.ErrNotConfigured):
		// Email isn't set up yet — the recovery flows are dormant. 503 tells the
		// client this is a temporary server-side gap, not the user's fault.
		httpx.Error(w, http.StatusServiceUnavailable, "email isn't set up yet — please try again later")
	default:
		// Unexpected: log the real error, return a generic message (handled by
		// the shared helper so every handler behaves identically).
		httpx.InternalError(w, err)
	}
}
