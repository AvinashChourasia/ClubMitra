-- +goose Up

-- Phase 4 — pace gradient. The route geometry stores lng/lat/altitude but not
-- time, so we can't derive per-segment pace from it. Store the seconds-from-start
-- of each route vertex alongside, aligned 1:1 with the LineString's coordinates,
-- so the client can colour the route by pace. NULL for runs recorded before this.
ALTER TABLE activities
    ADD COLUMN point_offsets double precision[];

-- +goose Down
ALTER TABLE activities DROP COLUMN point_offsets;
