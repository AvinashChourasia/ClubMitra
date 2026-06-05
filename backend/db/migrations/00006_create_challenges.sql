-- +goose Up

-- A challenge is a virtual goal over a time window, e.g. "Run 50 km in June".
CREATE TABLE challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    -- The goal distance in meters (e.g. 50 km = 50000). Progress is measured
    -- against this. Stored in meters to match activities.distance_m.
    target_distance_m DOUBLE PRECISION NOT NULL,

    -- The active window. Only runs whose started_at falls in [start, end) count.
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A challenge must end after it starts.
    CONSTRAINT challenge_window_valid CHECK (ends_at > starts_at)
);

-- Browsing usually filters by "currently active", so index the window.
CREATE INDEX idx_challenges_window ON challenges (starts_at, ends_at);

-- Who has joined which challenge, plus their progress. progress_distance_m is a
-- denormalized running total: the DURABLE source of truth for the leaderboard
-- (Redis holds a fast copy that can be rebuilt from this column).
CREATE TABLE challenge_members (
    challenge_id      UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    progress_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One membership per (challenge, user); also the natural lookup key.
    PRIMARY KEY (challenge_id, user_id)
);

-- "Which challenges has this user joined?" — index the user side too.
CREATE INDEX idx_challenge_members_user ON challenge_members (user_id);

-- +goose Down
DROP TABLE IF EXISTS challenge_members;
DROP TABLE IF EXISTS challenges;
