-- +goose Up

-- A reusable trigger function that stamps updated_at = now() on every UPDATE.
-- Defining it once lets every table reuse it (activities, challenges, etc.).
--
-- StatementBegin/StatementEnd: goose normally splits a migration into separate
-- statements by semicolon. A function body contains semicolons of its own, so
-- we wrap it to tell goose "treat this whole block as ONE statement."
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- RunMitra does NOT own identity — MarathonMitra (MongoDB) is the source of
-- truth for accounts. This table is a thin PROFILE CACHE: a local copy of the
-- few MarathonMitra fields we need to label runs/leaderboards, populated on
-- login. There are no passwords here; MarathonMitra verifies credentials.
CREATE TABLE users (
    -- The MarathonMitra user id — a Mongo ObjectId (24-char hex string), so the
    -- column is TEXT, not uuid. Every RunMitra table keys off this id.
    id            TEXT PRIMARY KEY,

    -- citext + UNIQUE => case-insensitive uniqueness (see migration 00001).
    email         CITEXT NOT NULL UNIQUE,

    display_name  TEXT NOT NULL,

    -- When we last refreshed this cache from MarathonMitra (on login).
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- timestamptz stores an absolute instant (UTC under the hood), so times are
    -- unambiguous regardless of the server's or user's timezone.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attach the trigger so updated_at maintains itself on every row update.
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS set_updated_at();
