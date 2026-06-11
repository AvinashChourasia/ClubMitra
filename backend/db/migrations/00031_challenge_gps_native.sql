-- +goose Up

-- Challenges are now fully GPS-native: every run recorded (or GPX-imported)
-- credits distance/days/streak progress automatically, so the Phase-1 manual
-- proof flow (Strava links / screenshots + admin review) is retired.
DROP TABLE IF EXISTS challenge_proof;

-- +goose Down
-- Recreate the table as it stood (00009 + 00012 proof_date + 00017 method/weight).
CREATE TABLE challenge_proof (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id      UUID NOT NULL REFERENCES challenges(id),
    user_id           TEXT NOT NULL REFERENCES users(id),
    submission_method TEXT NOT NULL DEFAULT 'manual',
    strava_link       TEXT,
    screenshot_url    TEXT,
    gpx_url           TEXT,
    km_claimed        NUMERIC(6,2),
    proof_date        DATE,
    trust_weight      NUMERIC(4,2),
    verified          BOOLEAN NOT NULL DEFAULT false,
    verified_by       TEXT REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_challenge_proof_challenge ON challenge_proof (challenge_id);
