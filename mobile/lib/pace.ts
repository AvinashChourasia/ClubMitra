// Pace helpers shared by the SVG route trace and the native map. Given a route's
// coordinates and a per-vertex time (epoch ms, or any monotonic ms — only the
// deltas matter), we derive a smoothed per-segment pace and a colour ramp
// (green = fast → amber → red = slow) normalised to the run's own spread.

import type { LatLng } from "./activities";

// haversine — great-circle distance between two coords, in metres.
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// paceFromTimes derives a per-vertex pace (sec/km) from coordinates + per-vertex
// times, then lightly smooths it with a rolling ±2 window so GPS jitter doesn't
// make the colour flicker. Null where pace can't be trusted (no movement / time).
export function paceFromTimes(coords: LatLng[], times: number[]): (number | null)[] {
  const raw: (number | null)[] = [null];
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    const dt = (times[i] - times[i - 1]) / 1000;
    raw.push(d > 1 && dt > 0 ? dt / (d / 1000) : null);
  }
  return raw.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      if (raw[j] != null) { sum += raw[j] as number; n++; }
    }
    return n ? sum / n : null;
  });
}

// paceColor ramps 0 (fast) → green, 0.5 → amber, 1 (slow) → red.
export function paceColor(t: number): string {
  const c = t < 0.5
    ? mix([22, 163, 74], [245, 158, 11], t / 0.5)
    : mix([245, 158, 11], [220, 38, 38], (t - 0.5) / 0.5);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// paceColorRamp returns a per-vertex colour string for the whole route, or null
// when there isn't enough timing data to be meaningful. Pace is normalised to
// the run's own 10th–90th percentile so the ramp reads well for any runner, and
// null gaps are filled from the nearest known pace.
export function paceColorRamp(coords: LatLng[], times: number[]): string[] | null {
  if (!times || times.length !== coords.length || coords.length < 2) return null;
  const paces = paceFromTimes(coords, times);
  const valid = paces.filter((p): p is number => p != null && isFinite(p) && p > 0).sort((a, b) => a - b);
  if (valid.length < 2) return null;
  const lo = valid[Math.floor(valid.length * 0.1)];
  const hi = valid[Math.floor(valid.length * 0.9)] || lo + 1;

  // Forward/backward-fill nulls so every vertex has a colour.
  const filled = fillNulls(paces);
  return filled.map((p) => paceColor(clamp01((p - lo) / (hi - lo || 1))));
}

function fillNulls(arr: (number | null)[]): number[] {
  const out = arr.slice() as (number | null)[];
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) last = out[i];
    else out[i] = last;
  }
  last = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] != null) last = out[i];
    else out[i] = last;
  }
  return out.map((p) => p ?? 0);
}

function mix(a: number[], b: number[], t: number): number[] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// A per-kilometre split: its index, the time it took, the pace, and the map
// position where the kilometre completed (for a split marker).
export type Split = {
  km: number;          // 1, 2, 3, …
  durationS: number;   // seconds for this kilometre
  paceSPerKm: number;  // = durationS (a split is exactly 1 km)
  coord: LatLng;       // where the km boundary fell
};

// computeSplits walks the route accumulating geodesic distance and, at every
// whole-kilometre boundary, interpolates the boundary's time + position to
// produce a clean per-km split. Needs per-vertex times (ms); returns [] without
// them. The trailing partial kilometre is intentionally omitted.
export function computeSplits(coords: LatLng[], times?: number[]): Split[] {
  if (!times || times.length !== coords.length || coords.length < 2) return [];
  const out: Split[] = [];
  let acc = 0;
  let nextKm = 1;
  let prevBoundaryMs = times[0];
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    while (seg > 0 && acc + seg >= nextKm * 1000) {
      const frac = (nextKm * 1000 - acc) / seg; // fraction along this segment
      const boundaryMs = times[i - 1] + (times[i] - times[i - 1]) * frac;
      const coord: LatLng = {
        latitude: coords[i - 1].latitude + (coords[i].latitude - coords[i - 1].latitude) * frac,
        longitude: coords[i - 1].longitude + (coords[i].longitude - coords[i - 1].longitude) * frac,
      };
      const durationS = (boundaryMs - prevBoundaryMs) / 1000;
      out.push({ km: nextKm, durationS, paceSPerKm: durationS, coord });
      prevBoundaryMs = boundaryMs;
      nextKm++;
    }
    acc += seg;
  }
  return out;
}
