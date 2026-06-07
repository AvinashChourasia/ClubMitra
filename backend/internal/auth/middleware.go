package auth

import (
	"net/http"
	"strings"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// RequireAuth is HTTP middleware that protects routes: it requires a valid
// access token and, on success, stashes the caller's user ID in the request
// context for downstream handlers to read via httpx.UserIDFromContext.
//
// It's a method on TokenManager because verifying the token is exactly what the
// token manager does — no extra dependency needed. Use it like:
//
//	r.Use(tokenMgr.RequireAuth)
func (m *TokenManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "missing or malformed Authorization header")
			return
		}
		userID, err := m.ParseAccessToken(token)
		if err != nil {
			// Covers a bad signature, wrong algorithm, or an expired token. We
			// return the same vague message for all so we don't hint at why.
			httpx.Error(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		// Hand the verified identity to the next handler via the context.
		next.ServeHTTP(w, r.WithContext(httpx.ContextWithUserID(r.Context(), userID)))
	})
}

// bearerToken pulls the token out of an "Authorization: Bearer <token>" header.
// The scheme is compared case-insensitively per the HTTP spec.
func bearerToken(header string) (string, bool) {
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}
	return token, true
}
