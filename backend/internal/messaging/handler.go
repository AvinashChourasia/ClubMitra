package messaging

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// Handler exposes the chat endpoints. Access control lives in the service
// (membership for read/post; admin for announce), so there's no route-level
// middleware here beyond the auth group it's mounted in.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler to its service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Routes mounts under /messaging.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/chapter/{chapterID}", h.chapterList)
	r.Post("/chapter/{chapterID}", h.chapterPost)
	r.Post("/chapter/{chapterID}/announce", h.announce)
	r.Get("/run/{runID}", h.runList)
	r.Post("/run/{runID}", h.runPost)
	return r
}

type postRequest struct {
	Body      *string `json:"body"`
	MediaURL  *string `json:"media_url"`
	MediaType *string `json:"media_type"`
}

type announceRequest struct {
	Body string `json:"body"`
}

func (h *Handler) chapterList(w http.ResponseWriter, r *http.Request) {
	uid, cid, ok := h.userAnd(w, r, "chapterID")
	if !ok {
		return
	}
	msgs, err := h.svc.ChapterMessages(r.Context(), uid, cid)
	h.respond(w, msgs, err)
}

func (h *Handler) chapterPost(w http.ResponseWriter, r *http.Request) {
	uid, cid, ok := h.userAnd(w, r, "chapterID")
	if !ok {
		return
	}
	var req postRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	msg, err := h.svc.PostChapter(r.Context(), uid, cid, req.Body, req.MediaURL, req.MediaType)
	h.respondCreated(w, msg, err)
}

func (h *Handler) announce(w http.ResponseWriter, r *http.Request) {
	uid, cid, ok := h.userAnd(w, r, "chapterID")
	if !ok {
		return
	}
	var req announceRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	msg, err := h.svc.Announce(r.Context(), uid, cid, req.Body)
	h.respondCreated(w, msg, err)
}

func (h *Handler) runList(w http.ResponseWriter, r *http.Request) {
	uid, rid, ok := h.userAnd(w, r, "runID")
	if !ok {
		return
	}
	msgs, err := h.svc.RunMessages(r.Context(), uid, rid)
	h.respond(w, msgs, err)
}

func (h *Handler) runPost(w http.ResponseWriter, r *http.Request) {
	uid, rid, ok := h.userAnd(w, r, "runID")
	if !ok {
		return
	}
	var req postRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	msg, err := h.svc.PostRun(r.Context(), uid, rid, req.Body, req.MediaURL, req.MediaType)
	h.respondCreated(w, msg, err)
}

// --- helpers ---

func (h *Handler) userAnd(w http.ResponseWriter, r *http.Request, param string) (string, uuid.UUID, bool) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return "", uuid.Nil, false
	}
	id, err := uuid.Parse(chi.URLParam(r, param))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid id")
		return "", uuid.Nil, false
	}
	return uid, id, true
}

func (h *Handler) respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

func (h *Handler) respondCreated(w http.ResponseWriter, v any, err error) {
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, v)
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "you're not a member of this club")
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "not found")
	default:
		httpx.InternalError(w, err)
	}
}
