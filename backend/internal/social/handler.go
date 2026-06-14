package social

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/gamification"
	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// Notifier is the slice of the push service this package needs (kept as an
// interface so social doesn't depend on the whole notifications package).
type Notifier interface {
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// Handler serves the social graph + public runner profiles. It leans on the
// gamification service for a read-only level snapshot and the notifier to ping
// a runner when someone follows them.
type Handler struct {
	repo   *Repository
	gam    *gamification.Service
	notify Notifier
}

func NewHandler(repo *Repository, gam *gamification.Service, notify Notifier) *Handler {
	return &Handler{repo: repo, gam: gam, notify: notify}
}

// Routes are mounted at /social behind the auth middleware.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Route("/users/{id}", func(r chi.Router) {
		r.Get("/", h.profile)
		r.Post("/follow", h.follow)
		r.Delete("/follow", h.unfollow)
		r.Get("/followers", h.followers)
		r.Get("/following", h.following)
	})
	return r
}

// profileResponse is the SQL profile plus the viewer flag and gamification bits.
type profileResponse struct {
	ProfileRow
	IsSelf     bool   `json:"is_self"`
	XP         int    `json:"xp"`
	LevelTitle string `json:"level_title"`
	Badges     int    `json:"badges"`
}

func (h *Handler) profile(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	targetID := chi.URLParam(r, "id")
	row, err := h.repo.Profile(r.Context(), viewerID, targetID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	if row == nil {
		httpx.Error(w, http.StatusNotFound, "runner not found")
		return
	}
	// Read-only level snapshot (never awards/announces for the viewed runner).
	xp, level, badges, err := h.gam.Snapshot(r.Context(), targetID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, profileResponse{
		ProfileRow: *row,
		IsSelf:     viewerID == targetID,
		XP:         xp,
		LevelTitle: level.Title,
		Badges:     badges,
	})
}

func (h *Handler) follow(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	targetID := chi.URLParam(r, "id")
	if targetID == viewerID {
		httpx.Error(w, http.StatusBadRequest, "you can't follow yourself")
		return
	}
	if _, exists, err := h.repo.NameIfExists(r.Context(), targetID); err != nil {
		httpx.InternalError(w, err)
		return
	} else if !exists {
		httpx.Error(w, http.StatusNotFound, "runner not found")
		return
	}

	created, err := h.repo.Follow(r.Context(), viewerID, targetID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	// Ping the followee — only on a NEW edge, so re-tapping doesn't re-notify.
	if created && h.notify != nil {
		name, _, _ := h.repo.NameIfExists(r.Context(), viewerID)
		if name == "" {
			name = "A runner"
		}
		h.notify.NotifyUsers(r.Context(), []string{targetID}, "New follower 👟",
			name+" started following you", map[string]string{"type": "follow", "user_id": viewerID})
	}
	h.respondFollowState(w, r, targetID, true)
}

func (h *Handler) unfollow(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	targetID := chi.URLParam(r, "id")
	if err := h.repo.Unfollow(r.Context(), viewerID, targetID); err != nil {
		httpx.InternalError(w, err)
		return
	}
	h.respondFollowState(w, r, targetID, false)
}

// respondFollowState returns the new follow flag + the target's fresh follower
// count, so the client can update the button and count without a refetch.
func (h *Handler) respondFollowState(w http.ResponseWriter, r *http.Request, targetID string, following bool) {
	count, err := h.repo.FollowerCount(r.Context(), targetID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"following": following, "followers": count})
}

func (h *Handler) followers(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, h.repo.Followers)
}

func (h *Handler) following(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, h.repo.Following)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request, fetch func(ctx context.Context, viewerID, targetID string) ([]Card, error)) {
	viewerID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	targetID := chi.URLParam(r, "id")
	cards, err := fetch(r.Context(), viewerID, targetID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cards)
}
