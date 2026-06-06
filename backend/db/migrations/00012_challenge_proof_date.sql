-- +goose Up

-- The date a proof is FOR — important for day/streak challenges, where a runner
-- submits proof of a specific day's run. Nullable: for distance challenges (or
-- when the date is parsed from a Strava link) it can be omitted.
ALTER TABLE challenge_proof ADD COLUMN proof_date DATE;

-- +goose Down
ALTER TABLE challenge_proof DROP COLUMN proof_date;
