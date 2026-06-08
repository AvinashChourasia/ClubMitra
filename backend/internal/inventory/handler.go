package inventory

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// Handler exposes the inventory endpoints, gated to chapter managers (org +
// chapter admin + co-admin can manage inventory per the permission table).
type Handler struct {
	svc   *Service
	check *permissions.Checker
}

// NewHandler wires the handler to its service and permission checker.
func NewHandler(svc *Service, check *permissions.Checker) *Handler {
	return &Handler{svc: svc, check: check}
}

// Routes mounts under /inventory with {chapterID} in the path so the permission
// checker can gate the whole subtree.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	manager := h.check.RequireChapterRole(permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin)
	r.Route("/{chapterID}", func(r chi.Router) {
		r.Use(manager)
		r.Get("/items", h.list)
		r.Post("/items", h.create)
		r.Route("/items/{itemID}", func(r chi.Router) {
			r.Put("/", h.update)
			r.Delete("/", h.remove)
			r.Get("/transactions", h.transactions)
			r.Post("/issue", h.move("issue"))
			r.Post("/return", h.move("return"))
			r.Post("/restock", h.move("restock"))
		})
	})
	return r
}

// --- request shapes ---

type itemRequest struct {
	Name          string          `json:"name"`
	Category      *string         `json:"category"`
	Quantity      int             `json:"quantity"` // initial stock (create only)
	SizeBreakdown json.RawMessage `json:"size_breakdown"`
	UnitPrice     *float64        `json:"unit_price"`
	Currency      string          `json:"currency"`
	ImageURL      *string         `json:"image_url"`
}

type moveRequest struct {
	Quantity int     `json:"quantity"`
	Size     *string `json:"size"`
	UserID   *string `json:"user_id"` // recipient (issue) / returner, optional
	Notes    *string `json:"notes"`
}

// --- handlers ---

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	cid, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ListItems(r.Context(), cid)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	cid, ok := h.chapterID(w, r)
	if !ok {
		return
	}
	var req itemRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := h.svc.CreateItem(r.Context(), cid, req.Name, req.Category, req.Quantity, req.SizeBreakdown, req.UnitPrice, req.Currency, req.ImageURL)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, item)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	cid, iid, ok := h.ids(w, r)
	if !ok {
		return
	}
	var req itemRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := h.svc.UpdateItem(r.Context(), cid, iid, req.Name, req.Category, req.SizeBreakdown, req.UnitPrice, req.Currency, req.ImageURL)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, item)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	cid, iid, ok := h.ids(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteItem(r.Context(), cid, iid); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

// move returns a handler for a fixed transaction type (issue/return/restock).
func (h *Handler) move(txType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cid, iid, ok := h.ids(w, r)
		if !ok {
			return
		}
		actorID, _ := httpx.UserIDFromContext(r.Context())
		var req moveRequest
		if err := httpx.Decode(w, r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		item, err := h.svc.Move(r.Context(), cid, iid, txType, req.Quantity, req.UserID, req.Size, req.Notes, &actorID)
		if err != nil {
			h.writeError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, item)
	}
}

func (h *Handler) transactions(w http.ResponseWriter, r *http.Request) {
	cid, iid, ok := h.ids(w, r)
	if !ok {
		return
	}
	txns, err := h.svc.Transactions(r.Context(), cid, iid)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, txns)
}

// --- helpers ---

func (h *Handler) chapterID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	return parseUUID(w, chi.URLParam(r, "chapterID"), "chapter id")
}

func (h *Handler) ids(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	cid, ok := parseUUID(w, chi.URLParam(r, "chapterID"), "chapter id")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	iid, ok := parseUUID(w, chi.URLParam(r, "itemID"), "item id")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return cid, iid, true
}

func parseUUID(w http.ResponseWriter, raw, label string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid "+label)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, ErrInsufficientStock):
		httpx.Error(w, http.StatusConflict, "not enough stock available")
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "not found")
	default:
		httpx.InternalError(w, err)
	}
}
