-- Store altitude in the route geometry as its Z dimension, so we can draw an
-- elevation profile. We switch the column from a 2D LineString to a 3D
-- "LineString Z". Distance still uses only X/Y (ST_Length on geography is 2D
-- geodesic), so existing stats are unaffected.

-- +goose Up
-- Convert existing 2D rows to 3D by forcing a Z of 0 (old test runs have no
-- real altitude). New runs will carry true per-point altitude.
ALTER TABLE activities
    ALTER COLUMN route TYPE geography(LineStringZ, 4326)
    USING ST_Force3D(route::geometry)::geography;

-- +goose Down
-- Drop back to 2D, discarding the Z values.
ALTER TABLE activities
    ALTER COLUMN route TYPE geography(LineString, 4326)
    USING ST_Force2D(route::geometry)::geography;
