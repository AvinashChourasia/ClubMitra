package activitysync

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// appReturnURL is the deep link the OAuth callback redirects back to; the mobile
// app's WebBrowser auth session closes when it sees this scheme.
const appReturnURL = "clubmitra://strava"

// callbackPath is the public callback route (Strava only validates the domain,
// so the full path is ours to choose). Mounted under /public/integrations.
const callbackPath = "/api/v1/public/integrations/strava/callback"

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Routes are the authenticated endpoints (mounted at /integrations).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/strava/connect", h.connect)
	r.Get("/strava/status", h.status)
	r.Post("/strava/sync", h.sync)
	r.Post("/strava/disconnect", h.disconnect)
	return r
}

// PublicRoutes is the unauthenticated OAuth callback (Strava calls it directly);
// mounted under /public/integrations.
func (h *Handler) PublicRoutes() http.Handler {
	r := chi.NewRouter()
	r.Get("/strava/callback", h.callback)
	return r
}

// redirectURI builds our callback URL from the incoming request so it always
// matches the live deployment's host (Render terminates TLS, so trust
// X-Forwarded-Proto, defaulting to https).
func redirectURI(r *http.Request) string {
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "https"
	}
	return proto + "://" + r.Host + callbackPath
}

func (h *Handler) connect(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.svc.Configured() {
		httpx.Error(w, http.StatusServiceUnavailable, "Strava sync isn't enabled yet")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"url": h.svc.ConnectURL(userID, redirectURI(r))})
}

func (h *Handler) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("error") != "" || q.Get("code") == "" {
		http.Redirect(w, r, appReturnURL+"?error=denied", http.StatusFound)
		return
	}
	if _, err := h.svc.HandleCallback(r.Context(), q.Get("code"), q.Get("state")); err != nil {
		http.Redirect(w, r, appReturnURL+"?error=failed", http.StatusFound)
		return
	}
	http.Redirect(w, r, appReturnURL+"?connected=1", http.StatusFound)
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	st, err := h.svc.Status(r.Context(), userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"configured":     h.svc.Configured(),
		"connected":      st.Connected,
		"athlete_id":     st.AthleteID,
		"last_synced_at": st.LastSyncedAt,
	})
}

func (h *Handler) sync(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	n, err := h.svc.Sync(r.Context(), userID)
	if err != nil {
		if err == ErrNotConnected {
			httpx.Error(w, http.StatusBadRequest, "connect Strava first")
			return
		}
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"imported": n})
}

func (h *Handler) disconnect(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if err := h.svc.Disconnect(r.Context(), userID); err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}
