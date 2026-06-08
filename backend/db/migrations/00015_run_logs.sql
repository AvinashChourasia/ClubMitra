-- +goose Up

-- A manually-logged run. This is the distance source that feeds the chapter
-- rolling leaderboards (daily/weekly/monthly/all-time) until Phase 3 GPS lands.
-- A run is logged in the context of one chapter the runner belongs to.
CREATE TABLE run_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id),
    chapter_id  UUID NOT NULL REFERENCES chapters(id),
    distance_km NUMERIC(6,2) NOT NULL CHECK (distance_km > 0),
    ran_on      DATE NOT NULL,
    note        TEXT,
    proof_url   TEXT,                 -- optional Strava link / screenshot URL
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- Leaderboard aggregation is "by chapter over a date range", so index that.
CREATE INDEX idx_run_logs_board ON run_logs (chapter_id, ran_on) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_logs_user ON run_logs (user_id, ran_on DESC);

-- +goose Down
DROP TABLE IF EXISTS run_logs;
