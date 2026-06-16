// The run-recording ENGINE — one persistent source of truth for an in-progress
// run, independent of any screen. The track lives in AsyncStorage (the "active
// buffer"), so it survives navigating away from the record screen, an app
// background, and even an app kill. A run ends only when you finish or discard
// it — never by leaving the screen.
//
// Two ways fixes arrive, same buffer + same processing:
//   • Dev/standalone build → expo-location BACKGROUND updates via a TaskManager
//     task (records with the screen off, foreground-service notification).
//   • Expo Go (no background) → a MODULE-LEVEL foreground watch. Being module
//     level (not tied to a component) is what lets the run keep going when you
//     navigate away; if the whole app is suspended the buffer still persists, so
//     returning resumes the same run.
//
// The HUD just polls activeStats() and calls start/stop/resume/discard.

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { evaluateSample, pushAndWindowSpeed, type GpsSample } from "./gpsFilter";
import { forceResume, initPause, updatePause, pausedMsAt, type PauseState } from "./autopause";
import type { RunPoint } from "./activities";

export const RUN_TASK = "clubmitra-run-location";
const ACTIVE_KEY = "run_active";

const isExpoGo = Constants.appOwnership === "expo";

type Active = {
  startMs: number;
  distanceM: number;
  points: RunPoint[];
  lastAccepted: GpsSample | null;
  lastFixMs: number; // timestamp of the most recent fix we processed (0 = none yet)
  pause: PauseState;
  rawWin?: { lat: number; lng: number; timestamp: number }[]; // ~4s window → speed
};

// How long the run clock may run past the last fix before we treat the engine as
// not advancing (a suspend/kill gap). The live clock is read against
// min(now, lastFixMs + grace), so a normal ~1s fix cadence ticks smoothly while a
// real lapse freezes the clock instead of inflating moving time.
export const LIVE_GRACE_MS = 3000;
// A lapse longer than this on resume is banked as non-moving time (we recorded
// nothing across it, so it must not be credited as moving time / it would wreck pace).
const RESUME_GAP_MS = 5000;

function freshActive(): Active {
  return { startMs: Date.now(), distanceM: 0, points: [], lastAccepted: null, lastFixMs: 0, pause: initPause(), rawWin: [] };
}

// reconcileGap closes a recording lapse (app suspended/killed, then resumed):
// time during which no fixes arrived must not count as moving time. If we were
// mid-pause the open pause spell already absorbs it, so we only bank the gap
// when the runner was "moving" on paper but the engine was actually dead.
function reconcileGap(active: Active, now: number): void {
  if (!active.pause) active.pause = initPause();
  if (!active.lastFixMs || active.lastFixMs <= 0) return;
  const gap = now - active.lastFixMs;
  if (gap <= RESUME_GAP_MS) return;
  if (!active.pause.paused) active.pause.pausedAccumMs += gap;
  active.lastFixMs = now; // so a second resume can't double-bank the same gap
}

// liveElapsedS is the moving-time clock for the HUD/banner. Capping the reference
// at lastFixMs + grace freezes it through a suspend (no fixes) instead of letting
// wall-clock inflate it; paused time is subtracted at the same reference so the
// two stay consistent.
export function liveElapsedS(s: { startMs: number; pause: PauseState; lastFixMs: number }, now: number): number {
  const ref = s.lastFixMs > 0 ? Math.min(now, s.lastFixMs + LIVE_GRACE_MS) : now;
  return Math.max(0, Math.floor((ref - s.startMs - pausedMsAt(s.pause, ref)) / 1000));
}

async function readActive(): Promise<Active | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  return raw ? (JSON.parse(raw) as Active) : null;
}
async function writeActive(a: Active): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(a));
}

// processFix folds ONE OS location into the active buffer: update the auto-pause
// signal, then run the noise filter and (if accepted) append the vertex + add
// distance. Shared by both engines so they behave identically.
function processFix(active: Active, loc: Location.LocationObject): void {
  if (!active.pause) active.pause = initPause();
  if (!active.rawWin) active.rawWin = [];
  active.lastFixMs = loc.timestamp; // every received fix advances the run clock
  const sample: GpsSample = {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    altitude: loc.coords.altitude ?? 0,
    accuracy: loc.coords.accuracy ?? 9999,
    timestamp: loc.timestamp,
  };
  // Auto-pause: OS speed OR windowed displacement, whichever is larger (Android
  // can report speed 0 through bad GPS while genuinely moving).
  const winSpeed = pushAndWindowSpeed(active.rawWin, { lat: sample.lat, lng: sample.lng, timestamp: sample.timestamp });
  const reported = loc.coords.speed;
  const speed = Math.max(reported != null && reported >= 0 ? reported : 0, winSpeed);
  active.pause = updatePause(active.pause, speed, sample.timestamp);

  const { accept, distanceM } = evaluateSample(active.lastAccepted, sample);
  if (!accept) return;
  active.lastAccepted = sample;
  active.points.push({ lat: sample.lat, lng: sample.lng, altitude: sample.altitude, timestamp: new Date(sample.timestamp).toISOString() });
  if (distanceM > 0) active.distanceM += distanceM;
}

// --- background engine (dev/standalone) ---
// Batches can be delivered back-to-back; their async read→mutate→write would
// interleave and the last writer would clobber the other's appended points
// (lost track + under-counted distance). Serialize every batch behind one chain
// so each read-modify-write is atomic. The .catch keeps a failed link from
// poisoning the chain for the next batch.
let bgChain: Promise<void> = Promise.resolve();
// Survives across batches. Normally each batch re-reads the buffer (so it picks
// up a foreground reconcile), but if a write FAILS we keep mutating this mirror
// and retry on the next batch — otherwise that batch's points vanish silently.
let bgActive: Active | null = null;
let bgWriteFailed = false;
function resetBgMirror(): void {
  bgActive = null;
  bgWriteFailed = false;
}
TaskManager.defineTask(RUN_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;
  bgChain = bgChain
    .then(async () => {
      const active = bgWriteFailed && bgActive ? bgActive : await readActive();
      if (!active) return; // not recording
      for (const loc of locations) processFix(active, loc);
      bgActive = active;
      try {
        await writeActive(active);
        bgWriteFailed = false;
      } catch {
        bgWriteFailed = true; // keep bgActive so the next batch retries the write
      }
    })
    .catch(() => {});
  await bgChain;
});

const BG_OPTS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: "ClubMitra — recording run",
    notificationBody: "Tracking your route…",
  },
};

// --- foreground engine (Expo Go) — module-level singleton ---
let fgSub: Location.LocationSubscription | null = null;
let fgActive: Active | null = null; // in-memory mirror, persisted on every fix
let fgStarting: Promise<void> | null = null; // in-flight guard against double-subscribe

async function startForegroundWatch(): Promise<void> {
  // `fgSub` is assigned only AFTER watchPositionAsync resolves, so two near-
  // simultaneous callers (resume + start, or a fast remount) could both pass an
  // `if (fgSub)` check and create two live watches — double-counting distance and
  // leaking a subscription. Gate on an in-flight promise so the second caller
  // awaits the first instead of starting its own.
  if (fgSub) return;
  if (fgStarting) return fgStarting;
  fgStarting = (async () => {
    fgActive = (await readActive()) ?? freshActive();
    fgSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        if (!fgActive) return;
        processFix(fgActive, loc);
        void writeActive(fgActive);
      }
    );
  })();
  try {
    await fgStarting;
  } finally {
    fgStarting = null;
  }
}
function stopForegroundWatch(): void {
  fgSub?.remove();
  fgSub = null;
  fgActive = null;
}

// beginUpdates starts the right engine for an EXISTING buffer (idempotent).
async function beginUpdates(): Promise<void> {
  if (isExpoGo) {
    await startForegroundWatch();
    return;
  }
  if (!(await Location.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false))) {
    await Location.startLocationUpdatesAsync(RUN_TASK, BG_OPTS);
  }
}
async function endUpdates(): Promise<void> {
  resetBgMirror(); // run is ending — drop the cross-batch retry mirror
  if (isExpoGo) {
    stopForegroundWatch();
    return;
  }
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) {
      await Location.stopLocationUpdatesAsync(RUN_TASK);
    }
  } catch {
    /* already stopped */
  }
}

// --- public API ---

// hasActiveRun reports whether a run is in progress (buffer exists) — used to
// offer "Resume" instead of silently losing a run.
export async function hasActiveRun(): Promise<boolean> {
  return (await AsyncStorage.getItem(ACTIVE_KEY)) !== null;
}

// startRun begins a FRESH run.
export async function startRun(): Promise<void> {
  stopForegroundWatch(); // clear any stale fg watch
  resetBgMirror(); // clear any stale bg mirror so old points can't resurrect
  await writeActive(freshActive());
  await beginUpdates();
}

// resumeRun re-attaches the engine to an EXISTING buffer (after navigating back
// or relaunching the app). Returns whether the engine is actually capturing now:
// false means the caller must NOT show "recording" (permission was revoked, or
// updates failed to start) — otherwise the HUD lies while no fixes arrive.
export async function resumeRun(): Promise<boolean> {
  const a = await readActive();
  if (!a) return false;

  // The live source of truth: the in-memory mirror when the fg watch is alive,
  // else the persisted buffer. Reconcile must apply to THIS object.
  const liveActive = isExpoGo && fgActive ? fgActive : a;

  // "Already running" alone isn't enough to skip reconcile: the background task
  // stays registered across an OS suspend while delivering NOTHING, and Expo Go's
  // fg subscription object survives a background→foreground cycle the same way.
  // Only short-circuit when the engine is genuinely fresh (a recent fix); a stale
  // lastFixMs means a suspend gap we must still bank before fixes resume.
  const alreadyRunning = isExpoGo
    ? fgSub != null
    : await Location.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false);
  const fresh = liveActive.lastFixMs > 0 && Date.now() - liveActive.lastFixMs <= RESUME_GAP_MS;
  if (alreadyRunning && fresh) return true;

  // Foreground permission is the floor for either engine. If it was revoked
  // while we were away, don't pretend to record — preserve the buffer and report
  // failure so the UI can prompt to re-enable.
  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!perm?.granted) return false;

  // Bank any suspend/kill lapse as non-moving time before fixes resume.
  reconcileGap(liveActive, Date.now());
  await writeActive(liveActive);

  try {
    await beginUpdates(); // idempotent: a no-op when already running
  } catch {
    return false;
  }
  return true;
}

// stopRun ends the run, returns the captured track + paused seconds, clears the
// buffer.
export async function stopRun(): Promise<{ points: RunPoint[]; pausedS: number }> {
  // Capture the buffer BEFORE endUpdates() (which nulls fgActive). In Expo Go
  // the in-memory mirror is the freshest copy — the per-fix write is
  // fire-and-forget, so reading AsyncStorage here could miss the last fix.
  const active = isExpoGo && fgActive ? fgActive : await readActive();
  await endUpdates();
  await AsyncStorage.removeItem(ACTIVE_KEY);
  fgActive = null;
  // Measure paused time at the same capped reference the live clock used, so a
  // trailing suspend right before finishing can't distort the paused total.
  const ref = active && active.lastFixMs > 0 ? Math.min(Date.now(), active.lastFixMs + LIVE_GRACE_MS) : Date.now();
  const pausedS = active?.pause ? pausedMsAt(active.pause, ref) / 1000 : 0;
  return { points: active?.points ?? [], pausedS };
}

// discardRun throws the in-progress run away (stop + clear, no upload).
export async function discardRun(): Promise<void> {
  await endUpdates();
  await AsyncStorage.removeItem(ACTIVE_KEY);
  fgActive = null;
}

// activeStats is the live HUD source (polled by the screen). Reads the fg mirror
// when available (freshest), else the persisted buffer.
export async function activeStats(): Promise<{ startMs: number; distanceM: number; points: RunPoint[]; pause: PauseState; lastFixMs: number } | null> {
  const a = isExpoGo && fgActive ? fgActive : await readActive();
  return a ? { startMs: a.startMs, distanceM: a.distanceM, points: a.points, pause: a.pause ?? initPause(), lastFixMs: a.lastFixMs ?? 0 } : null;
}

// resumeActive is the manual auto-pause override: close any open pause spell.
export async function resumeActive(): Promise<void> {
  if (isExpoGo && fgActive) {
    fgActive.pause = forceResume(fgActive.pause ?? initPause(), Date.now());
    await writeActive(fgActive);
    return;
  }
  const a = await readActive();
  if (!a) return;
  a.pause = forceResume(a.pause ?? initPause(), Date.now());
  await writeActive(a);
}
