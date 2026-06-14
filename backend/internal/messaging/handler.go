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
	r.Get("/conversations", h.inbox) // the chat list (club groups + DMs)
	r.Get("/chapter/{chapterID}", h.chapterList)
	r.Post("/chapter/{chapterID}", h.chapterPost)
	r.Post("/chapter/{chapterID}/announce", h.announce)
	r.Post("/chapter/{chapterID}/poll", h.chapterPoll) // admin: post a poll
	r.Put("/messages/{messageID}/vote", h.votePoll)    // {"option_id":"..."}
	r.Get("/run/{runID}", h.runList)
	r.Post("/run/{runID}", h.runPost)
	r.Get("/dm/{userID}", h.dmList)  // open/start a 1:1 chat
	r.Post("/dm/{userID}", h.dmPost) // send to a 1:1 chat
	r.Delete("/messages/{messageID}", h.deleteMessage)
	r.Put("/messages/{messageID}", h.editMessage)          // {"body":"..."} (own messages)
	r.Get("/messages/{messageID}/info", h.messageInfo)     // read-by list (own messages)
	r.Put("/messages/{messageID}/reaction", h.setReaction) // {"emoji":"❤️"} ("" clears)
	r.Put("/prefs", h.setPrefs)                            // mute / archive a conversation
	return r
}

type reactionRequest struct {
	Emoji string `json:"emoji"`
}

type editRequest struct {
	Body string `json:"body"`
}

func (h *Handler) messageInfo(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid message id")
		return
	}
	info, err := h.svc.MessageInfo(r.Context(), uid, id)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

func (h *Handler) editMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid message id")
		return
	}
	var req editRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.EditMessage(r.Context(), uid, id, req.Body); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) setReaction(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid message id")
		return
	}
	var req reactionRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.SetReaction(r.Context(), uid, id, req.Emoji); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

type prefsRequest struct {
	Kind     string `json:"kind"` // "club" | "direct"
	ID       string `json:"id"`   // chapter id or other user's id
	Muted    *bool  `json:"muted"`
	Archived *bool  `json:"archived"`
}

func (h *Handler) setPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req prefsRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.SetPrefs(r.Context(), uid, req.Kind, req.ID, req.Muted, req.Archived); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) deleteMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "messageID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid message id")
		return
	}
	if err := h.svc.DeleteMessage(r.Context(), uid, id); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

type postRequest struct {
	Body      *string `json:"body"`
	MediaURL  *string `json:"media_url"`
	MediaType *string `json:"media_type"`
	ReplyToID *string `json:"reply_to_id"`
}

// replyID parses the optional reply target (nil when absent/invalid).
func (p postRequest) replyID() *uuid.UUID {
	if p.ReplyToID == nil {
		return nil
	}
	id, err := uuid.Parse(*p.ReplyToID)
	if err != nil {
		return nil
	}
	return &id
}

type announceRequest struct {
	Body string `json:"body"`
}

type pollRequest struct {
	Question string   `json:"question"`
	Options  []string `json:"options"`
	Multi    bool     `json:"multi"`
}

type voteRequest struct {
	OptionID string `json:"option_id"`
}

func (h *Handler) chapterPoll(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, err := uuid.Parse(chi.URLParam(r, "chapterID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter id")
		return
	}
	var req pollRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	msg, err := h.svc.PostChapterPoll(r.Context(), uid, chapterID, req.Question, req.Options, req.Multi)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, msg)
}

func (h *Handler) votePoll(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	messageID, err := uuid.Parse(chi.URLParam(r, "messageID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid message id")
		return
	}
	var req voteRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	optionID, err := uuid.Parse(req.OptionID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid option id")
		return
	}
	if err := h.svc.VotePoll(r.Context(), uid, messageID, optionID); err != nil {
		h.writeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
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
	msg, err := h.svc.PostChapter(r.Context(), uid, cid, req.Body, req.MediaURL, req.MediaType, req.replyID())
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

func (h *Handler) inbox(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	items, err := h.svc.Inbox(r.Context(), uid)
	h.respond(w, items, err)
}

func (h *Handler) dmList(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	thread, err := h.svc.DirectThread(r.Context(), uid, chi.URLParam(r, "userID"))
	h.respond(w, thread, err)
}

func (h *Handler) dmPost(w http.ResponseWriter, r *http.Request) {
	uid, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req postRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	msg, err := h.svc.PostDirect(r.Context(), uid, chi.URLParam(r, "userID"), req.Body, req.MediaURL, req.MediaType, req.replyID())
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
