// useRunRecorder: a thin hook over the persistent run ENGINE (lib/locationTask).
// The engine owns the in-progress run (in AsyncStorage), so this hook holds NO
// run state of its own — it just polls activeStats() for the live HUD and calls
// start/stop/discard/resume. Because the engine lives outside the component, the
// run keeps recording when you navigate away; on mount we auto-resume any run
// already in progress instead of losing it.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import Constants from "expo-constants";

import type { LatLng, RunPoint } from "./activities";
import { startRun, resumeRun, stopRun, discardRun, activeStats, resumeActive, hasActiveRun, liveElapsedS } from "./locationTask";

export type RunStatus = "idle" | "requesting" | "recording" | "denied";

const isExpoGo = Constants.appOwnership === "expo";

export function useRunRecorder() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [checking, setChecking] = useState(true); // resolving whether a run is already in progress
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  // poll pulls the latest from the engine's buffer into HUD state.
  const poll = useCallback(async () => {
    const s = await activeStats();
    if (!s) return;
    setElapsedS(liveElapsedS(s, Date.now()));
    setDistanceM(s.distanceM);
    setRoute(s.points.map((p) => ({ latitude: p.lat, longitude: p.lng })));
    setTimes(s.points.map((p) => Date.parse(p.timestamp)));
    setPaused(s.pause.paused);
  }, []);

  const attach = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    void poll();
    ticker.current = setInterval(() => void poll(), 1000);
  }, [poll]);

  const detach = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  // On mount: resume a run already in progress (re-establish the engine + attach
  // the HUD) so navigating back never loses it. Detach (NOT stop) on unmount —
  // the engine keeps recording in the background.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (await hasActiveRun()) {
          const ok = await resumeRun();
          if (!active) return;
          // ok === false means permission was revoked / updates failed to start.
          // Show "denied" (not a lying "recording") but still attach so the HUD
          // displays the preserved run, and offer retry.
          setStatus(ok ? "recording" : "denied");
          attach();
        }
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
      detach();
    };
  }, [attach, detach]);

  const start = useCallback(async () => {
    setStatus("requesting");
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      setStatus("denied");
      return;
    }
    if (!isExpoGo) await Location.requestBackgroundPermissionsAsync().catch(() => {});
    await startRun();
    setElapsedS(0);
    setDistanceM(0);
    setRoute([]);
    setTimes([]);
    setPaused(false);
    setStatus("recording");
    attach();
  }, [attach]);

  // stop() ends the run and returns the captured track for upload.
  const stop = useCallback(async (): Promise<{ points: RunPoint[]; pausedS: number }> => {
    detach();
    setStatus("idle");
    return await stopRun();
  }, [detach]);

  // discard() throws the in-progress run away.
  const discard = useCallback(async () => {
    detach();
    setStatus("idle");
    await discardRun();
  }, [detach]);

  // resume() is the manual auto-pause override.
  const resume = useCallback(async () => {
    await resumeActive();
    setPaused(false);
    void poll();
  }, [poll]);

  // retry() recovers a run stuck in "denied": re-request permission, then resume
  // the preserved run (or fall back to idle if there's nothing to resume).
  const retry = useCallback(async () => {
    setStatus("requesting");
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      setStatus("denied");
      return;
    }
    if (await hasActiveRun()) {
      const ok = await resumeRun();
      setStatus(ok ? "recording" : "denied");
      attach(); // show the preserved run either way (recording, or frozen if still denied)
    } else {
      setStatus("idle");
    }
  }, [attach]);

  const livePaceSPerKm = distanceM > 0 ? elapsedS / (distanceM / 1000) : null;

  return { status, checking, elapsedS, distanceM, livePaceSPerKm, route, times, paused, start, stop, discard, resume, retry };
}
