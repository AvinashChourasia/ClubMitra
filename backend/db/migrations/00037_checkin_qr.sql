-- +goose Up

-- Trustable attendance via QR. An admin "opens" check-in for a run (which shows
-- a rotating QR / code); members check in only while it's open, by scanning the
-- run's rotating code — closing the couch-check-in loophole. `source` records
-- HOW a check-in happened: 'self' (legacy one-tap, pre-QR), 'qr' (scanned/typed
-- the live code), or 'admin' (an admin marked them present).
ALTER TABLE runs ADD COLUMN checkin_open BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE run_attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'self';

-- +goose Down
ALTER TABLE run_attendance DROP COLUMN source;
ALTER TABLE runs DROP COLUMN checkin_open;
