// useRunRecorder: owns the messy parts of recording a run — GPS permission, the
// location stream, the elapsed ticker, and a running distance — behind a clean
// state machine for the UI.
//
// Two engines, picked at runtime:
//   • Expo Go        → foreground watchPositionAsync (background isn't available
//                      in Expo Go). Track lives in memory; lost if the app dies.
//   • Dev/standalone → expo-location BACKGROUND updates via a TaskManager task
//                      (lib/locationTask), so the run keeps recording with the
//                      screen off and the track is persisted to AsyncStorage.
// The screen just sees start()/stop() + live stats and doesn't care which engine.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import Constants from "expo-constants";

import type { LatLng, RunPoint } from "./activities";
import { evaluateSample, pushAndWindowSpeed, type GpsSample, type RawFix } from "./gpsFilter";
import { forceResume, initPause, updatePause, pausedMsAt, type PauseState } from "./autopause";
import { startRun, stopRun, activeStats, resumeActive } from "./locationTask";

export type RunStatus = "idle" | "requesting" | "recording" | "denied";

// Expo Go can't run background location; fall back to a foreground watch there.
const isExpoGo = Constants.appOwnership === "expo";

export function useRunRecorder() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [route, setRoute] = useState<LatLng[]>([]); // live trace for the HUD map
  const [times, setTimes] = useState<number[]>([]); // epoch ms per vertex (pace gradient)
  const [paused, setPaused] = useState(false); // auto-pause (stopped moving)

  const points = useRef<RunPoint[]>([]); // foreground engine only
  const lastAccepted = useRef<GpsSample | null>(null);
  const rawWin = useRef<RawFix[]>([]); // rolling ~4s of raw fixes → windowed speed
  const pause = useRef<PauseState>(initPause()); // foreground engine only
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMs = useRef<number>(0);
  const background = useRef(false);

  const cleanup = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setStatus("requesting");
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      setStatus("denied");
      return;
    }

    points.current = [];
    lastAccepted.current = null;
    rawWin.current = [];
    pause.current = initPause();
    setElapsedS(0);
    setDistanceM(0);
    setRoute([]);
    setTimes([]);
    setPaused(false);
    startMs.current = Date.now();

    if (isExpoGo) {
      // Foreground engine: stream fixes into an in-memory track, filter locally.
      background.current = false;
      // Elapsed is MOVING time — total time minus any auto-paused spells.
      ticker.current = setInterval(() => {
        const now = Date.now();
        setElapsedS(Math.floor((now - startMs.current - pausedMsAt(pause.current, now)) / 1000));
      }, 1000);
      subscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          const sample: GpsSample = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            altitude: loc.coords.altitude ?? 0,
            accuracy: loc.coords.accuracy ?? 9999,
            timestamp: loc.timestamp,
          };
          // Auto-pause signal: OS speed OR real displacement over a ~4s window,
          // whichever is larger — Android can report speed=0 through bad GPS
          // while the runner is genuinely moving; the window self-heals that.
          // Runs on every fix (even ones the noise filter later drops).
          const winSpeed = pushAndWindowSpeed(rawWin.current, { lat: sample.lat, lng: sample.lng, timestamp: sample.timestamp });
          const reported = loc.coords.speed;
          const speed = Math.max(reported != null && reported >= 0 ? reported : 0, winSpeed);
          pause.current = updatePause(pause.current, speed, sample.timestamp);
          setPaused(pause.current.paused);

          const { accept, distanceM: d } = evaluateSample(lastAccepted.current, sample);
          if (!accept) return;
          lastAccepted.current = sample;
          points.current.push({ lat: sample.lat, lng: sample.lng, altitude: sample.altitude, timestamp: new Date(sample.timestamp).toISOString() });
          setRoute((prev) => [...prev, { latitude: sample.lat, longitude: sample.lng }]);
          setTimes((prev) => [...prev, sample.timestamp]);
          if (d > 0) setDistanceM((prev) => prev + d);
        }
      );
    } else {
      // Background engine: best-effort "Always" permission, then the task records
      // even with the screen off. The HUD polls the persisted buffer.
      background.current = true;
      await Location.requestBackgroundPermissionsAsync().catch(() => {});
      await startRun();
      ticker.current = setInterval(async () => {
        const s = await activeStats();
        if (s) {
          const now = Date.now();
          setElapsedS(Math.floor((now - s.startMs - pausedMsAt(s.pause, now)) / 1000));
          setDistanceM(s.distanceM);
          setRoute(s.points.map((p) => ({ latitude: p.lat, longitude: p.lng })));
          setTimes(s.points.map((p) => Date.parse(p.timestamp)));
          setPaused(s.pause.paused);
        }
      }, 1000);
    }

    setStatus("recording");
  }, []);

  // stop() ends recording and returns the captured track + auto-paused seconds
  // for the screen to upload. Async because the background engine reads its track
  // from storage.
  const stop = useCallback(async (): Promise<{ points: RunPoint[]; pausedS: number }> => {
    cleanup();
    setStatus("idle");
    if (background.current) return await stopRun();
    return { points: points.current, pausedS: pausedMsAt(pause.current, Date.now()) / 1000 };
  }, [cleanup]);

  // resume() is the runner's manual auto-pause override — for when detection
  // gets stuck through a bad-GPS stretch. Closes the open pause spell in
  // whichever engine is recording.
  const resume = useCallback(async () => {
    if (background.current) {
      await resumeActive().catch(() => {});
    } else {
      pause.current = forceResume(pause.current, Date.now());
    }
    setPaused(false);
  }, []);

  const livePaceSPerKm = distanceM > 0 ? elapsedS / (distanceM / 1000) : null;

  return { status, elapsedS, distanceM, livePaceSPerKm, route, times, paused, start, stop, resume };
}
