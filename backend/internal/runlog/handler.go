package runlog

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// Handler exposes run-logging + rolling-leaderboard endpoints, mounted at /runlog.
type Handler struct{ svc *Service }

// NewHandler wires the handler to the service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Routes returns the /runlog sub-router (behind auth).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/", h.log)
	r.Get("/mine", h.mine)
	r.Get("/leaderboard/{chapterID}/{period}", h.leaderboard)
	return r
}

type logRequest struct {
	ChapterID  string  `json:"chapter_id"`
	DistanceKM float64 `json:"distance_km"`
	RanOn      string  `json:"ran_on"` // YYYY-MM-DD
	Note       *string `json:"note"`
	ProofURL   *string `json:"proof_url"`
}

func (h *Handler) log(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req logRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	chapterID, err := uuid.Parse(req.ChapterID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter_id")
		return
	}
	logged, err := h.svc.Log(r.Context(), userID, NewLog{
		ChapterID:  chapterID,
		DistanceKM: req.DistanceKM,
		RanOn:      req.RanOn,
		Note:       req.Note,
		ProofURL:   req.ProofURL,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, logged)
}

func (h *Handler) mine(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	logs, err := h.svc.MyLogs(r.Context(), userID)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, logs)
}

func (h *Handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := httpx.UserIDFromContext(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	chapterID, err := uuid.Parse(chi.URLParam(r, "chapterID"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid chapter id")
		return
	}
	board, err := h.svc.Leaderboard(r.Context(), chapterID, chi.URLParam(r, "period"))
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, board)
}

func writeErr(w http.ResponseWriter, err error) {
	var ve ValidationError
	if errors.As(err, &ve) {
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
		return
	}
	httpx.InternalError(w, err)
}
