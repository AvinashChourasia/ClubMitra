package organisations

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
	"github.com/avinash/virtual-run-tracker/backend/internal/permissions"
)

// Handler exposes the club-core endpoints. It depends on the service for logic
// and on the permission checker to gate admin-only routes.
type Handler struct {
	svc   *Service
	check *permissions.Checker
}

// NewHandler wires the handler to its service and permission checker.
func NewHandler(svc *Service, check *permissions.Checker) *Handler {
	return &Handler{svc: svc, check: check}
}

// adminRoles are the roles allowed to manage a chapter's members.
var adminRoles = []string{permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin}

// Routes returns a router mounted (in main) inside the authenticated group, so
// every handler can assume a verified user in the context.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()

	r.Route("/organisations", func(r chi.Router) {
		r.Post("/", h.createOrg)
		r.Route("/{orgID}", func(r chi.Router) {
			r.Get("/", h.getOrg)
			r.Get("/chapters", h.listChapters)
			// Only an org admin may add chapters or hand out roles.
			r.With(h.check.RequireOrgRole(permissions.RoleOrgAdmin)).Post("/chapters", h.createChapter)
			r.With(h.check.RequireOrgRole(permissions.RoleOrgAdmin)).Post("/roles", h.assignRole)
		})
	})

	r.Route("/chapters", func(r chi.Router) {
		r.Post("/join", h.joinByInvite) // any authenticated runner
		r.Route("/{chapterID}", func(r chi.Router) {
			r.With(h.check.RequireChapterRole(adminRoles...)).Post("/members", h.addMember)
			r.With(h.check.RequireChapterRole(adminRoles...)).Get("/members", h.listMembers)
		})
	})

	return r
}

// --- request shapes ---

type createOrgRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type createChapterRequest struct {
	Name        string `json:"name"`
	City        string `json:"city"`
	Description string `json:"description"`
}

type assignRoleRequest struct {
	UserID    string  `json:"user_id"`
	Role      string  `json:"role"`
	ChapterID *string `json:"chapter_id"` // optional: omit/null = org-wide
}

type joinRequest struct {
	InviteCode string `json:"invite_code"`
}

type addMemberRequest struct {
	UserID string `json:"user_id"`
}

// --- handlers ---

func (h *Handler) createOrg(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createOrgRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	org, err := h.svc.CreateOrg(r.Context(), req.Name, req.Description, userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, org)
}

func (h *Handler) getOrg(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	org, err := h.svc.GetOrg(r.Context(), orgID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, org)
}

func (h *Handler) createChapter(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	var req createChapterRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapter, err := h.svc.CreateChapter(r.Context(), orgID, req.Name, req.City, req.Description)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, chapter)
}

func (h *Handler) listChapters(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	chapters, err := h.svc.ListChapters(r.Context(), orgID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chapters)
}

func (h *Handler) assignRole(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpx.UserIDFromContext(r.Context())
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	var req assignRoleRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	var chapterID *uuid.UUID
	if req.ChapterID != nil && *req.ChapterID != "" {
		parsed, err := uuid.Parse(*req.ChapterID)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
			return
		}
		chapterID = &parsed
	}
	if err := h.svc.AssignRole(r.Context(), orgID, chapterID, req.UserID, req.Role, userID); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) joinByInvite(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req joinRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapter, err := h.svc.JoinByInvite(r.Context(), req.InviteCode, userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chapter)
}

func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) {
	actorID, _ := httpx.UserIDFromContext(r.Context())
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	var req addMemberRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.AddMember(r.Context(), chapterID, req.UserID, actorID); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	members, err := h.svc.ListMembers(r.Context(), chapterID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, members)
}

// --- helpers ---

// orgID / chapterID parse the path UUID, writing a 400 and returning false on a
// malformed id so handlers can early-return.
func (h *Handler) orgID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	return parseID(w, chi.URLParam(r, "orgID"), "organisation id")
}

func (h *Handler) chapterID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	return parseID(w, chi.URLParam(r, "chapterID"), "chapter id")
}

func parseID(w http.ResponseWriter, raw, label string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid "+label)
		return uuid.Nil, false
	}
	return id, true
}

// writeError maps domain errors to HTTP status codes in one place.
func (h *Handler) writeError(w http.ResponseWriter, err error) {
	var validationErr ValidationError
	switch {
	case errors.As(err, &validationErr):
		httpx.Error(w, http.StatusBadRequest, validationErr.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "not found")
	default:
		httpx.InternalError(w, err)
	}
}
