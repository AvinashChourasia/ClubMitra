package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AccessClaims is the payload we embed in the access-token JWT.
//
// A JWT is three base64 parts — header.payload.signature — joined by dots. The
// payload (these claims) is only base64-encoded, NOT encrypted, so anyone can
// read it. The security comes from the signature: it's computed with our secret
// key, so the server can detect any tampering. Rule: never put secrets in a JWT.
type AccessClaims struct {
	jwt.RegisteredClaims        // standard fields: exp, iat, sub, etc.
	UserID               string `json:"uid"`
}

// TokenManager issues and verifies access-token JWTs.
type TokenManager struct {
	secret    []byte
	accessTTL time.Duration
}

// NewTokenManager builds a manager from the signing secret and access TTL.
func NewTokenManager(secret string, accessTTL time.Duration) *TokenManager {
	return &TokenManager{secret: []byte(secret), accessTTL: accessTTL}
}

// NewAccessToken creates a signed JWT for the given user, valid for accessTTL.
// userID is the MarathonMitra user id (a Mongo ObjectId string).
func (m *TokenManager) NewAccessToken(userID string) (string, error) {
	now := time.Now()
	claims := AccessClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.accessTTL)),
		},
		UserID: userID,
	}
	// HS256 = symmetric signing: the same secret signs and verifies. Simple and
	// fine for a single backend. (Asymmetric RS256 matters when a different
	// service must verify tokens it can't be trusted to sign.)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// ParseAccessToken verifies a token's signature and expiry, returning the
// user ID it was issued for. Used by the auth middleware on protected routes.
func (m *TokenManager) ParseAccessToken(tokenString string) (string, error) {
	var claims AccessClaims
	_, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {
		// CRUCIAL: confirm the algorithm is what we expect. Without this check,
		// an attacker could swap in "alg: none" or a different scheme to bypass
		// signature verification — a classic JWT vulnerability.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return "", err // covers bad signature AND expiry
	}
	if claims.UserID == "" {
		return "", errors.New("token has no user id")
	}
	return claims.UserID, nil
}

// --- Refresh tokens ---
//
// Refresh tokens are NOT JWTs. They're long random strings we store server-side
// so we can revoke them. We never store the raw token: we hash it (SHA-256) and
// store only the hash, exactly like a password. If the DB leaks, the hashes are
// useless to an attacker because the raw token can't be derived from them.
// (SHA-256 is fine here — unlike passwords, these are already high-entropy
// random values, so no slow hashing is needed.)

// NewRefreshToken returns a fresh random token (to give the client) and its
// SHA-256 hash (to store in the DB).
func NewRefreshToken() (raw string, hash string, err error) {
	b := make([]byte, 32) // 256 bits of entropy — infeasible to guess
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, HashRefreshToken(raw), nil
}

// HashRefreshToken computes the storage hash for a raw refresh token. Used both
// when saving a new token and when looking one up on refresh.
func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
