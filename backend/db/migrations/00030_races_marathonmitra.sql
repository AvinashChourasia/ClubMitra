-- +goose Up

-- The race calendar is fed by MarathonMitra's get-all-marathons API (their
-- submission + approval system is the gate). Synced races carry MarathonMitra's
-- id so repeat syncs upsert instead of duplicating, and have no local creator.
ALTER TABLE races
    ADD COLUMN external_id TEXT UNIQUE,
    ALTER COLUMN created_by DROP NOT NULL;

-- +goose Down
ALTER TABLE races
    DROP COLUMN external_id,
    ALTER COLUMN created_by SET NOT NULL;
