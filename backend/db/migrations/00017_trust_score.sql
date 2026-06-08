-- +goose Up

-- Phase 2 — Trust Score. A per-runner credibility metric (0–100, starts at 50)
-- that decides whether activity proof is auto-approved or queued for review.
-- Computed from: proof submission rate (30%), approval rate (40%), account age
-- (30%). Tier: <50 basic, 50–79 trusted, 80+ verified.
ALTER TABLE users
    ADD COLUMN trust_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    ADD COLUMN trust_tier  TEXT NOT NULL DEFAULT 'basic';  -- basic|trusted|verified

-- Proof gains a submission method (sets the base trust weight applied to
-- leaderboard scoring) and the GPS trace slot used from Phase 3 onward.
ALTER TABLE challenge_proof
    ADD COLUMN submission_method TEXT NOT NULL DEFAULT 'screenshot', -- manual|screenshot|strava|gpx
    ADD COLUMN gpx_url           TEXT,
    ADD COLUMN trust_weight      NUMERIC(3,2);  -- manual .70, screenshot .85, strava 1.00, gpx 1.10

-- Audit trail: one row per trust-score change, so a score is always explainable.
CREATE TABLE trust_score_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_score    NUMERIC(5,2),
    new_score    NUMERIC(5,2) NOT NULL,
    reason       TEXT NOT NULL,  -- 'activity_approved'|'activity_rejected'|'manual_adjust'
    triggered_by TEXT,           -- proof/activity id, or an admin user id
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trust_score_log_user ON trust_score_log (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS trust_score_log;
ALTER TABLE challenge_proof
    DROP COLUMN submission_method,
    DROP COLUMN gpx_url,
    DROP COLUMN trust_weight;
ALTER TABLE users
    DROP COLUMN trust_score,
    DROP COLUMN trust_tier;
