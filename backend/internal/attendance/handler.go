package attendance

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
	"github.com/avinash/virtual-run-tracker/backend/internal/permissions"
)

// Handler exposes the attendance endpoints. Scheduling and admin-marking are
// gated programmatically via the permission checker (these routes don't carry a
// {chapterID} in the path, so the path-based middleware doesn't apply).
type Handler struct {
	svc   *Service
	check *permissions.Checker
}

// NewHandler wires the handler to its service and permission checker.
func NewHandler(svc *Service, check *permissions.Checker) *Handler {
	return &Handler{svc: svc, check: check}
}

// adminRoles may schedule runs and mark other members present.
var adminRoles = []string{permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin}

// RunRoutes is mounted at /runs.
func (h *Handler) RunRoutes() http.Handler {
	r := chi.NewRouter()
	r.Post("/", h.scheduleRun)
	r.Post("/bulk", h.bulkSchedule) // recurring schedule (client-expanded occurrences)
	r.Get("/", h.listRuns)          // ?chapter_id=...
	r.Get("/mine", h.myRuns)        // caller's personal schedule (all their clubs)
	r.Route("/{runID}", func(r chi.Router) {
		r.Get("/", h.getRun)
		r.Put("/", h.updateRun) // organiser edits the run
		r.Post("/checkin", h.checkIn)
		r.Post("/checkout", h.checkOut)
		r.Get("/attendance", h.listAttendees)
	})
	return r
}

// MemberRoutes is mounted at /members.
func (h *Handler) MemberRoutes() http.Handler {
	r := chi.NewRouter()
	r.Get("/{userID}/attendance", h.memberHistory)
	return r
}

// --- request shapes ---

type scheduleRunRequest struct {
	ChapterID      string   `json:"chapter_id"`
	Title          string   `json:"title"`
	ScheduledAt    string   `json:"scheduled_at"` // RFC3339
	Location       *string  `json:"location"`
	LocationLat    *float64 `json:"location_lat"`
	LocationLng    *float64 `json:"location_lng"`
	DistanceTarget *float64 `json:"distance_target"`
	Notes          *string  `json:"notes"`
}

type checkInRequest struct {
	UserID string  `json:"user_id"` // optional: omit/self = self check-in
	Notes  *string `json:"notes"`
}

type checkOutRequest struct {
	Reason *string `json:"reason"` // optional
}

type bulkScheduleRequest struct {
	ChapterID      string   `json:"chapter_id"`
	Title          string   `json:"title"`
	HasTime        bool     `json:"has_time"`
	Location       *string  `json:"location"`
	DistanceTarget *float64 `json:"distance_target"`
	Notes          *string  `json:"notes"`
	ScheduledAts   []string `json:"scheduled_ats"` // RFC3339, client-expanded occurrences
}

type updateRunRequest struct {
	Title          string   `json:"title"`
	ScheduledAt    string   `json:"scheduled_at"` // RFC3339
	HasTime        bool     `json:"has_time"`
	Location       *string  `json:"location"`
	DistanceTarget *float64 `json:"distance_target"`
	Notes          *string  `json:"notes"`
}

// --- handlers ---

func (h *Handler) scheduleRun(w http.ResponseWriter, r *http.Request) {
	actorID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req scheduleRunRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapterID, err := uuid.Parse(req.ChapterID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
		return
	}
	if !h.requireChapterAdmin(w, r, actorID, chapterID) {
		return
	}
	scheduledAt, err := parseTime(req.ScheduledAt)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "scheduled_at must be an RFC3339 timestamp")
		return
	}
	run, err := h.svc.ScheduleRun(r.Context(), NewRun{
		ChapterID:      chapterID,
		CreatedBy:      actorID,
		Title:          req.Title,
		ScheduledAt:    scheduledAt,
		HasTime:        true,
		Location:       req.Location,
		LocationLat:    req.LocationLat,
		LocationLng:    req.LocationLng,
		DistanceTarget: req.DistanceTarget,
		Notes:          req.Notes,
	})
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, run)
}

func (h *Handler) bulkSchedule(w http.ResponseWriter, r *http.Request) {
	actorID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req bulkScheduleRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapterID, err := uuid.Parse(req.ChapterID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
		return
	}
	if !h.requireChapterAdmin(w, r, actorID, chapterID) {
		return
	}
	times := make([]time.Time, 0, len(req.ScheduledAts))
	for _, s := range req.ScheduledAts {
		t, err := parseTime(s)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "scheduled_ats must be RFC3339 timestamps")
			return
		}
		times = append(times, t)
	}
	runs, err := h.svc.BulkSchedule(r.Context(), NewRun{
		ChapterID:      chapterID,
		CreatedBy:      actorID,
		Title:          req.Title,
		HasTime:        req.HasTime,
		Location:       req.Location,
		DistanceTarget: req.DistanceTarget,
		Notes:          req.Notes,
	}, times)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, runs)
}

func (h *Handler) updateRun(w http.ResponseWriter, r *http.Request) {
	actorID, _ := httpx.UserIDFromContext(r.Context())
	runID, ok := h.runID(w, r)
	if !ok {
		return
	}
	chapterID, err := h.svc.ChapterOfRun(r.Context(), runID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	if !h.requireChapterAdmin(w, r, actorID, chapterID) {
		return
	}
	var req updateRunRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	scheduledAt, err := parseTime(req.ScheduledAt)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "scheduled_at must be an RFC3339 timestamp")
		return
	}
	run, err := h.svc.UpdateRun(r.Context(), runID, RunUpdate{
		Title:          req.Title,
		ScheduledAt:    scheduledAt,
		HasTime:        req.HasTime,
		Location:       req.Location,
		DistanceTarget: req.DistanceTarget,
		Notes:          req.Notes,
	})
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, run)
}

func (h *Handler) myRuns(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	runs, err := h.svc.MyRuns(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, runs)
}

func (h *Handler) listRuns(w http.ResponseWriter, r *http.Request) {
	chapterID, err := uuid.Parse(r.URL.Query().Get("chapter_id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "a valid chapter_id query parameter is required")
		return
	}
	runs, err := h.svc.ListRuns(r.Context(), chapterID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, runs)
}

func (h *Handler) getRun(w http.ResponseWriter, r *http.Request) {
	runID, ok := h.runID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.GetRun(r.Context(), runID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, run)
}

func (h *Handler) checkIn(w http.ResponseWriter, r *http.Request) {
	actorID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	runID, ok := h.runID(w, r)
	if !ok {
		return
	}
	var req checkInRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	// Default: the caller checks themselves in (marked_by NULL).
	target := actorID
	var markedBy *string

	// Marking SOMEONE ELSE present requires a chapter-admin role on the run's
	// chapter; record who did the marking.
	if req.UserID != "" && req.UserID != actorID {
		chapterID, err := h.svc.ChapterOfRun(r.Context(), runID)
		if err != nil {
			h.writeError(w, err)
			return
		}
		if !h.requireChapterAdmin(w, r, actorID, chapterID) {
			return
		}
		target = req.UserID
		markedBy = &actorID
	}

	run, err := h.svc.CheckIn(r.Context(), runID, target, markedBy)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, run)
}

func (h *Handler) checkOut(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	runID, ok := h.runID(w, r)
	if !ok {
		return
	}
	var req checkOutRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Reason != nil {
		trimmed := strings.TrimSpace(*req.Reason)
		req.Reason = &trimmed
		if trimmed == "" {
			req.Reason = nil
		}
	}
	run, err := h.svc.CheckOut(r.Context(), runID, userID, req.Reason)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, run)
}

func (h *Handler) listAttendees(w http.ResponseWriter, r *http.Request) {
	runID, ok := h.runID(w, r)
	if !ok {
		return
	}
	attendees, err := h.svc.ListAttendees(r.Context(), runID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, attendees)
}

func (h *Handler) memberHistory(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	if userID == "" {
		httpx.Error(w, http.StatusBadRequest, "user id is required")
		return
	}
	history, err := h.svc.MemberHistory(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, history)
}

// --- helpers ---

func (h *Handler) runID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "runID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid run id")
		return uuid.Nil, false
	}
	return id, true
}

// requireChapterAdmin checks the caller holds an admin role on the chapter,
// writing the appropriate 403/500 and returning false if not.
func (h *Handler) requireChapterAdmin(w http.ResponseWriter, r *http.Request, userID string, chapterID uuid.UUID) bool {
	ok, err := h.check.HasChapterRole(r.Context(), userID, chapterID, adminRoles...)
	if err != nil {
		httpx.InternalError(w, err)
		return false
	}
	if !ok {
		httpx.Error(w, http.StatusForbidden, "you do not have permission to do that")
		return false
	}
	return true
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	var validationErr ValidationError
	switch {
	case errors.As(err, &validationErr):
		httpx.Error(w, http.StatusBadRequest, validationErr.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "run not found")
	default:
		httpx.InternalError(w, err)
	}
}
