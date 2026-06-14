-- +goose Up

-- Phase 5 social graph: a runner can follow another runner. Directed edge
-- (follower → followee). Unfollow is a hard delete (no history to keep), so no
-- deleted_at here. A runner can't follow themselves (CHECK), and the pair is
-- unique (composite PK). Cascades clean up if either account is removed.
CREATE TABLE follows (
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

-- followee_id → "who follows this runner" (followers list + count).
CREATE INDEX idx_follows_followee ON follows (followee_id);
-- follower_id → "who this runner follows" (following list + count).
CREATE INDEX idx_follows_follower ON follows (follower_id);

-- +goose Down
DROP TABLE IF EXISTS follows;
