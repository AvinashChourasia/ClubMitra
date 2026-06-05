package auth_test

// INTEGRATION test for the standalone auth flow (register -> login -> refresh
// rotation + theft detection -> logout). It talks to the real Postgres from
// docker-compose. Run with:  make test
// Auto-skips if DATABASE_URL isn't set.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/avinash/virtual-run-tracker/backend/internal/auth"
	"github.com/avinash/virtual-run-tracker/backend/internal/database"
	"github.com/avinash/virtual-run-tracker/backend/internal/users"
)

func TestAuthFlow(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}

	ctx := context.Background()
	pool, err := database.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	userRepo := users.NewRepository(pool)
	svc := auth.NewService(
		userRepo,
		auth.NewRefreshRepository(pool),
		auth.NewTokenManager("test-access-secret", 15*time.Minute),
		30*24*time.Hour,
	)

	// Unique email per run so registration never collides with a prior run.
	email := "itest_" + time.Now().Format("20060102150405.000000") + "@example.com"
	const password = "secret-password"

	// --- Register a new account ---
	pair, user, err := svc.Register(ctx, auth.RegisterParams{
		Name:     "Integration Tester",
		Email:    "  " + email + "  ", // verify trimming/normalisation
		Password: password,
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if pair.AccessToken == "" || pair.RefreshToken == "" {
		t.Fatal("register: expected non-empty tokens")
	}
	if user.Email != email {
		t.Fatalf("register: email not normalised: got %q want %q", user.Email, email)
	}
	if user.ID == "" {
		t.Fatal("register: expected a generated user id")
	}
	// Clean up this user (cascades to refresh_tokens) at the end.
	defer func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id = $1", user.ID)
	}()

	// --- Registering the same email again is rejected ---
	if _, _, err := svc.Register(ctx, auth.RegisterParams{Name: "Dup", Email: email, Password: password}); !errors.Is(err, auth.ErrEmailTaken) {
		t.Fatalf("duplicate register: want ErrEmailTaken, got %v", err)
	}

	// --- Login maps to the SAME account (stable identity) ---
	_, user2, err := svc.Login(ctx, email, password)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if user2.ID != user.ID {
		t.Fatalf("same email should map to same id: %q vs %q", user2.ID, user.ID)
	}

	// --- Wrong password is rejected ---
	if _, _, err := svc.Login(ctx, email, "wrong-password"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("bad credentials: want ErrInvalidCredentials, got %v", err)
	}

	// --- Access token verifies and carries the right user id ---
	tm := auth.NewTokenManager("test-access-secret", 15*time.Minute)
	gotID, err := tm.ParseAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("parse access token: %v", err)
	}
	if gotID != user.ID {
		t.Fatalf("access token uid: got %v want %v", gotID, user.ID)
	}
	// A token signed with a different secret must NOT verify.
	wrongTM := auth.NewTokenManager("different-secret", 15*time.Minute)
	if _, err := wrongTM.ParseAccessToken(pair.AccessToken); err == nil {
		t.Fatal("access token verified under wrong secret — signature not checked!")
	}

	// --- Refresh rotation + theft detection ---
	r0 := pair.RefreshToken
	rot1, err := svc.Refresh(ctx, r0)
	if err != nil {
		t.Fatalf("refresh r0: %v", err)
	}
	if rot1.RefreshToken == r0 {
		t.Fatal("refresh did not rotate the token")
	}
	r2 := rot1.RefreshToken
	// Replaying the already-rotated r0 must revoke the whole family.
	if _, err := svc.Refresh(ctx, r0); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("replay r0: want ErrInvalidRefreshToken, got %v", err)
	}
	if _, err := svc.Refresh(ctx, r2); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("r2 after theft: want ErrInvalidRefreshToken, got %v", err)
	}

	// --- Logout revokes the refresh token ---
	lpair, _, err := svc.Login(ctx, email, password)
	if err != nil {
		t.Fatalf("login before logout: %v", err)
	}
	if err := svc.Logout(ctx, lpair.RefreshToken); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := svc.Refresh(ctx, lpair.RefreshToken); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("refresh after logout: want ErrInvalidRefreshToken, got %v", err)
	}
}
