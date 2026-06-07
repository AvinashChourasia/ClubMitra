-- +goose Up

-- Expo push tokens, one (or more) per user. A token is globally unique to a
-- device install; if the same device later logs in as another user, the token
-- re-points to that user (ON CONFLICT in the upsert).
CREATE TABLE device_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,        -- ExponentPushToken[...]
    platform   TEXT,                        -- ios / android
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);

-- +goose Down
DROP TABLE IF EXISTS device_tokens;
