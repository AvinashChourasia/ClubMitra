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

import { evaluateSample, type GpsSample } from "./gpsFilter";
import type { RunPoint } from "./activities";

export const RUN_TASK = "clubmitra-run-location";
const ACTIVE_KEY = "run_active";

type Active = { startMs: number; distanceM: number; points: RunPoint[]; lastAccepted: GpsSample | null };

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

  for (const loc of locations) {
    const sample: GpsSample = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      altitude: loc.coords.altitude ?? 0,
      accuracy: loc.coords.accuracy ?? 9999,
      timestamp: loc.timestamp,
    };
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
  await writeActive({ startMs: Date.now(), distanceM: 0, points: [], lastAccepted: null });
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

// stopRun ends updates and returns the full captured track, clearing the buffer.
export async function stopRun(): Promise<RunPoint[]> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) {
      await Location.stopLocationUpdatesAsync(RUN_TASK);
    }
  } catch {
    /* already stopped */
  }
  const active = await readActive();
  await AsyncStorage.removeItem(ACTIVE_KEY);
  return active?.points ?? [];
}

// activeStats is the live HUD source while recording (polled by the screen).
// Returns the full point track so the screen can draw the live route trace.
export async function activeStats(): Promise<{ startMs: number; distanceM: number; points: RunPoint[] } | null> {
  const a = await readActive();
  return a ? { startMs: a.startMs, distanceM: a.distanceM, points: a.points } : null;
}
