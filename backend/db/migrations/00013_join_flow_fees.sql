-- +goose Up

-- Challenges: an optional join fee, and a lock date after which a participant
-- can no longer leave (the organiser's "no backing out after X" cutoff).
ALTER TABLE challenges
    ADD COLUMN join_fee  NUMERIC(10,2),
    ADD COLUMN lock_date TIMESTAMPTZ;
ALTER TABLE challenge_participants
    ADD COLUMN fee_paid BOOLEAN NOT NULL DEFAULT false;

-- Clubs: an admin-approval layer, a subscription period, and a renewal window.
-- (membership_fee_enabled + membership_fee_amount already exist on chapters.)
ALTER TABLE chapters
    ADD COLUMN requires_approval   BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN membership_period   TEXT CHECK (membership_period IN ('monthly', 'annual')),
    ADD COLUMN renewal_window_days INT NOT NULL DEFAULT 5;

-- Membership gains two pre-active states: 'pending' (awaiting admin approval)
-- and 'pending_payment' (approved, awaiting the fee).
ALTER TABLE chapter_members DROP CONSTRAINT chapter_members_status_check;
ALTER TABLE chapter_members ADD CONSTRAINT chapter_members_status_check
    CHECK (status IN ('active', 'lapsed', 'suspended', 'pending', 'pending_payment'));

-- +goose Down
ALTER TABLE chapter_members DROP CONSTRAINT chapter_members_status_check;
UPDATE chapter_members SET status = 'active' WHERE status IN ('pending', 'pending_payment');
ALTER TABLE chapter_members ADD CONSTRAINT chapter_members_status_check
    CHECK (status IN ('active', 'lapsed', 'suspended'));
ALTER TABLE chapters
    DROP COLUMN requires_approval,
    DROP COLUMN membership_period,
    DROP COLUMN renewal_window_days;
ALTER TABLE challenge_participants DROP COLUMN fee_paid;
ALTER TABLE challenges DROP COLUMN join_fee, DROP COLUMN lock_date;
