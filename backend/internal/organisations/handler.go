package organisations

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/permissions"
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

	orgAdmin := h.check.RequireOrgRole(permissions.RoleOrgAdmin)
	chapterAdmin := h.check.RequireChapterRole(adminRoles...)
	// Soft-deleting a chapter is reserved for an org admin (per the permission
	// table); RequireChapterRole resolves an org-wide grant for the chapter.
	chapterOrgAdmin := h.check.RequireChapterRole(permissions.RoleOrgAdmin)

	r.Route("/organisations", func(r chi.Router) {
		r.Post("/", h.createOrg)
		r.Route("/{orgID}", func(r chi.Router) {
			r.Get("/", h.getOrg)
			r.Get("/chapters", h.listChapters)
			r.With(orgAdmin).Put("/", h.updateOrg)
			r.With(orgAdmin).Delete("/", h.deleteOrg)
			// Only an org admin may add chapters or hand out roles.
			r.With(orgAdmin).Post("/chapters", h.createChapter)
			r.With(orgAdmin).Post("/roles", h.assignRole)
		})
	})

	r.Route("/chapters", func(r chi.Router) {
		r.Post("/join", h.joinByInvite) // any authenticated runner
		r.Get("/mine", h.myChapters)    // the caller's chapters (static before {chapterID})
		r.Route("/{chapterID}", func(r chi.Router) {
			r.Get("/", h.getChapter)
			r.Post("/join", h.joinOpen) // join a discovered open club (no invite code)
			r.Post("/pay", h.payMembership)             // self-service: pay/renew own membership
			r.Put("/members/me/status", h.setOwnStatus) // self-service: on_leave / active
			r.With(chapterAdmin).Put("/", h.updateChapter)
			r.With(chapterOrgAdmin).Delete("/", h.deleteChapter)
			r.With(chapterAdmin).Post("/members", h.addMember)
			r.With(chapterAdmin).Get("/members", h.listMembers)
			r.With(chapterAdmin).Get("/members/{userID}", h.getMember)
			r.With(chapterAdmin).Put("/members/{userID}", h.updateMemberStatus)
			r.With(chapterAdmin).Post("/members/{userID}/approve", h.approveMember)
			r.With(chapterAdmin).Delete("/members/{userID}", h.removeMember)
		})
	})

	return r
}

// --- request shapes ---

type createOrgRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// chapterSettingsFields are the editable club config (media + fee/approval),
// embedded in create+update.
type chapterSettingsFields struct {
	Logo              *string  `json:"logo"`        // Cloudinary URL or null to clear
	Banner            *string  `json:"banner"`      // Cloudinary URL or null to clear
	JoinPolicy        *string  `json:"join_policy"` // open | invite (omitted = open)
	RequiresApproval  *bool    `json:"requires_approval"`
	FeeEnabled        *bool    `json:"membership_fee_enabled"`
	FeeAmount         *float64 `json:"membership_fee_amount"`
	MembershipPeriod  *string  `json:"membership_period"`
	RenewalWindowDays *int     `json:"renewal_window_days"`
}

// toSettings builds ChapterSettings with sensible defaults (open join, approval
// on, fee off, 5-day renewal window) when fields are omitted.
func (f chapterSettingsFields) toSettings() ChapterSettings {
	s := ChapterSettings{
		Logo:              f.Logo,
		Banner:            f.Banner,
		JoinPolicy:        "open",
		RequiresApproval:  f.RequiresApproval == nil || *f.RequiresApproval,
		FeeEnabled:        f.FeeEnabled != nil && *f.FeeEnabled,
		FeeAmount:         f.FeeAmount,
		MembershipPeriod:  f.MembershipPeriod,
		RenewalWindowDays: 5,
	}
	if f.JoinPolicy != nil && *f.JoinPolicy == "invite" {
		s.JoinPolicy = "invite"
	}
	if f.RenewalWindowDays != nil {
		s.RenewalWindowDays = *f.RenewalWindowDays
	}
	return s
}

type createChapterRequest struct {
	Name        string `json:"name"`
	City        string `json:"city"`
	Description string `json:"description"`
	chapterSettingsFields
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

type updateOrgRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type updateChapterRequest struct {
	Name        string `json:"name"`
	City        string `json:"city"`
	Description string `json:"description"`
	IsPublic    *bool  `json:"is_public"` // omitted = public
	chapterSettingsFields
}

type updateMemberStatusRequest struct {
	Status string `json:"status"`
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
	actorID, _ := httpx.UserIDFromContext(r.Context())
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	var req createChapterRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapter, err := h.svc.CreateChapter(r.Context(), orgID, req.Name, req.City, req.Description, actorID, req.toSettings())
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, chapter)
}

func (h *Handler) updateOrg(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	var req updateOrgRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	org, err := h.svc.UpdateOrg(r.Context(), orgID, req.Name, req.Description)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, org)
}

func (h *Handler) deleteOrg(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteOrg(r.Context(), orgID); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) getChapter(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	chapter, err := h.svc.GetChapter(r.Context(), chapterID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chapter)
}

func (h *Handler) updateChapter(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	var req updateChapterRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	isPublic := req.IsPublic == nil || *req.IsPublic
	chapter, err := h.svc.UpdateChapter(r.Context(), chapterID, req.Name, req.City, req.Description, isPublic, req.toSettings())
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chapter)
}

func (h *Handler) approveMember(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	status, err := h.svc.ApproveMember(r.Context(), chapterID, chi.URLParam(r, "userID"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": status})
}

func (h *Handler) payMembership(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	until, err := h.svc.PayMembership(r.Context(), chapterID, userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "active", "fee_paid_until": until})
}

func (h *Handler) deleteChapter(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteChapter(r.Context(), chapterID); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) getMember(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	detail, err := h.svc.GetMemberDetail(r.Context(), chapterID, chi.URLParam(r, "userID"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, detail)
}

func (h *Handler) updateMemberStatus(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	var req updateMemberStatusRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.UpdateMemberStatus(r.Context(), chapterID, chi.URLParam(r, "userID"), req.Status); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

// setOwnStatus is the member self-service: set your own membership to on_leave
// or back to active. Not admin-gated — the caller can only change themselves.
func (h *Handler) setOwnStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	var req updateMemberStatusRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.SetOwnStatus(r.Context(), chapterID, userID, req.Status); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) {
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	if err := h.svc.RemoveMember(r.Context(), chapterID, chi.URLParam(r, "userID")); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
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

func (h *Handler) myChapters(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapters, err := h.svc.MyChapters(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, chapters)
}

// PublicRoutes returns the unauthenticated discovery endpoints, mounted in main
// OUTSIDE the auth group. Read-only teasers — no invite codes, no member
// identities — so guests can browse clubs before creating a profile.
func (h *Handler) PublicRoutes() http.Handler {
	r := chi.NewRouter()
	r.Get("/chapters", h.discover)         // ?city=&q=
	r.Get("/chapters/{id}", h.discoverOne) // public club profile
	r.Get("/cities", h.cities)
	return r
}

// discoverOne returns one public club's teaser for the non-member profile page.
func (h *Handler) discoverOne(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid club id")
		return
	}
	entry, err := h.svc.DiscoverOne(r.Context(), id)
	if err != nil {
		h.writeError(w, err)
		return
	}
	if entry == nil {
		httpx.Error(w, http.StatusNotFound, "club not found")
		return
	}
	httpx.JSON(w, http.StatusOK, entry)
}

// discover lists public clubs for guests, filtered by ?city= and/or ?q= (name).
func (h *Handler) discover(w http.ResponseWriter, r *http.Request) {
	entries, err := h.svc.Discover(r.Context(), r.URL.Query().Get("city"), r.URL.Query().Get("q"))
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, entries)
}

// cities lists cities with public clubs, for the guest city picker.
func (h *Handler) cities(w http.ResponseWriter, r *http.Request) {
	cities, err := h.svc.Cities(r.Context())
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, cities)
}

// joinOpen joins a discovered open club directly (auth required; no invite code).
func (h *Handler) joinOpen(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	result, err := h.svc.JoinOpen(r.Context(), chapterID, userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
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
	result, err := h.svc.JoinByInvite(r.Context(), req.InviteCode, userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
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
