-- +goose Up

CREATE TABLE activities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- When the run happened. ended_at - started_at is roughly duration_s, but we
    -- store duration explicitly because GPS gaps can make wall-clock misleading.
    started_at TIMESTAMPTZ NOT NULL,
    ended_at   TIMESTAMPTZ NOT NULL,
    duration_s INTEGER NOT NULL,

    -- Server-computed stats. distance is meters (from PostGIS ST_Length on the
    -- geography type, which is geodesic). pace is seconds per kilometer; it's
    -- NULL when distance is 0 (can't divide by zero / no meaningful pace).
    distance_m        DOUBLE PRECISION NOT NULL,
    avg_pace_s_per_km DOUBLE PRECISION,
    elevation_gain_m  DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- THE route itself. geography(LineString, 4326):
    --   * LineString = an ordered path of points (the run's track).
    --   * 4326 = WGS84, the lat/lng system every GPS device uses.
    --   * geography (not geometry) => distance/length come back in METERS and
    --     account for the earth's curvature, no projection math needed.
    route geography(LineString, 4326) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List a user's runs newest-first — the history screen's main query.
CREATE INDEX idx_activities_user_started ON activities (user_id, started_at DESC);

-- A GiST index is the spatial index type. It makes geographic queries (e.g.
-- "runs near this point", "segments crossing this area") fast. We don't use
-- those yet, but indexing the route now is cheap and sets up later phases.
CREATE INDEX idx_activities_route ON activities USING GIST (route);

-- +goose Down
DROP TABLE IF EXISTS activities;
