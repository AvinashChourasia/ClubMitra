// Simulation test for the GPS filter. Run with:  node lib/gpsFilter.test.ts
// (Node 26 strips TypeScript types for files outside node_modules.)
//
// We synthesize two scenarios and assert the filter behaves: phantom distance
// from standing-still jitter is suppressed, while real movement is measured.

import { evaluateSample, haversineMeters, type GpsSample } from "./gpsFilter.ts";

// Sum distance the way the recorder does: filter, then add accepted deltas.
function filteredDistance(samples: GpsSample[]): { distance: number; accepted: number } {
  let prev: GpsSample | null = null;
  let distance = 0;
  let accepted = 0;
  for (const s of samples) {
    const d = evaluateSample(prev, s);
    if (d.accept) {
      prev = s;
      accepted++;
      distance += d.distanceM;
    }
  }
  return { distance, accepted };
}

// Naive sum (no filter) — what we had before, to show the contrast.
function rawDistance(samples: GpsSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += haversineMeters(samples[i - 1], samples[i]);
  return total;
}

// Move `meters` north from a lat/lng. ~111,320 m per degree of latitude.
function north(lat: number, lng: number, meters: number) {
  return { lat: lat + meters / 111320, lng };
}

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name} — ${detail}`);
  if (!cond) failures++;
}

const BLR = { lat: 12.9716, lng: 77.5946 };
let t = Date.now();
const tick = () => (t += 1000);

// --- Scenario 1: STANDING STILL with ±6m jitter for 60 readings ---
// Real distance = 0. Raw sum will be large; filtered must be ~0.
const still: GpsSample[] = [];
for (let i = 0; i < 60; i++) {
  const jitterM = 6;
  const dLat = (Math.sin(i * 1.7) * jitterM) / 111320;
  const dLng = (Math.cos(i * 2.3) * jitterM) / (111320 * Math.cos((BLR.lat * Math.PI) / 180));
  still.push({ lat: BLR.lat + dLat, lng: BLR.lng + dLng, altitude: 100, accuracy: 8, timestamp: tick() });
}
const stillRaw = rawDistance(still);
const stillFiltered = filteredDistance(still);
console.log(`\n[standing still] raw=${stillRaw.toFixed(0)}m  filtered=${stillFiltered.distance.toFixed(0)}m`);
check("standstill raw is inflated", stillRaw > 50, `raw=${stillRaw.toFixed(0)}m (proves the problem)`);
check("standstill filtered ~0", stillFiltered.distance < 15, `filtered=${stillFiltered.distance.toFixed(0)}m`);

// --- Scenario 2: WALK 200m straight north, 5m per second, with ±3m jitter ---
const walk: GpsSample[] = [];
let cur = { ...BLR };
for (let i = 0; i < 40; i++) {
  cur = north(cur.lat, cur.lng, 5); // 5m real progress each reading
  const jLat = (Math.sin(i * 3.1) * 3) / 111320; // ±3m jitter
  walk.push({ lat: cur.lat + jLat, lng: cur.lng, altitude: 100, accuracy: 6, timestamp: tick() });
}
const walkFiltered = filteredDistance(walk);
console.log(`[walk 200m]      filtered=${walkFiltered.distance.toFixed(0)}m  (truth=200m)`);
const errPct = (Math.abs(walkFiltered.distance - 200) / 200) * 100;
check("walk within 15% of truth", errPct < 15, `filtered=${walkFiltered.distance.toFixed(0)}m, err=${errPct.toFixed(1)}%`);

// --- Scenario 3: a single GPS "teleport" must be rejected ---
const teleport: GpsSample[] = [
  { ...BLR, altitude: 100, accuracy: 5, timestamp: tick() },
  { ...north(BLR.lat, BLR.lng, 8), altitude: 100, accuracy: 5, timestamp: tick() }, // real 8m
  { lat: BLR.lat + 0.01, lng: BLR.lng, altitude: 100, accuracy: 5, timestamp: tick() }, // ~1.1km jump in 1s!
];
const tele = filteredDistance(teleport);
check("teleport rejected", tele.distance < 50, `filtered=${tele.distance.toFixed(0)}m (jump ignored)`);

// --- Scenario 4: low-accuracy fixes are dropped ---
const weak = evaluateSample(null, { ...BLR, altitude: 100, accuracy: 50, timestamp: t });
check("weak fix rejected", weak.accept === false, `accuracy 50m > gate`);

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
