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
export function uploadRun(
  token: string,
  points: RunPoint[],
  countTowardChallenges = true
): Promise<Activity> {
  return request<Activity>("/activities", {
    method: "POST",
    token,
    body: { points, count_toward_challenges: countTowardChallenges },
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

// getRouteGeoJSON fetches the run's route geometry for drawing on a map.
export function getRouteGeoJSON(token: string, id: string): Promise<RouteGeoJSON> {
  return request<RouteGeoJSON>(`/activities/${id}/geojson`, { token });
}

// A map-friendly coordinate. We convert GeoJSON's [lng, lat] into the named
// {latitude, longitude} shape react-native-maps expects, in one place.
export type LatLng = { latitude: number; longitude: number };

export function geoJSONToLatLng(route: RouteGeoJSON): LatLng[] {
  return route.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}
