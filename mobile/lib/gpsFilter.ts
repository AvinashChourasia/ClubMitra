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

// Drop fixes less accurate than this. Truly bad fixes (signal recovery, indoors)
// are useless, but the gate must NOT be so tight it starves the track — phones
// routinely report 15–25m accuracy outdoors, and dropping all of those makes the
// map look frozen ("GPS stopped"). 30m keeps the garbage out while letting a
// normal run through.
export const ACCURACY_GATE_M = 30;

// Reject physically impossible jumps (GPS "teleports" when signal recovers).
// 12.5 m/s ≈ 45 km/h — faster than any runner, so anything above is an artifact.
export const MAX_SPEED_MPS = 12.5;

// Noise-floor bounds for accepting a vertex. The floor scales with fix accuracy
// (jitter ≈ the fixes' error) but is CLAMPED: a hard 5m minimum suppresses
// standing-still jitter, and a 15m ceiling stops the floor from ballooning to
// 25–30m on a so-so fix — which is what used to corner-cut the route into a
// coarse, wrong-looking path. Vertices every 5–15m draw a faithful trace.
export const MIN_MOVE_FLOOR_M = 5;
export const MAX_MOVE_FLOOR_M = 15;

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

  // 3. Noise floor: a move counts only if it exceeds the fixes' uncertainty —
  //    but CLAMPED to [5m, 15m]. Half the summed accuracy approximates the real
  //    jitter while the ceiling keeps the floor from corner-cutting the path on
  //    a mediocre fix. Below the floor the move is jitter: don't add distance.
  //    We still keep the vertex if it's a real (clamped-floor) step so the route
  //    stays faithful; sub-floor jitter is simply dropped entirely.
  const noiseFloor = Math.min(MAX_MOVE_FLOOR_M, Math.max(MIN_MOVE_FLOOR_M, (prev.accuracy + next.accuracy) / 2));
  if (d < noiseFloor) {
    return { accept: false, distanceM: 0 };
  }

  return { accept: true, distanceM: d };
}

// --- windowed speed (the auto-pause signal) ---
// The OS speed field can stick at 0 through a bad-GPS stretch even while the
// runner is moving. Net displacement over a ~4s window is a steadier signal:
// standing-still jitter oscillates around a point (tiny net drift), while real
// running covers real ground. Auto-pause uses max(reported, windowed).
export type RawFix = { lat: number; lng: number; timestamp: number };

// pushAndWindowSpeed folds a raw fix into the rolling window (mutating it) and
// returns the average speed across the window's span, m/s.
export function pushAndWindowSpeed(win: RawFix[], fix: RawFix, spanMs = 4000): number {
  win.push(fix);
  while (win.length > 1 && fix.timestamp - win[0].timestamp > spanMs) win.shift();
  const first = win[0];
  const dtS = (fix.timestamp - first.timestamp) / 1000;
  if (dtS < 1.5) return 0; // not enough span to judge yet
  return haversineMeters(first, fix) / dtS;
}
