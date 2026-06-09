-- +goose Up

-- Phase 4 — GPS runs feed the club leaderboards. A recorded activity credits a
-- run_log for each of the runner's active clubs, tagged source='gps' (vs the
-- self-reported 'manual' logs) and linked to the activity. The unique index
-- makes that crediting idempotent — re-processing an activity never double-counts.
ALTER TABLE run_logs
    ADD COLUMN source      TEXT NOT NULL DEFAULT 'manual',  -- manual | gps
    ADD COLUMN activity_id UUID REFERENCES activities(id);

CREATE UNIQUE INDEX uq_run_logs_activity ON run_logs (chapter_id, activity_id) WHERE activity_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS uq_run_logs_activity;
ALTER TABLE run_logs DROP COLUMN source, DROP COLUMN activity_id;
