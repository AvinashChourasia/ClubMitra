-- +goose Up

-- Trust score removed from the product (June 2026): GPS-verified runs made the
-- credibility metric redundant. Drops the per-user score/tier and the audit
-- log. challenge_proof.trust_weight stays — it's evidence weighting for proof
-- credit, not trust scoring, and the proof flow still writes it.
DROP TABLE IF EXISTS trust_score_log;
ALTER TABLE users
    DROP COLUMN IF EXISTS trust_score,
    DROP COLUMN IF EXISTS trust_tier;

-- +goose Down
ALTER TABLE users
    ADD COLUMN trust_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    ADD COLUMN trust_tier  TEXT NOT NULL DEFAULT 'basic';
CREATE TABLE trust_score_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_score    NUMERIC(5,2),
    new_score    NUMERIC(5,2) NOT NULL,
    reason       TEXT NOT NULL,
    triggered_by TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trust_score_log_user ON trust_score_log (user_id, created_at DESC);
