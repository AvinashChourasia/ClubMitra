// Typed client for the activities API. Thin wrappers over the shared request()
// helper so screens deal in domain types (Activity, RunPoint), not URLs.

import { request } from "./api";

// One GPS sample we send to the server. Matches the backend's pointInput shape
// (lat/lng in human order; the server handles PostGIS lng-first internally).
export type RunPoint = {
  lat: number;
  lng: number;
  altitude: number;
  timestamp: string; // ISO 8601, e.g. "2026-06-01T10:00:00.000Z"
};

// A stored run as the server returns it (mirrors the Go Activity struct).
export type Activity = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  distance_m: number;
  avg_pace_s_per_km: number | null;
  elevation_gain_m: number;
  created_at: string;
};

// uploadRun posts a recorded run and returns the server-computed activity.
// countTowardChallenges defaults to true; pass false for warm-ups/test runs.
// pausedS is the auto-paused time (seconds) the server subtracts so the stored
// duration/pace reflect MOVING time, matching the live HUD.
export function uploadRun(
  token: string,
  points: RunPoint[],
  countTowardChallenges = true,
  pausedS = 0
): Promise<Activity> {
  return request<Activity>("/activities", {
    method: "POST",
    token,
    body: { points, count_toward_challenges: countTowardChallenges, paused_s: pausedS },
  });
}

// All-time aggregate stats for the profile/home dashboard.
export type Stats = {
  total_runs: number;
  total_distance_m: number;
  total_duration_s: number;
  longest_run_m: number;
  best_pace_s_per_km: number | null;
  current_streak_days: number;
};

export function getStats(token: string): Promise<Stats> {
  return request<Stats>("/activities/stats", { token });
}

// listActivities fetches the current user's runs, newest first.
export function listActivities(token: string): Promise<Activity[]> {
  return request<Activity[]>("/activities", { token });
}

// getActivity fetches a single run by id.
export function getActivity(token: string, id: string): Promise<Activity> {
  return request<Activity>(`/activities/${id}`, { token });
}

// One row of the city leaderboard — a runner ranked by GPS-verified distance.
export type CityBoardEntry = {
  rank: number;
  user_id: string;
  display_name: string;
  profile_photo: string | null;
  distance_m: number;
  runs: number;
};

export type CityPeriod = "today" | "week" | "month" | "all";

// The city leaderboard response: the ranked rows plus the city/period they're for.
export type CityBoardView = {
  city: string;
  period: CityPeriod;
  entries: CityBoardEntry[];
};

// cityLeaderboard ranks GPS-verified runners in a city over a rolling window.
// Omit city to default to the signed-in user's own city (resolved server-side).
export function cityLeaderboard(token: string, period: CityPeriod, city?: string): Promise<CityBoardView> {
  const q = new URLSearchParams({ period });
  if (city) q.set("city", city);
  return request<CityBoardView>(`/activities/city-leaderboard?${q.toString()}`, { token });
}

// A GeoJSON LineString geometry, as PostGIS/our API returns it. Coordinates are
// [longitude, latitude] or [longitude, latitude, altitude] (we store 3D routes,
// but older runs may be 2D — altitude is optional).
export type RouteGeoJSON = {
  type: "LineString";
  coordinates: ([number, number] | [number, number, number])[];
};

// elevationSeries pulls just the altitude (Z) values out of a route, for the
// elevation chart. Returns [] for 2D routes (older runs without altitude).
export function elevationSeries(route: RouteGeoJSON): number[] {
  const out: number[] = [];
  for (const c of route.coordinates) {
    const alt = c[2];
    if (typeof alt === "number") out.push(alt);
  }
  return out;
}

// The route endpoint's body: the GeoJSON geometry plus per-vertex
// seconds-from-start offsets (null for runs recorded before offsets existed),
// aligned 1:1 with the geometry's coordinates so we can colour by pace.
export type RouteResponse = {
  geometry: RouteGeoJSON;
  offsets_s: number[] | null;
};

// getRoute fetches the run's route geometry + per-vertex pace offsets.
export function getRoute(token: string, id: string): Promise<RouteResponse> {
  return request<RouteResponse>(`/activities/${id}/geojson`, { token });
}

// offsetsToTimes converts seconds-from-start offsets into the per-vertex "times"
// (ms) that RouteTrace/RunMap want. Only the deltas matter, so a zero base is
// fine. Returns undefined when the run has no offsets (older runs).
export function offsetsToTimes(offsets: number[] | null): number[] | undefined {
  return offsets ? offsets.map((s) => s * 1000) : undefined;
}

// A map-friendly coordinate. We convert GeoJSON's [lng, lat] into the named
// {latitude, longitude} shape the RouteTrace expects, in one place.
export type LatLng = { latitude: number; longitude: number };

export function geoJSONToLatLng(route: RouteGeoJSON): LatLng[] {
  return route.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}
