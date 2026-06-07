// Compute a map "region" (center + span) that frames a route nicely.
//
// react-native-maps positions the camera with a region: a center lat/lng plus
// latitudeDelta/longitudeDelta (how many degrees the viewport spans — i.e. the
// zoom). We find the route's bounding box, center on it, and pad the span by
// ~30% so the track isn't jammed against the screen edges.

import type { LatLng } from "./activities";

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const PADDING = 1.3; // 30% breathing room around the route
const MIN_DELTA = 0.002; // floor so a tiny/again-same-spot run isn't over-zoomed

export function regionForRoute(points: LatLng[]): Region | null {
  if (points.length === 0) return null;

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * PADDING),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * PADDING),
  };
}
