package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Account-recovery storage: password-reset and email-change codes. Both are
// short numeric codes mailed to an inbox to prove control of it. We persist only
// the SHA-256 hash, cap verification attempts, and expire fast — see the
// 00040_account_recovery migration for the security rationale.

// resetCodeTTL / emailChangeTTL: how long a mailed code stays valid. Short, both
// because a 6-digit code is low-entropy and because a real user enters it within
// a minute or two.
const (
	resetCodeTTL   = 15 * time.Minute
	emailChangeTTL = 15 * time.Minute
	// maxCodeAttempts caps wrong guesses against a single code before it's dead.
	// 1e6 combinations / 5 tries makes blind guessing hopeless within the TTL.
	maxCodeAttempts = 5
)

// ErrInvalidCode covers any unusable recovery code: wrong, expired, already
// used, or too many failed attempts. Deliberately one error so the client can't
// distinguish "no code outstanding" from "wrong code".
var ErrInvalidCode = errors.New("invalid or expired code")

// RecoveryRepository persists password-reset and email-change codes.
type RecoveryRepository struct {
	db *pgxpool.Pool
}

// NewRecoveryRepository wires the repo to the shared pool.
func NewRecoveryRepository(db *pgxpool.Pool) *RecoveryRepository {
	return &RecoveryRepository{db: db}
}

// newNumericCode returns a cryptographically-random 6-digit code as a string,
// zero-padded (so "000123" stays six chars).
func newNumericCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	// %06d zero-pads; the value is in [0, 999999].
	return pad6(n.Int64()), nil
}

func pad6(n int64) string {
	const digits = "0123456789"
	b := []byte{'0', '0', '0', '0', '0', '0'}
	for i := 5; i >= 0 && n > 0; i-- {
		b[i] = digits[n%10]
		n /= 10
	}
	return string(b)
}

// hashCode is the storage hash for a recovery code (SHA-256 hex), matching the
// approach used for refresh tokens.
func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// --- password resets ---

// CreatePasswordReset supersedes any outstanding code for the user, then stores
// a fresh one. Returns the plaintext code (to mail) — only its hash is persisted.
func (r *RecoveryRepository) CreatePasswordReset(ctx context.Context, userID string, now time.Time) (string, error) {
	code, err := newNumericCode()
	if err != nil {
		return "", err
	}
	// One outstanding code per user: mark prior unused ones used so only the
	// newest can be redeemed.
	if _, err := r.db.Exec(ctx,
		`UPDATE password_resets SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
		userID, now); err != nil {
		return "", err
	}
	if _, err := r.db.Exec(ctx,
		`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hashCode(code), now.Add(resetCodeTTL)); err != nil {
		return "", err
	}
	return code, nil
}

// RedeemPasswordReset verifies a code for the user and, on success, marks it
// used. A wrong code increments attempts; once at the cap (or expired/used) the
// code is dead and ErrInvalidCode is returned.
func (r *RecoveryRepository) RedeemPasswordReset(ctx context.Context, userID, code string, now time.Time) error {
	var id string
	var storedHash string
	var attempts int
	err := r.db.QueryRow(ctx,
		`SELECT id, code_hash, attempts FROM password_resets
		 WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2
		 ORDER BY created_at DESC LIMIT 1`,
		userID, now).Scan(&id, &storedHash, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCode
	}
	if err != nil {
		return err
	}
	if attempts >= maxCodeAttempts {
		return ErrInvalidCode
	}
	if hashCode(code) != storedHash {
		_, _ = r.db.Exec(ctx, `UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1`, id)
		return ErrInvalidCode
	}
	_, err = r.db.Exec(ctx, `UPDATE password_resets SET used_at = $2 WHERE id = $1`, id, now)
	return err
}

// --- email changes ---

// CreateEmailChange supersedes any outstanding change for the user and stores a
// fresh code bound to newEmail. Returns the plaintext code (to mail to newEmail).
func (r *RecoveryRepository) CreateEmailChange(ctx context.Context, userID, newEmail string, now time.Time) (string, error) {
	code, err := newNumericCode()
	if err != nil {
		return "", err
	}
	if _, err := r.db.Exec(ctx,
		`UPDATE email_changes SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
		userID, now); err != nil {
		return "", err
	}
	if _, err := r.db.Exec(ctx,
		`INSERT INTO email_changes (user_id, new_email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		userID, newEmail, hashCode(code), now.Add(emailChangeTTL)); err != nil {
		return "", err
	}
	return code, nil
}

// RedeemEmailChange verifies a code for the user and, on success, returns the
// claimed new email and marks the code used. Same attempt/expiry rules as resets.
func (r *RecoveryRepository) RedeemEmailChange(ctx context.Context, userID, code string, now time.Time) (string, error) {
	var id, storedHash, newEmail string
	var attempts int
	err := r.db.QueryRow(ctx,
		`SELECT id, code_hash, new_email, attempts FROM email_changes
		 WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2
		 ORDER BY created_at DESC LIMIT 1`,
		userID, now).Scan(&id, &storedHash, &newEmail, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidCode
	}
	if err != nil {
		return "", err
	}
	if attempts >= maxCodeAttempts {
		return "", ErrInvalidCode
	}
	if hashCode(code) != storedHash {
		_, _ = r.db.Exec(ctx, `UPDATE email_changes SET attempts = attempts + 1 WHERE id = $1`, id)
		return "", ErrInvalidCode
	}
	if _, err := r.db.Exec(ctx, `UPDATE email_changes SET used_at = $2 WHERE id = $1`, id, now); err != nil {
		return "", err
	}
	return newEmail, nil
}
