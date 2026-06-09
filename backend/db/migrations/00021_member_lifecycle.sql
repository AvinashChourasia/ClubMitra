-- +goose Up

-- Phase 2 — extended member lifecycle. Three more membership states:
--   on_leave  — self-declared break; paused from leaderboards
--   injured   — removed from performance comparisons (leaderboards)
--   alumni    — departed member, read-only history
-- A member can set their OWN status to on_leave (and back to active); admins set
-- injured / alumni / suspended.
ALTER TABLE chapter_members DROP CONSTRAINT chapter_members_status_check;
ALTER TABLE chapter_members ADD CONSTRAINT chapter_members_status_check
    CHECK (status IN ('active', 'lapsed', 'suspended', 'pending', 'pending_payment',
                      'on_leave', 'injured', 'alumni'));

-- +goose Down
ALTER TABLE chapter_members DROP CONSTRAINT chapter_members_status_check;
UPDATE chapter_members SET status = 'active' WHERE status IN ('on_leave', 'injured', 'alumni');
ALTER TABLE chapter_members ADD CONSTRAINT chapter_members_status_check
    CHECK (status IN ('active', 'lapsed', 'suspended', 'pending', 'pending_payment'));
