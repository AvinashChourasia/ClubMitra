-- +goose Up

-- Phase 4 — community race calendar. Anyone can list a race (title, city,
-- date, distances); everyone can browse upcoming races by city and mark
-- themselves as going. Soft-deletable by the creator.
CREATE TABLE races (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    city       TEXT NOT NULL,
    race_date  DATE NOT NULL,
    distances  TEXT NOT NULL DEFAULT '',  -- freeform: "5K · 10K · 21.1K"
    location   TEXT,                      -- venue / start point
    url        TEXT,                      -- registration / info page
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_races_date ON races (race_date) WHERE deleted_at IS NULL;

CREATE TABLE race_interests (
    race_id    UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (race_id, user_id)
);

-- +goose Down
DROP TABLE race_interests;
DROP TABLE races;
