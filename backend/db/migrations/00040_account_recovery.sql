-- +goose Up

-- Account recovery (Phase 3): forgot-password reset + verified email change.
-- Both prove control of an inbox with a short numeric CODE (not a deep link —
-- the app is APK-distributed, so a 6-digit code the user types is the simplest
-- mobile flow). DORMANT until SENDGRID_API_KEY/EMAIL_FROM are configured: the
-- request endpoints 503 and no row is ever written, so the app ships safely
-- without email and the flows go live the moment a key is injected.
--
-- We store only the SHA-256 hash of the code (never the code itself), cap
-- verification attempts, and expire fast — a 6-digit code is low-entropy, so
-- the short TTL + attempt cap + the existing /auth IP rate-limit are what make
-- it safe. A new request supersedes any prior unused code for that user.

CREATE TABLE password_resets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,                       -- SHA-256 hex of the 6-digit code
    attempts    INT NOT NULL DEFAULT 0,              -- failed verifications; locked at the cap
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,                         -- set once redeemed; a used code can't be reused
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id, created_at DESC);

CREATE TABLE email_changes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    new_email   CITEXT NOT NULL,                     -- the address being claimed (case-insensitive, like users.email)
    code_hash   TEXT NOT NULL,                       -- code is mailed to new_email to prove control of it
    attempts    INT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_changes_user ON email_changes (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS email_changes;
DROP TABLE IF EXISTS password_resets;
