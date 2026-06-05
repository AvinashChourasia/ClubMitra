-- +goose Up

-- Attendance: a chapter admin schedules a group run; members check in after it.
-- This is the Phase 1 "did you show up" record — distinct from a GPS `activity`
-- (Phase 3), which is an individually recorded track.

CREATE TABLE runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID NOT NULL REFERENCES chapters(id),
    created_by      TEXT NOT NULL REFERENCES users(id),
    title           TEXT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    location        TEXT,
    location_lat    NUMERIC,
    location_lng    NUMERIC,
    distance_target NUMERIC(6,2),   -- km, optional
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- A chapter's runs are listed by date, so index (chapter, scheduled_at).
CREATE INDEX idx_runs_chapter_scheduled ON runs (chapter_id, scheduled_at DESC);

CREATE TABLE run_attendance (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID NOT NULL REFERENCES runs(id),
    user_id       TEXT NOT NULL REFERENCES users(id),
    -- Denormalised from the run so "a member's attendance across a chapter" is a
    -- single-table query without joining back through runs.
    chapter_id    UUID NOT NULL REFERENCES chapters(id),
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL = the member checked themselves in; set = an admin marked them.
    marked_by     TEXT REFERENCES users(id),
    notes         TEXT,
    deleted_at    TIMESTAMPTZ,

    -- One attendance row per (run, user).
    UNIQUE (run_id, user_id)
);

CREATE INDEX idx_run_attendance_run ON run_attendance (run_id);
CREATE INDEX idx_run_attendance_user ON run_attendance (user_id, checked_in_at DESC);

-- +goose Down
DROP TABLE IF EXISTS run_attendance;
DROP TABLE IF EXISTS runs;
