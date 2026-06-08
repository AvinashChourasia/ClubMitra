// Package uploads issues signed Cloudinary upload parameters so the mobile app
// can upload images DIRECTLY to Cloudinary (the file never transits our API).
//
// The Cloudinary secret stays here on the server; the client only ever sees a
// short-lived signature. Flow:
//   1. app: POST /uploads/signature  -> { cloud_name, api_key, timestamp, folder, signature }
//   2. app: multipart POST to https://api.cloudinary.com/v1_1/<cloud>/image/upload
//   3. app: saves the returned secure_url via PUT /users/me { profile_photo }
package uploads

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// folders maps a client-supplied "kind" to the Cloudinary folder it may upload
// into. The client never names a raw folder — it picks a kind, and the server
// signs only an allowlisted path. Unknown/empty kinds fall back to avatars.
var folders = map[string]string{
	"avatar": "clubmitra/avatars", // profile photos
	"club":   "clubmitra/clubs",   // club logos + banners
}

const defaultKind = "avatar"

// Handler signs upload requests.
type Handler struct {
	cloud, apiKey, apiSecret string
}

// NewHandler wires the handler to the Cloudinary credentials (any empty = disabled).
func NewHandler(cloud, apiKey, apiSecret string) *Handler {
	return &Handler{cloud: cloud, apiKey: apiKey, apiSecret: apiSecret}
}

func (h *Handler) enabled() bool { return h.cloud != "" && h.apiKey != "" && h.apiSecret != "" }

// Routes returns the /uploads sub-router (mounted behind auth).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/signature", h.signature)
	return r
}

// signatureRequest lets the client pick which kind of image it's uploading; the
// server maps it to an allowlisted folder. Omitted = avatar (back-compat).
type signatureRequest struct {
	Kind string `json:"kind"`
}

func (h *Handler) signature(w http.ResponseWriter, r *http.Request) {
	if _, ok := httpx.UserIDFromContext(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "image uploads are not configured")
		return
	}

	// Body is optional; an empty/missing one defaults to avatar.
	var req signatureRequest
	_ = httpx.Decode(w, r, &req)
	if req.Kind == "" {
		req.Kind = defaultKind
	}
	folder, ok := folders[req.Kind]
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "unknown upload kind")
		return
	}

	ts := time.Now().Unix()
	// These are the params the client will send (besides file/api_key) and that
	// Cloudinary will therefore verify against the signature.
	signed := map[string]string{
		"folder":    folder,
		"timestamp": strconv.FormatInt(ts, 10),
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"cloud_name": h.cloud,
		"api_key":    h.apiKey,
		"timestamp":  ts,
		"folder":     folder,
		"signature":  h.sign(signed),
	})
}

// sign builds Cloudinary's upload signature: the params sorted by key as
// "k=v&k=v…", with the api_secret appended, hashed with SHA-1 (hex).
func (h *Handler) sign(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		fmt.Fprintf(&b, "%s=%s", k, params[k])
	}
	b.WriteString(h.apiSecret)
	sum := sha1.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}
