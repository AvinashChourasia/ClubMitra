-- +goose Up

-- A runner's self-reported ability, captured at sign-up. Nullable at the column
-- level (older rows predate it), but required by the register API going forward.
-- The CHECK keeps the stored values to a known set.
ALTER TABLE users ADD COLUMN running_level TEXT
    CHECK (running_level IN ('beginner', 'amateur', 'intermediate', 'advanced'));

-- +goose Down
ALTER TABLE users DROP COLUMN running_level;
