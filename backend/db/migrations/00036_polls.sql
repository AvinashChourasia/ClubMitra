-- +goose Up

-- Phase 5 polls: an admin drops a quick poll into the club chat as a message of
-- kind='poll'. The poll's question + options + votes hang off the message id, so
-- a deleted message takes its poll with it (ON DELETE CASCADE).
CREATE TABLE polls (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    question   TEXT NOT NULL,
    multi      BOOLEAN NOT NULL DEFAULT false, -- allow choosing more than one option
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    idx        INT NOT NULL, -- display order
    text       TEXT NOT NULL
);
CREATE INDEX idx_poll_options_message ON poll_options (message_id, idx);

-- One row per (option, voter). A single-choice poll keeps one row per voter
-- across the poll (enforced in code); multi-choice allows several.
CREATE TABLE poll_votes (
    option_id  UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (option_id, user_id)
);
CREATE INDEX idx_poll_votes_message ON poll_votes (message_id);

-- +goose Down
DROP TABLE IF EXISTS poll_votes;
DROP TABLE IF EXISTS poll_options;
DROP TABLE IF EXISTS polls;
