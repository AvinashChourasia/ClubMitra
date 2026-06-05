-- +goose Up

-- Reshape the solo-tracker challenge model into the club model: typed goals
-- (distance / days / streak), visibility scoping (public / chapter / city / org),
-- individual OR club participation, and Phase 1 manual proof (Strava link /
-- screenshot) verified by an admin — the stand-in for GPS auto-credit until
-- Phase 3.

-- 1. challenges: rename to the doc's vocabulary + add the club fields.
ALTER TABLE challenges RENAME COLUMN name TO title;
ALTER TABLE challenges RENAME COLUMN starts_at TO start_date;
ALTER TABLE challenges RENAME COLUMN ends_at TO end_date;
ALTER TABLE challenges DROP COLUMN target_distance_m;
ALTER TABLE challenges
    ADD COLUMN org_id      UUID REFERENCES organisations(id),
    ADD COLUMN chapter_id  UUID REFERENCES chapters(id),
    ADD COLUMN banner      TEXT,
    ADD COLUMN type        TEXT NOT NULL DEFAULT 'distance'
               CHECK (type IN ('distance', 'days', 'streak')),
    ADD COLUMN visibility  TEXT NOT NULL DEFAULT 'public'
               CHECK (visibility IN ('public', 'chapter', 'city', 'org')),
    ADD COLUMN city        TEXT,
    ADD COLUMN target_km   NUMERIC(8,2),
    ADD COLUMN target_days INT,
    ADD COLUMN allow_teams BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN deleted_at  TIMESTAMPTZ;

CREATE TRIGGER challenges_set_updated_at
    BEFORE UPDATE ON challenges
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. challenge_members -> challenge_participants: a participant is an individual
--    (user_id) OR a club (chapter_id). Progress is tracked per the goal type.
ALTER TABLE challenge_members RENAME TO challenge_participants;
-- Drop the existing primary key by whatever it's named (a table rename does not
-- rename its constraints, so the name can vary across migrate cycles).
-- +goose StatementBegin
DO $$
DECLARE pk text;
BEGIN
    SELECT conname INTO pk FROM pg_constraint
    WHERE conrelid = 'challenge_participants'::regclass AND contype = 'p';
    IF pk IS NOT NULL THEN
        EXECUTE format('ALTER TABLE challenge_participants DROP CONSTRAINT %I', pk);
    END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE challenge_participants
    ADD COLUMN id             UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN chapter_id     UUID REFERENCES chapters(id),
    ADD COLUMN progress_km    NUMERIC(8,2) NOT NULL DEFAULT 0,
    ADD COLUMN progress_days  INT NOT NULL DEFAULT 0,
    ADD COLUMN current_streak INT NOT NULL DEFAULT 0,
    ADD COLUMN deleted_at     TIMESTAMPTZ;
ALTER TABLE challenge_participants DROP COLUMN progress_distance_m;
ALTER TABLE challenge_participants ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE challenge_participants ADD PRIMARY KEY (id);

-- One participation per (challenge, individual) and per (challenge, club).
CREATE UNIQUE INDEX uq_participant_user
    ON challenge_participants (challenge_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_participant_chapter
    ON challenge_participants (challenge_id, chapter_id) WHERE chapter_id IS NOT NULL;

-- 3. challenge_proof: Phase 1 manual evidence, verified by an admin.
CREATE TABLE challenge_proof (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id   UUID NOT NULL REFERENCES challenges(id),
    user_id        TEXT NOT NULL REFERENCES users(id),
    strava_link    TEXT,
    screenshot_url TEXT,
    km_claimed     NUMERIC(6,2),
    verified       BOOLEAN NOT NULL DEFAULT false,
    verified_by    TEXT REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_challenge_proof_challenge ON challenge_proof (challenge_id);

-- +goose Down
DROP TABLE IF EXISTS challenge_proof;

DROP INDEX IF EXISTS uq_participant_user;
DROP INDEX IF EXISTS uq_participant_chapter;
ALTER TABLE challenge_participants ALTER COLUMN user_id SET NOT NULL;
-- +goose StatementBegin
DO $$
DECLARE pk text;
BEGIN
    SELECT conname INTO pk FROM pg_constraint
    WHERE conrelid = 'challenge_participants'::regclass AND contype = 'p';
    IF pk IS NOT NULL THEN
        EXECUTE format('ALTER TABLE challenge_participants DROP CONSTRAINT %I', pk);
    END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE challenge_participants
    ADD COLUMN progress_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE challenge_participants
    DROP COLUMN id,
    DROP COLUMN chapter_id,
    DROP COLUMN progress_km,
    DROP COLUMN progress_days,
    DROP COLUMN current_streak,
    DROP COLUMN deleted_at;
-- Rename back FIRST so the re-created primary key is named challenge_members_pkey
-- (matching the original), keeping the schema round-trippable.
ALTER TABLE challenge_participants RENAME TO challenge_members;
ALTER TABLE challenge_members ADD PRIMARY KEY (challenge_id, user_id);

DROP TRIGGER IF EXISTS challenges_set_updated_at ON challenges;
ALTER TABLE challenges
    DROP COLUMN org_id, DROP COLUMN chapter_id, DROP COLUMN banner,
    DROP COLUMN type, DROP COLUMN visibility, DROP COLUMN city,
    DROP COLUMN target_km, DROP COLUMN target_days, DROP COLUMN allow_teams,
    DROP COLUMN updated_at, DROP COLUMN deleted_at;
ALTER TABLE challenges ADD COLUMN target_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE challenges RENAME COLUMN end_date TO ends_at;
ALTER TABLE challenges RENAME COLUMN start_date TO starts_at;
ALTER TABLE challenges RENAME COLUMN title TO name;
