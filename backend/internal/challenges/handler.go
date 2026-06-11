package challenges

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// Handler exposes the challenge endpoints. Mounted behind the auth middleware,
// so a verified user id is always in the request context. The permission checker
// gates club (chapter) joins.
type Handler struct {
	svc   *Service
	check *permissions.Checker
}

// NewHandler wires the handler to the service and permission checker.
func NewHandler(svc *Service, check *permissions.Checker) *Handler {
	return &Handler{svc: svc, check: check}
}

// adminRoles may act as a chapter's admin (join a club as a team).
var adminRoles = []string{permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin}

// Routes returns the /challenges sub-router.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.list) // browse visible (or ?joined=true for mine)
	r.Post("/", h.create)
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Put("/", h.update) // organiser edit, open until the start date
		r.Post("/join", h.join)
		r.Post("/leave", h.leave)
		r.Get("/leaderboard", h.leaderboard)
	})
	return r
}

// --- request shapes ---

type createRequest struct {
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Type        string    `json:"type"`
	Visibility  string    `json:"visibility"`
	City        *string   `json:"city"`
	OrgID       *string   `json:"org_id"`
	ChapterID   *string   `json:"chapter_id"`
	TargetKM    *float64   `json:"target_km"`
	TargetDays  *int       `json:"target_days"`
	StartDate   time.Time  `json:"start_date"`
	EndDate     time.Time  `json:"end_date"`
	AllowTeams  *bool      `json:"allow_teams"`
	JoinFee     *float64   `json:"join_fee"`
	LockDate    *time.Time `json:"lock_date"`
}

type joinRequest struct {
	ChapterID *string `json:"chapter_id"` // present = join as this club
	Paid      bool    `json:"paid"`       // mock-payment confirmation for a fee challenge
}

// updateRequest is the organiser's partial edit; absent fields keep their
// current values. Type/visibility/scope are immutable by design.
type updateRequest struct {
	Title       *string    `json:"title"`
	Description *string    `json:"description"`
	TargetKM    *float64   `json:"target_km"`
	TargetDays  *int       `json:"target_days"`
	StartDate   *time.Time `json:"start_date"`
	EndDate     *time.Time `json:"end_date"`
	LockDate    *time.Time `json:"lock_date"`
}

// --- handlers ---

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	orgID, err := optionalUUID(req.OrgID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid org_id")
		return
	}
	chapterID, err := optionalUUID(req.ChapterID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
		return
	}
	allowTeams := req.AllowTeams == nil || *req.AllowTeams
	ch, err := h.svc.Create(r.Context(), NewChallenge{
		CreatorID:   userID,
		OrgID:       orgID,
		ChapterID:   chapterID,
		Title:       req.Title,
		Description: req.Description,
		Type:        req.Type,
		Visibility:  req.Visibility,
		City:        req.City,
		TargetKM:    req.TargetKM,
		TargetDays:  req.TargetDays,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		AllowTeams:  allowTeams,
		JoinFee:     req.JoinFee,
		LockDate:    req.LockDate,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, ch)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	joinedOnly := r.URL.Query().Get("joined") == "true"
	list, err := h.svc.List(r.Context(), userID, joinedOnly)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

// PublicRoutes returns the unauthenticated challenge browse, mounted in main
// OUTSIDE the auth group. Guest teasers only — no leaderboards, no creators.
func (h *Handler) PublicRoutes() http.Handler {
	r := chi.NewRouter()
	r.Get("/", h.publicList) // ?city=&q=&type=
	return r
}

// publicList lists live public (and city-scoped) challenges for guests.
func (h *Handler) publicList(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	list, err := h.svc.PublicList(r.Context(), qs.Get("city"), qs.Get("q"), qs.Get("type"))
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	ch, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var req joinRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	// Club join: only a chapter admin may enrol their club as a team.
	if req.ChapterID != nil && *req.ChapterID != "" {
		chapterID, err := uuid.Parse(*req.ChapterID)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
			return
		}
		allowed, err := h.check.HasChapterRole(r.Context(), userID, chapterID, adminRoles...)
		if err != nil {
			httpx.InternalError(w, err)
			return
		}
		if !allowed {
			httpx.Error(w, http.StatusForbidden, "only a chapter admin can enrol the club")
			return
		}
		if err := h.svc.JoinAsChapter(r.Context(), id, chapterID); err != nil {
			writeErr(w, err)
			return
		}
		ch, err := h.svc.Get(r.Context(), userID, id)
		if err != nil {
			writeErr(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, ch)
		return
	}

	// Individual join (paid=true is the mock-payment confirmation for fee ones).
	ch, err := h.svc.Join(r.Context(), userID, id, req.Paid)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

func (h *Handler) leave(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	ch, err := h.svc.Leave(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

// update applies the organiser's edit (creator-only, pre-start — both enforced
// by the service) and returns the fresh challenge.
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var req updateRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	ch, err := h.svc.Update(r.Context(), userID, id, UpdateInput{
		Title:       req.Title,
		Description: req.Description,
		TargetKM:    req.TargetKM,
		TargetDays:  req.TargetDays,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		LockDate:    req.LockDate,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

// --- helpers ---

func parseID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid challenge id")
		return uuid.Nil, false
	}
	return id, true
}

// optionalUUID parses an optional UUID string ("" / nil -> nil pointer).
func optionalUUID(s *string) (*uuid.UUID, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*s)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// writeErr maps domain errors to HTTP statuses, consistent with other handlers.
func writeErr(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "challenge not found")
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, ErrForbidden.Error())
	case errors.Is(err, ErrPaymentRequired):
		httpx.Error(w, http.StatusPaymentRequired, ErrPaymentRequired.Error())
	default:
		httpx.InternalError(w, err)
	}
}

// leaderboard returns the ranked board for a challenge.
func (h *Handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := httpx.UserIDFromContext(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := h.svc.Leaderboard(r.Context(), id, limit)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, entries)
}
