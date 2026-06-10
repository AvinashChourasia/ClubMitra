-- +goose Up

-- Guest-first discovery. Clubs become discoverable by city, so each chapter
-- declares how runners get in:
--   open   — anyone can tap Join (approval/fee rules still apply after)
--   invite — the classic invite-code flow only
-- Default open: discovery without joinability is a dead end.
ALTER TABLE chapters
    ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'open'
        CHECK (join_policy IN ('open', 'invite'));

-- +goose Down
ALTER TABLE chapters DROP COLUMN join_policy;
