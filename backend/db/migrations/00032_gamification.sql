-- +goose Up

-- Phase 5 gamification. Badges are defined in code (internal/gamification
-- catalog); this table records which a user has earned. XP/levels are derived
-- from GPS-verified stats + earned badges, so there's no XP ledger to drift.
CREATE TABLE user_badges (
    user_id   TEXT NOT NULL REFERENCES users(id),
    badge_id  TEXT NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX idx_user_badges_user ON user_badges (user_id, earned_at DESC);

-- Badge unlocks auto-post to the runner's club chats; this is the opt-out.
ALTER TABLE users ADD COLUMN announce_badges BOOLEAN NOT NULL DEFAULT true;

-- Message kind: 'user' = a normal chat message, 'badge' = an automatic
-- achievement announcement, rendered as a centered system chip by the client.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'user';

-- +goose Down
ALTER TABLE messages DROP COLUMN kind;
ALTER TABLE users DROP COLUMN announce_badges;
DROP TABLE IF EXISTS user_badges;
