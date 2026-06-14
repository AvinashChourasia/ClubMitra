-- +goose Up

-- Phase 5 push suite. Two background jobs need a little state:
--  • last_reengaged_at throttles the "we miss you" nudge to lapsed runners so
--    nobody gets pinged more than once a fortnight.
--  • notification_jobs dedupes the weekly club recap so it fires exactly once
--    per ISO week even across restarts or multiple API instances.
ALTER TABLE users ADD COLUMN last_reengaged_at TIMESTAMPTZ;

CREATE TABLE notification_jobs (
    job        TEXT NOT NULL,
    period_key TEXT NOT NULL,
    ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job, period_key)
);

-- +goose Down
DROP TABLE IF EXISTS notification_jobs;
ALTER TABLE users DROP COLUMN last_reengaged_at;
