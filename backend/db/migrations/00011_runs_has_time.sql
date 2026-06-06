-- +goose Up

-- Time is optional when scheduling a run (a club may post "Sunday, time TBD").
-- has_time = false means only the date is meaningful; the app shows "Time TBD"
-- and ignores the time portion of scheduled_at. Existing rows have a real time,
-- so the default is true.
ALTER TABLE runs ADD COLUMN has_time BOOLEAN NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE runs DROP COLUMN has_time;
