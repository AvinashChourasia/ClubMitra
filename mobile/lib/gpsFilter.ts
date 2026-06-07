// GPS noise filtering — the difference between a usable run tracker and one
// that says 435m for a 200m walk.
//
// THE PROBLEM: consumer GPS jitters. Even standing still, consecutive fixes can
// be several meters apart. If you sum the raw point-to-point distances, that
// jitter accumulates as PHANTOM distance — and the slower you move, the more the
// noise dominates the real signal. Unfiltered tracks routinely over-report 1.5–2x.
//
// THE FIX: don't trust every fix. We gate readings on three independent checks
// before letting them add to the total. All pure functions here so they're easy
// to reason about and unit-test.

// A raw GPS reading. Unlike RunPoint (what we upload), this carries `accuracy`:
// the fix's own estimated horizontal error radius in meters, which the OS gives
// us and which is the key to good filtering.
export type GpsSample = {
  lat: number;
  lng: number;
  altitude: number;
  accuracy: number; // meters; smaller = more confident
  timestamp: number; // ms since epoch
};

// Drop fixes less accurate than this. A reading that says "I'm within 50m" is
// useless for measuring a 200m walk, so we throw it away entirely.
export const ACCURACY_GATE_M = 20;

// Reject physically impossible jumps (GPS "teleports" when signal recovers).
// 12.5 m/s ≈ 45 km/h — faster than any runner, so anything above is an artifact.
export const MAX_SPEED_MPS = 12.5;

// Never count a move smaller than this, even with a good fix. Sets a hard floor
// under the noise for the strongest signals.
export const MIN_MOVE_FLOOR_M = 4;

// haversineMeters: great-circle distance between two lat/lng points. Used for
// the live on-device estimate; the server (PostGIS) recomputes authoritatively.
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000; // earth radius, meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type Decision = {
  accept: boolean; // should this sample become part of the track?
  distanceM: number; // meters to add to the total (0 if rejected)
};

// evaluateSample decides whether to accept `next`, given the last ACCEPTED
// sample `prev` (null for the first one). Returning the distance to add keeps
// the decision and the measurement in one consistent place.
//
// Why compare against the last *accepted* point, not the last *received* one?
// That's the crux. Jitter oscillates around a spot, so it never gets far from
// the last accepted point → it's filtered out. But genuine slow movement keeps
// drifting away from that anchor, so it eventually crosses the floor and counts.
// This kills phantom distance without dropping real (slow) progress.
export function evaluateSample(prev: GpsSample | null, next: GpsSample): Decision {
  // 1. Accuracy gate: ignore low-confidence fixes outright. Also naturally
  //    discards the unreliable readings right after GPS cold-start.
  if (next.accuracy > ACCURACY_GATE_M) {
    return { accept: false, distanceM: 0 };
  }

  // First good fix: anchor the track, but there's no distance yet.
  if (!prev) {
    return { accept: true, distanceM: 0 };
  }

  const d = haversineMeters(prev, next);
  const dtSec = (next.timestamp - prev.timestamp) / 1000;

  // 2. Speed sanity: reject teleports.
  if (dtSec > 0 && d / dtSec > MAX_SPEED_MPS) {
    return { accept: false, distanceM: 0 };
  }

  // 3. Noise floor: a move is only "real" if it exceeds the combined
  //    uncertainty of the two fixes. Each fix can be off by ~its own accuracy in
  //    any direction, so the error in the DISTANCE between them is roughly the
  //    SUM of the two accuracies — which is why standing-still jitter (two fixes
  //    that swing to opposite edges of the error circle) can look like ~2x the
  //    radius. Summing here suppresses that; a hard floor covers great fixes.
  const noiseFloor = Math.max(MIN_MOVE_FLOOR_M, prev.accuracy + next.accuracy);
  if (d < noiseFloor) {
    return { accept: false, distanceM: 0 };
  }

  return { accept: true, distanceM: d };
}
