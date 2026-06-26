package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/avinash/clubmitra/backend/internal/email"
	"github.com/avinash/clubmitra/backend/internal/users"
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

// Service holds the auth business logic. ClubMitra owns identity now: it stores a
// bcrypt password hash, verifies it on login, and issues its own JWT + rotating
// refresh token.
type Service struct {
	users      *users.Repository
	refresh    *RefreshRepository
	tokens     *TokenManager
	refreshTTL time.Duration
	recovery   *RecoveryRepository
	mailer     email.Sender
	now        func() time.Time // injectable clock; defaults to time.Now
}

// NewService wires the service together. recovery + mailer power the account-
// recovery flows (forgot-password, change-email); when mailer is unconfigured
// those flows return email.ErrNotConfigured (a 503), staying dormant.
func NewService(u *users.Repository, rt *RefreshRepository, tm *TokenManager, refreshTTL time.Duration, rec *RecoveryRepository, mailer email.Sender) *Service {
	return &Service{
		users:      u,
		refresh:    rt,
		tokens:     tm,
		refreshTTL: refreshTTL,
		recovery:   rec,
		mailer:     mailer,
		now:        time.Now,
	}
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

// ChangePassword verifies the caller's current password and sets a new one. The
// current session stays valid (we don't revoke tokens here) — the user chose to
// change it while authenticated. Returns ErrInvalidCredentials if old is wrong.
func (s *Service) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	if len(newPassword) < minPasswordLen {
		return ValidationError{Msg: "password must be at least 8 characters"}
	}
	if len(newPassword) > maxPasswordLen {
		return ValidationError{Msg: "password must be at most 72 characters"}
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)) != nil {
		return ErrInvalidCredentials
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.users.UpdatePasswordHash(ctx, userID, string(hash))
}

// RequestPasswordReset mails a one-time code to the account's email so a
// locked-out user can reset their password. It is intentionally non-enumerating:
// an unknown email returns nil (no row written, no mail sent) so callers can't
// probe which addresses have accounts. Returns email.ErrNotConfigured (→ 503)
// when no mail provider is set, so the flow stays dormant until then.
func (s *Service) RequestPasswordReset(ctx context.Context, rawEmail string) error {
	if !s.mailer.Configured() {
		return email.ErrNotConfigured
	}
	addr := normalizeEmail(rawEmail)
	user, err := s.users.GetByEmail(ctx, addr)
	if err != nil {
		if errors.Is(err, users.ErrNotFound) {
			return nil // silent: don't reveal whether the email exists
		}
		return err
	}
	code, err := s.recovery.CreatePasswordReset(ctx, user.ID, s.now())
	if err != nil {
		return err
	}
	subject := "Your ClubMitra password reset code"
	text := "Your ClubMitra password reset code is " + code + ".\n\n" +
		"It expires in 15 minutes. If you didn't request this, you can ignore this email — your password stays unchanged."
	return s.mailer.Send(ctx, user.Email, subject, text, "")
}

// ResetPassword redeems a reset code and sets a new password. A successful reset
// revokes all of the user's refresh tokens — a forced sign-out everywhere is the
// safe assumption when control of the password changes. Wrong/expired/used codes
// (and unknown emails) all return ErrInvalidCode, indistinguishably.
func (s *Service) ResetPassword(ctx context.Context, rawEmail, code, newPassword string) error {
	if len(newPassword) < minPasswordLen {
		return ValidationError{Msg: "password must be at least 8 characters"}
	}
	if len(newPassword) > maxPasswordLen {
		return ValidationError{Msg: "password must be at most 72 characters"}
	}
	user, err := s.users.GetByEmail(ctx, normalizeEmail(rawEmail))
	if err != nil {
		if errors.Is(err, users.ErrNotFound) {
			return ErrInvalidCode
		}
		return err
	}
	if err := s.recovery.RedeemPasswordReset(ctx, user.ID, code, s.now()); err != nil {
		return err // ErrInvalidCode or an unexpected DB error
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePasswordHash(ctx, user.ID, string(hash)); err != nil {
		return err
	}
	// Best-effort: kill other sessions. A failure here doesn't undo the reset.
	_ = s.refresh.RevokeAllForUser(ctx, user.ID)
	return nil
}

// RequestEmailChange mails a verification code to the NEW address to prove the
// caller controls it. The change isn't applied until the code is confirmed.
// Returns email.ErrNotConfigured (→ 503) when mail is unconfigured, ErrEmailTaken
// if the address already belongs to an account.
func (s *Service) RequestEmailChange(ctx context.Context, userID, rawNewEmail string) error {
	if !s.mailer.Configured() {
		return email.ErrNotConfigured
	}
	newEmail := normalizeEmail(rawNewEmail)
	if !looksLikeEmail(newEmail) {
		return ValidationError{Msg: "a valid email is required"}
	}
	current, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return err
	}
	if normalizeEmail(current.Email) == newEmail {
		return ValidationError{Msg: "that's already your email"}
	}
	// Reject up front if the address is taken (the final UPDATE re-checks too,
	// covering the race where someone claims it between request and confirm).
	if _, err := s.users.GetByEmail(ctx, newEmail); err == nil {
		return ErrEmailTaken
	} else if !errors.Is(err, users.ErrNotFound) {
		return err
	}
	code, err := s.recovery.CreateEmailChange(ctx, userID, newEmail, s.now())
	if err != nil {
		return err
	}
	subject := "Confirm your new ClubMitra email"
	text := "Use this code to confirm your new ClubMitra email address: " + code + ".\n\n" +
		"It expires in 15 minutes. If you didn't request this, you can ignore this email."
	return s.mailer.Send(ctx, newEmail, subject, text, "")
}

// ConfirmEmailChange redeems an email-change code and applies the new address,
// returning it. ErrInvalidCode for a bad/expired code; ErrEmailTaken if the
// address was claimed by someone else in the meantime.
func (s *Service) ConfirmEmailChange(ctx context.Context, userID, code string) (string, error) {
	newEmail, err := s.recovery.RedeemEmailChange(ctx, userID, code, s.now())
	if err != nil {
		return "", err
	}
	if err := s.users.UpdateEmail(ctx, userID, newEmail); err != nil {
		return "", err
	}
	return newEmail, nil
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
		// Revoked (logged out) or past its 30-day expiry → genuinely dead.
		return nil, ErrInvalidRefreshToken
	}

	// Non-rotating refresh. We deliberately do NOT rotate the refresh token on
	// every use anymore: rotation's lost-write race against a mobile client +
	// a sleeping free-tier backend (app killed before it stored the rotated
	// token → next launch presents the now-revoked one) was nuking live
	// sessions and dumping runners to the login screen ("logged out, data
	// gone"). Instead we hand back a fresh access token, keep the same refresh
	// token, and SLIDE its expiry — so an active runner stays logged in
	// indefinitely, while logout (revoke) still kills it instantly and the
	// 30-day idle cap still applies. A leaked token is usable until that cap;
	// an acceptable trade for a club app, and revisitable with a tracked
	// successor column if the threat model ever demands rotation back.
	access, err := s.tokens.NewAccessToken(stored.UserID)
	if err != nil {
		return nil, err
	}
	// Best-effort expiry slide; a failed extend just shortens this token's life,
	// never breaks the refresh.
	_ = s.refresh.ExtendExpiry(ctx, stored.ID, time.Now().Add(s.refreshTTL))
	return &TokenPair{AccessToken: access, RefreshToken: rawRefreshToken}, nil
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
