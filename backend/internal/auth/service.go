package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/avinash/virtual-run-tracker/backend/internal/marathonmitra"
	"github.com/avinash/virtual-run-tracker/backend/internal/users"
)

// TokenPair is what we hand back to a client on login/refresh.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// ValidationError carries a client-safe message about bad input (400).
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// ErrInvalidCredentials means MarathonMitra rejected the login. Deliberately
// vague so it doesn't reveal whether an email exists.
var ErrInvalidCredentials = errors.New("invalid email or password")

// ErrInvalidRefreshToken covers any unusable refresh token (missing, expired,
// already used, or revoked).
var ErrInvalidRefreshToken = errors.New("invalid or expired refresh token")

// Service holds the auth business logic. Identity is verified by MarathonMitra
// (mm); RunMitra then issues its OWN app JWT + refresh token keyed to the
// MarathonMitra user id, and caches the profile locally (users).
type Service struct {
	mm         marathonmitra.Client
	users      *users.Repository
	refresh    *RefreshRepository
	tokens     *TokenManager
	refreshTTL time.Duration
}

// NewService wires the service together.
func NewService(mm marathonmitra.Client, u *users.Repository, rt *RefreshRepository, tm *TokenManager, refreshTTL time.Duration) *Service {
	return &Service{mm: mm, users: u, refresh: rt, tokens: tm, refreshTTL: refreshTTL}
}

// Login verifies credentials against MarathonMitra, refreshes the local profile
// cache, and returns a RunMitra token pair. RunMitra never sees a stored
// password — MarathonMitra is the identity authority.
func (s *Service) Login(ctx context.Context, email, password string) (*TokenPair, *users.User, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return nil, nil, ErrInvalidCredentials
	}

	// 1. Ask MarathonMitra to verify. It returns the canonical identity.
	mmUser, err := s.mm.VerifyCredentials(ctx, email, password)
	if err != nil {
		if errors.Is(err, marathonmitra.ErrInvalidCredentials) {
			return nil, nil, ErrInvalidCredentials
		}
		return nil, nil, err // an upstream/transport problem -> 500
	}

	// 2. Mirror the identity into our local profile cache (used to label runs
	//    and leaderboards). Keyed by the MarathonMitra user id.
	user, err := s.users.Upsert(ctx, mmUser.ID, mmUser.Email, mmUser.DisplayName)
	if err != nil {
		return nil, nil, err
	}

	// 3. Issue RunMitra's own tokens.
	pair, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, nil, err
	}
	return pair, user, nil
}

// Refresh exchanges a valid refresh token for a NEW token pair, rotating the
// refresh token (the old one is revoked, a new one issued). Rotation lets us
// detect theft: if a token that was already rotated is presented again, two
// parties hold the same token — so we revoke the whole family as a precaution.
func (s *Service) Refresh(ctx context.Context, rawRefreshToken string) (*TokenPair, error) {
	stored, err := s.refresh.GetByHash(ctx, HashRefreshToken(rawRefreshToken))
	if err != nil {
		if errors.Is(err, ErrRefreshNotFound) {
			return nil, ErrInvalidRefreshToken
		}
		return nil, err
	}

	if !stored.IsActive() {
		// If the token was explicitly revoked (not merely expired), its presence
		// here means someone is replaying a used/stolen token. Defensively kill
		// every token for this user, forcing a fresh login everywhere.
		if stored.RevokedAt != nil {
			_ = s.refresh.RevokeAllForUser(ctx, stored.UserID)
		}
		return nil, ErrInvalidRefreshToken
	}

	// Rotate: revoke the presented token before issuing the replacement.
	if err := s.refresh.Revoke(ctx, stored.ID); err != nil {
		return nil, err
	}

	// Issue fresh tokens for the same user id (no MarathonMitra call needed — the
	// refresh token itself is the proof of a prior successful login).
	return s.issueTokens(ctx, stored.UserID)
}

// Logout revokes the given refresh token. We don't error on an unknown token —
// the end state (that token can't be used) is the same either way.
func (s *Service) Logout(ctx context.Context, rawRefreshToken string) error {
	stored, err := s.refresh.GetByHash(ctx, HashRefreshToken(rawRefreshToken))
	if err != nil {
		if errors.Is(err, ErrRefreshNotFound) {
			return nil
		}
		return err
	}
	return s.refresh.Revoke(ctx, stored.ID)
}

// issueTokens mints a new access token and a new (stored) refresh token for the
// given MarathonMitra user id.
func (s *Service) issueTokens(ctx context.Context, userID string) (*TokenPair, error) {
	access, err := s.tokens.NewAccessToken(userID)
	if err != nil {
		return nil, err
	}
	raw, hash, err := NewRefreshToken()
	if err != nil {
		return nil, err
	}
	if err := s.refresh.Store(ctx, userID, hash, time.Now().Add(s.refreshTTL)); err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: access, RefreshToken: raw}, nil
}

// --- helpers ---

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
