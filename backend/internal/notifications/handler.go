package notifications

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
)

// Handler exposes the device-token endpoints, mounted (behind auth) at /push.
type Handler struct {
	n *Notifier
}

// NewHandler wires the handler to the notifier.
func NewHandler(n *Notifier) *Handler {
	return &Handler{n: n}
}

// Routes returns the /push sub-router.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/token", h.registerToken)
	r.Delete("/token", h.deleteToken)
	return r
}

type tokenRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
}

func (h *Handler) registerToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req tokenRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Token == "" {
		httpx.Error(w, http.StatusBadRequest, "token is required")
		return
	}
	if err := h.n.SaveToken(r.Context(), userID, req.Token, req.Platform); err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) deleteToken(w http.ResponseWriter, r *http.Request) {
	if _, ok := httpx.UserIDFromContext(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req tokenRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.n.DeleteToken(r.Context(), req.Token); err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}
