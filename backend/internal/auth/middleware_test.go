package auth_test

// Unit test for the auth middleware. It uses net/http/httptest, so it needs NO
// database and NO running server — fast and deterministic. We test the
// security-critical behavior: only a validly-signed, unexpired token gets
// through, and the verified user ID reaches the handler.

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	

	"github.com/avinash/virtual-run-tracker/backend/internal/auth"
	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
)

func TestRequireAuth(t *testing.T) {
	tm := auth.NewTokenManager("test-secret", 15*time.Minute)
	userID := "507f1f77bcf86cd799439011"
	validToken, err := tm.NewAccessToken(userID)
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}

	// The protected handler records whether it ran and what user id it saw.
	var reached bool
	var gotID string
	protected := tm.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		id, ok := httpx.UserIDFromContext(r.Context())
		if !ok {
			t.Error("expected user id in context")
		}
		gotID = id
		w.WriteHeader(http.StatusOK)
	}))

	// A token signed with a DIFFERENT secret — must be rejected.
	forged, _ := auth.NewTokenManager("other-secret", 15*time.Minute).NewAccessToken(userID)
	// An already-expired token (negative TTL) — must be rejected.
	expired, _ := auth.NewTokenManager("test-secret", -time.Minute).NewAccessToken(userID)

	cases := []struct {
		name        string
		header      string
		wantStatus  int
		wantReached bool
	}{
		{"valid token", "Bearer " + validToken, http.StatusOK, true},
		{"no header", "", http.StatusUnauthorized, false},
		{"wrong scheme", "Basic " + validToken, http.StatusUnauthorized, false},
		{"empty bearer", "Bearer ", http.StatusUnauthorized, false},
		{"garbage token", "Bearer not.a.real.jwt", http.StatusUnauthorized, false},
		{"forged signature", "Bearer " + forged, http.StatusUnauthorized, false},
		{"expired token", "Bearer " + expired, http.StatusUnauthorized, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reached = false
			req := httptest.NewRequest(http.MethodGet, "/users/me", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			protected.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d want %d", rec.Code, tc.wantStatus)
			}
			if reached != tc.wantReached {
				t.Errorf("handler reached: got %v want %v", reached, tc.wantReached)
			}
		})
	}

	// The valid request must have propagated the correct user id.
	if gotID != userID {
		t.Errorf("context user id: got %v want %v", gotID, userID)
	}
}
