// Package marathonmitra is RunMitra's client for the MarathonMitra platform —
// the source of truth for user identity. RunMitra does NOT store passwords;
// instead it asks MarathonMitra to verify credentials, then issues its own app
// JWT keyed to the returned MarathonMitra user id.
//
// We depend on a small Client INTERFACE rather than a concrete type so we can
// run a local Stub during development (the real MarathonMitra API isn't reachable
// from our dev machine) and swap in the HTTP implementation via config in prod.
package marathonmitra

import (
	"context"
	"errors"
)

// User is the identity MarathonMitra returns. ID is a Mongo ObjectId (a 24-char
// hex string) — which is why RunMitra stores user ids as text, not uuid.
type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

// ErrInvalidCredentials is returned when MarathonMitra rejects the login. We map
// it to a 401, and deliberately keep it indistinguishable from "unknown user".
var ErrInvalidCredentials = errors.New("invalid marathonmitra credentials")

// Client verifies credentials against MarathonMitra. Later we'll add methods for
// race participations (finisher badges), e.g. Participations(ctx, userID).
type Client interface {
	// VerifyCredentials checks an email/password with MarathonMitra and returns
	// the user on success, or ErrInvalidCredentials on rejection.
	VerifyCredentials(ctx context.Context, email, password string) (*User, error)
}
