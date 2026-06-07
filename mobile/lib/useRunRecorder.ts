// useRunRecorder: a custom hook that owns all the messy parts of recording a
// run — GPS permission, the location subscription, the elapsed-time ticker, and
// a running distance estimate — and exposes a clean state machine to the UI.
//
// Why a hook (not inline in the screen)? Same reason the backend splits handler
// from service: the screen should render, not manage subscriptions. This is the
// reusable "engine"; the screen is just a dashboard over it.
//
// KNOWN LIMITATION (deferred, by design): the in-progress track lives only in
// this ref (memory). If iOS kills the app BEFORE the user taps Finish, the
// unsaved points are lost — only finished, queued runs survive. The fix is
// checkpointing the live track to AsyncStorage periodically + offering to
// resume on next launch. We'll do that together with the background-location
// dev build, since both target the "screen off during a long run" scenario.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";

import type { RunPoint } from "./activities";
import { evaluateSample, type GpsSample } from "./gpsFilter";

export type RunStatus = "idle" | "requesting" | "recording" | "denied";

export function useRunRecorder() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);

  // Refs hold values we mutate without forcing a re-render on every GPS tick.
  // points is the filtered track we'll upload; lastAccepted is the anchor the
  // noise filter measures against (see gpsFilter for why "accepted", not "last
  // received"). The others support live math.
  const points = useRef<RunPoint[]>([]);
  const lastAccepted = useRef<GpsSample | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMs = useRef<number>(0);

  // Always stop cleanly: remove the GPS subscription and the timer. Called on
  // stop() and on unmount, so we never leak a background location watcher.
  const cleanup = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setStatus("requesting");
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== "granted") {
      setStatus("denied");
      return;
    }

    // Reset state for a fresh run.
    points.current = [];
    lastAccepted.current = null;
    setElapsedS(0);
    setDistanceM(0);
    startMs.current = Date.now();
    setStatus("recording");

    // Tick the elapsed timer once a second (independent of GPS cadence).
    ticker.current = setInterval(() => {
      setElapsedS(Math.floor((Date.now() - startMs.current) / 1000));
    }, 1000);

    // Stream GPS fixes. BestForNavigation gives the tightest accuracy (we WANT
    // every fix and filter them ourselves). distanceInterval:0 so we receive all
    // readings and let gpsFilter — not the OS — decide what counts as movement.
    subscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      (loc) => {
        const sample: GpsSample = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          altitude: loc.coords.altitude ?? 0,
          accuracy: loc.coords.accuracy ?? 9999, // missing accuracy => distrust
          timestamp: loc.timestamp,
        };

        // Run the noise filter against the last ACCEPTED point.
        const { accept, distanceM } = evaluateSample(lastAccepted.current, sample);
        if (!accept) return; // jitter / weak fix / teleport — ignore entirely

        lastAccepted.current = sample;
        points.current.push({
          lat: sample.lat,
          lng: sample.lng,
          altitude: sample.altitude,
          timestamp: new Date(sample.timestamp).toISOString(),
        });
        if (distanceM > 0) setDistanceM((d) => d + distanceM);
      }
    );
  }, []);

  // stop() ends recording and returns the collected points so the screen can
  // upload them. It does NOT upload — keeping network out of the recorder keeps
  // it single-purpose and testable.
  const stop = useCallback((): RunPoint[] => {
    cleanup();
    setStatus("idle");
    return points.current;
  }, [cleanup]);

  // Live pace (sec/km) derived from the on-device distance estimate.
  const livePaceSPerKm =
    distanceM > 0 ? elapsedS / (distanceM / 1000) : null;

  return { status, elapsedS, distanceM, livePaceSPerKm, start, stop };
}
