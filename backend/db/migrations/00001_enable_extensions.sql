-- Goose reads the annotation comments below to know where the "apply" and
-- "roll back" sections start. The Up block runs when migrating up; the Down
-- block runs when rolling back.
-- (Note: goose treats ANY comment containing its directive token as a real
-- directive, so we avoid writing that token inside ordinary prose comments.)

-- +goose Up
-- PostGIS adds geographic types/functions (we'll store run routes as geometry
-- in a later phase). Enabling it once here means every environment that runs
-- our migrations gets it automatically — no manual DB setup.
CREATE EXTENSION IF NOT EXISTS postgis;

-- citext = "case-insensitive text". Storing emails as citext means
-- 'Alice@x.com' and 'alice@x.com' are treated as equal, so a UNIQUE constraint
-- on email naturally prevents duplicate signups that differ only by case.
CREATE EXTENSION IF NOT EXISTS citext;

-- +goose Down
-- Down migrations undo Up, in reverse. We drop what we created so a rollback
-- leaves the database exactly as it was before this migration.
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS postgis;
