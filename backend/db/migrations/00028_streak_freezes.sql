-- +goose Up

-- Streak freeze: up to 2 missed days per calendar month are bridged
-- automatically when computing the run streak, so planned rest doesn't reset
-- it. One row per covered day; the PK makes consumption idempotent.
CREATE TABLE streak_freezes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frozen_on  DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, frozen_on)
);

-- +goose Down
DROP TABLE streak_freezes;
