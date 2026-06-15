-- +goose Up

-- Activity Sync (Phase 3, P0): pull runs from Strava (and later Garmin) so they
-- credit challenges/leaderboards/badges automatically — the #1 survey ask.
-- Tokens are stored ENCRYPTED (AES-GCM, key derived from JWT_SECRET).
CREATE TABLE oauth_connections (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,              -- 'strava'
    athlete_id     TEXT,                       -- the provider's user id
    access_token   TEXT NOT NULL,              -- encrypted
    refresh_token  TEXT NOT NULL,              -- encrypted
    expires_at     TIMESTAMPTZ NOT NULL,       -- access-token expiry
    scope          TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider)
);

-- De-dupe ledger: one row per imported external activity, so re-syncs are
-- idempotent and a run already pulled is never credited twice.
CREATE TABLE external_activities (
    provider    TEXT NOT NULL,
    external_id TEXT NOT NULL,                 -- the provider's activity id
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, external_id)
);
CREATE INDEX idx_external_activities_user ON external_activities (user_id);

-- +goose Down
DROP TABLE IF EXISTS external_activities;
DROP TABLE IF EXISTS oauth_connections;
