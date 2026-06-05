package httpx

import "context"

// This file holds helpers for reading per-request values out of the context.
//
// Why a custom unexported key type instead of a plain string?
// context.WithValue uses the key for equality lookups across ALL packages. If
// everyone used string keys, two packages could pick the same string and
// silently clobber each other. An unexported type defined here means our key is
// unique in the whole program and no other package can construct or collide
// with it.
type contextKey int

const userIDKey contextKey = iota

// ContextWithUserID returns a copy of ctx carrying the authenticated user's ID
// (a MarathonMitra user id string). The auth middleware calls this after it
// verifies an access token.
func ContextWithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}

// UserIDFromContext returns the authenticated user's ID, or ok=false if the
// request didn't pass through the auth middleware. Protected handlers use this
// to learn "who is calling" without re-parsing the token.
func UserIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDKey).(string)
	return id, ok
}
