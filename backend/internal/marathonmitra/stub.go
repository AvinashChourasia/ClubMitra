package marathonmitra

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"strings"
)

// Stub is a development implementation of Client used when the real
// MarathonMitra API isn't configured. It lets us build and test the entire login
// flow locally without MarathonMitra running.
//
// Behavior: it accepts any email with a non-empty password (>= 4 chars) and
// returns a DETERMINISTIC fake MarathonMitra user id derived from the email — so
// the same email always maps to the same user across logins, like a real account.
// It is enabled automatically when MARATHONMITRA_API_URL is unset.
type Stub struct{}

// NewStub builds the dev stub.
func NewStub() *Stub { return &Stub{} }

// VerifyCredentials fakes MarathonMitra's verification for local development.
func (s *Stub) VerifyCredentials(_ context.Context, email, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || len(password) < 4 {
		return nil, ErrInvalidCredentials
	}
	return &User{
		ID:          fakeObjectID(email),
		Email:       email,
		DisplayName: displayNameFromEmail(email),
	}, nil
}

// fakeObjectID produces a stable 24-hex-char string (the shape of a Mongo
// ObjectId) from the email, so the dev stub mimics real id formatting.
func fakeObjectID(email string) string {
	sum := sha1.Sum([]byte(email))
	return hex.EncodeToString(sum[:])[:24]
}

// displayNameFromEmail turns "alice.runner@x.com" into "Alice Runner" for a
// friendly default name in dev.
func displayNameFromEmail(email string) string {
	local := email
	if i := strings.IndexByte(email, '@'); i > 0 {
		local = email[:i]
	}
	local = strings.NewReplacer(".", " ", "_", " ", "-", " ").Replace(local)
	return strings.Title(local) //nolint:staticcheck // Title is fine for ASCII dev names
}
