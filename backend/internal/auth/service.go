package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/avinash/virtual-run-tracker/backend/internal/users"
)

// TokenPair is what we hand back to a client on register/login/refresh.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// ValidationError carries a client-safe message about bad input (400).
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// ErrInvalidCredentials means the email/password didn't match. Deliberately
// vague so it doesn't reveal whether an email exists.
var ErrInvalidCredentials = errors.New("invalid email or password")

// ErrEmailTaken / ErrPhoneTaken are returned from Register when the account
// already exists, mapped to a 409 by the handler.
var (
	ErrEmailTaken = users.ErrEmailTaken
	ErrPhoneTaken = users.ErrPhoneTaken
)

// ErrInvalidRefreshToken covers any unusable refresh token (missing, expired,
// already used, or revoked).
var ErrInvalidRefreshToken = errors.New("invalid or expired refresh token")

// minPasswordLen is the floor we enforce at registration. bcrypt itself caps
// input at 72 bytes; we reject longer passwords rather than silently truncate.
const minPasswordLen = 8
const maxPasswordLen = 72

// Service holds the auth business logic. RunMitra owns identity now: it stores a
// bcrypt password hash, verifies it on login, and issues its own JWT + rotating
// refresh token.
type Service struct {
	users      *users.Repository
	refresh    *RefreshRepository
	tokens     *TokenManager
	refreshTTL time.Duration
}

// NewService wires the service together.
func NewService(u *users.Repository, rt *RefreshRepository, tm *TokenManager, refreshTTL time.Duration) *Service {
	return &Service{users: u, refresh: rt, tokens: tm, refreshTTL: refreshTTL}
}

// RegisterParams is the full runner profile captured at sign-up. The README's
// invite-first onboarding funnels every new account through here.
type RegisterParams struct {
	Name         string
	Email        string
	Phone        string
	Password     string
	Age          *int
	TshirtSize   *string
	City         *string
	RunningLevel *string
}

// Register validates the profile, hashes the password, creates the account, and
// returns a token pair plus the created user.
func (s *Service) Register(ctx context.Context, p RegisterParams) (*TokenPair, *users.User, error) {
	p.Name = strings.TrimSpace(p.Name)
	p.Email = normalizeEmail(p.Email)
	p.Phone = strings.TrimSpace(p.Phone)

	if p.Name == "" {
		return nil, nil, ValidationError{Msg: "name is required"}
	}
	if !looksLikeEmail(p.Email) {
		return nil, nil, ValidationError{Msg: "a valid email is required"}
	}
	if len(p.Password) < minPasswordLen {
		return nil, nil, ValidationError{Msg: "password must be at least 8 characters"}
	}
	if len(p.Password) > maxPasswordLen {
		return nil, nil, ValidationError{Msg: "password must be at most 72 characters"}
	}
	// Everything except t-shirt size is required at sign-up.
	if p.Phone == "" {
		return nil, nil, ValidationError{Msg: "phone is required"}
	}
	if p.Age == nil || *p.Age <= 0 {
		return nil, nil, ValidationError{Msg: "a valid age is required"}
	}
	if p.City == nil || strings.TrimSpace(*p.City) == "" {
		return nil, nil, ValidationError{Msg: "city is required"}
	}
	if p.RunningLevel == nil || !users.ValidRunningLevels[*p.RunningLevel] {
		return nil, nil, ValidationError{Msg: "running level must be one of beginner, amateur, intermediate, advanced"}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, err
	}

	user, err := s.users.Create(ctx, users.NewUser{
		Name:         p.Name,
		Email:        p.Email,
		Phone:        p.Phone,
		PasswordHash: string(hash),
		Age:          p.Age,
		TshirtSize:   p.TshirtSize,
		City:         p.City,
		RunningLevel: p.RunningLevel,
	})
	if err != nil {
		// ErrEmailTaken / ErrPhoneTaken flow straight to the handler as a 409.
		return nil, nil, err
	}

	pair, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, nil, err
	}
	return pair, user, nil
}

// Login verifies an email/password against the stored bcrypt hash and, on
// success, returns a token pair plus the user. The same vague error covers both
// "no such email" and "wrong password" so neither is distinguishable.
func (s *Service) Login(ctx context.Context, email, password string) (*TokenPair, *users.User, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return nil, nil, ErrInvalidCredentials
	}

	user, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, users.ErrNotFound) {
			// Hash a dummy value anyway so the response time doesn't reveal
			// whether the email exists (timing-attack hardening).
			_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv"), []byte(password))
			return nil, nil, ErrInvalidCredentials
		}
		return nil, nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, nil, ErrInvalidCredentials
	}

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
// given user id.
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

// looksLikeEmail is a deliberately loose sanity check — it rejects obvious junk
// (no "@", no domain) without trying to fully validate an address (impossible in
// practice). Real verification is a future "confirm your email" step.
func looksLikeEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return false
	}
	return strings.IndexByte(email[at+1:], '.') >= 0
}
