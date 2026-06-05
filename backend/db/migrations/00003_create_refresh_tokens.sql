-- +goose Up

CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Whose token this is. ON DELETE CASCADE means: if a user is deleted, their
    -- refresh tokens are automatically removed too (no orphan rows).
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- We store the SHA-256 hash of the token, never the raw value. UNIQUE both
    -- enforces no duplicates and gives us a fast index for lookup-by-hash.
    token_hash TEXT NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    -- Set when a token is rotated or logged out. NULL = still active. Keeping a
    -- revoked row (instead of deleting) lets us detect reuse of a stolen token.
    revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- We frequently fetch all of a user's tokens (e.g. "log out everywhere"), so
-- index user_id. (token_hash is already indexed by the UNIQUE constraint.)
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- +goose Down
DROP TABLE IF EXISTS refresh_tokens;
