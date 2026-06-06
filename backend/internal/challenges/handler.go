package challenges

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
	"github.com/avinash/virtual-run-tracker/backend/internal/permissions"
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
		r.Post("/join", h.join)
		r.Get("/leaderboard", h.leaderboard)
		r.Post("/proof", h.submitProof)
		r.Get("/proof", h.listProof)            // creator only
		r.Post("/proof/{proofID}/verify", h.verifyProof) // creator only
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
	TargetKM    *float64  `json:"target_km"`
	TargetDays  *int      `json:"target_days"`
	StartDate   time.Time `json:"start_date"`
	EndDate     time.Time `json:"end_date"`
	AllowTeams  *bool     `json:"allow_teams"`
}

type joinRequest struct {
	ChapterID *string `json:"chapter_id"` // present = join as this club
}

type submitProofRequest struct {
	StravaLink    *string  `json:"strava_link"`
	ScreenshotURL *string  `json:"screenshot_url"`
	KMClaimed     *float64 `json:"km_claimed"`
	ProofDate     *string  `json:"proof_date"` // "YYYY-MM-DD", optional
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

	// Individual join.
	ch, err := h.svc.Join(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, ch)
}

func (h *Handler) submitProof(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var req submitProofRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	proof, err := h.svc.SubmitProof(r.Context(), userID, id, req.StravaLink, req.ScreenshotURL, req.KMClaimed, req.ProofDate)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, proof)
}

func (h *Handler) listProof(w http.ResponseWriter, r *http.Request) {
	id, ok := h.requireCreator(w, r)
	if !ok {
		return
	}
	proofs, err := h.svc.ListProof(r.Context(), id)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, proofs)
}

func (h *Handler) verifyProof(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireCreator(w, r); !ok {
		return
	}
	verifierID, _ := httpx.UserIDFromContext(r.Context())
	proofID, err := uuid.Parse(chi.URLParam(r, "proofID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid proof id")
		return
	}
	proof, err := h.svc.VerifyProof(r.Context(), verifierID, proofID)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, proof)
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

// requireCreator parses the challenge id and confirms the caller created it —
// the gate for reviewing and verifying proof. Returns the id on success.
func (h *Handler) requireCreator(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return uuid.Nil, false
	}
	id, ok := parseID(w, r)
	if !ok {
		return uuid.Nil, false
	}
	ch, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		writeErr(w, err)
		return uuid.Nil, false
	}
	if ch.CreatorID != userID {
		httpx.Error(w, http.StatusForbidden, "only the challenge creator can review proof")
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
