// Background run tracking. In a dev/standalone build the run keeps recording
// with the screen off via expo-location's background updates + a TaskManager
// task. The task is the source of truth: it appends filtered points to a
// persistent buffer (AsyncStorage) so the track survives backgrounding and even
// an app kill. The recording screen polls activeStats() for the live HUD.
//
// (Expo Go can't run background location, so useRunRecorder falls back to a
// foreground watch there — this module is only used in real builds.)

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { evaluateSample, pushAndWindowSpeed, type GpsSample, type RawFix } from "./gpsFilter";
import { forceResume, initPause, updatePause, pausedMsAt, type PauseState } from "./autopause";
import type { RunPoint } from "./activities";

export const RUN_TASK = "clubmitra-run-location";
const ACTIVE_KEY = "run_active";

type Active = {
  startMs: number;
  distanceM: number;
  points: RunPoint[];
  lastAccepted: GpsSample | null;
  pause: PauseState;
  // Rolling raw fixes (~4s) for the windowed auto-pause speed signal.
  rawWin?: RawFix[];
};

async function readActive(): Promise<Active | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  return raw ? (JSON.parse(raw) as Active) : null;
}
async function writeActive(a: Active): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(a));
}

// The background task: append accepted GPS fixes to the active buffer. Runs both
// in foreground and background once updates start. Registered at app launch
// (imported by _layout) so the OS can deliver fixes even after a cold start.
TaskManager.defineTask(RUN_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;
  const active = await readActive();
  if (!active) return; // not recording
  if (!active.pause) active.pause = initPause(); // tolerate a pre-upgrade buffer

  for (const loc of locations) {
    const sample: GpsSample = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      altitude: loc.coords.altitude ?? 0,
      accuracy: loc.coords.accuracy ?? 9999,
      timestamp: loc.timestamp,
    };
    // Auto-pause signal: the OS speed OR real displacement over a ~4s window,
    // whichever is larger — Android can report speed=0 through bad GPS while
    // the runner is genuinely moving, and the window self-heals that. Updated
    // on every fix, before the noise filter may drop this sample.
    if (!active.rawWin) active.rawWin = [];
    const winSpeed = pushAndWindowSpeed(active.rawWin, { lat: sample.lat, lng: sample.lng, timestamp: sample.timestamp });
    const reported = loc.coords.speed;
    const speed = Math.max(reported != null && reported >= 0 ? reported : 0, winSpeed);
    active.pause = updatePause(active.pause, speed, sample.timestamp);

    const { accept, distanceM } = evaluateSample(active.lastAccepted, sample);
    if (!accept) continue;
    active.lastAccepted = sample;
    active.points.push({ lat: sample.lat, lng: sample.lng, altitude: sample.altitude, timestamp: new Date(sample.timestamp).toISOString() });
    if (distanceM > 0) active.distanceM += distanceM;
  }
  await writeActive(active);
});

// startRun resets the buffer and begins background-capable location updates.
export async function startRun(): Promise<void> {
  await writeActive({ startMs: Date.now(), distanceM: 0, points: [], lastAccepted: null, pause: initPause(), rawWin: [] });
  await Location.startLocationUpdatesAsync(RUN_TASK, {
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
  });
}

// stopRun ends updates and returns the full captured track + auto-paused seconds,
// clearing the buffer.
export async function stopRun(): Promise<{ points: RunPoint[]; pausedS: number }> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) {
      await Location.stopLocationUpdatesAsync(RUN_TASK);
    }
  } catch {
    /* already stopped */
  }
  const active = await readActive();
  await AsyncStorage.removeItem(ACTIVE_KEY);
  const pausedS = active?.pause ? pausedMsAt(active.pause, Date.now()) / 1000 : 0;
  return { points: active?.points ?? [], pausedS };
}

// activeStats is the live HUD source while recording (polled by the screen).
// Returns the full point track (for the live route) plus the auto-pause state
// (so the screen can show "paused" and compute moving time).
export async function activeStats(): Promise<{ startMs: number; distanceM: number; points: RunPoint[]; pause: PauseState } | null> {
  const a = await readActive();
  return a ? { startMs: a.startMs, distanceM: a.distanceM, points: a.points, pause: a.pause ?? initPause() } : null;
}

// resumeActive is the manual auto-pause override for the background engine:
// close any open pause spell in the persisted buffer (the task keeps running).
export async function resumeActive(): Promise<void> {
  const a = await readActive();
  if (!a) return;
  a.pause = forceResume(a.pause ?? initPause(), Date.now());
  await writeActive(a);
}
