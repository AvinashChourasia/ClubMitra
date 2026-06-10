// useReplay drives an animated "retrace" of a run: a cursor that travels along
// the route over a fixed, watchable duration (the whole run compressed to ~14s).
// It exposes a float index into the coordinates (so an SVG can interpolate in
// screen space) and the matching lat/lng cursor (for a map marker). When per-
// vertex times exist the playback honours real pacing — you linger where you ran
// slowly; otherwise it advances evenly. Engine-agnostic, used by RunMap (native
// map marker) and RouteTrace (SVG cursor).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LatLng } from "./activities";

const REPLAY_MS = 14000;
const TICK_MS = 60;

export type Replay = {
  playing: boolean;
  cursor: LatLng | null; // null before playback starts
  index: number;         // float position into coords (0 … n-1)
  progress: number;      // 0 … 1
  toggle: () => void;
  reset: () => void;
};

export function useReplay(coords: LatLng[], times?: number[]): Replay {
  const n = coords.length;
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseMs = useRef(0); // virtual playback origin (Date.now() minus elapsed)

  const usesTimes = !!times && times.length === n && n >= 2;

  // progress (0..1) → float index, honouring real pacing when times exist.
  const progressToIndex = useCallback(
    (p: number): number => {
      if (n < 2) return 0;
      const pp = clamp01(p);
      if (usesTimes) {
        const total = times![n - 1] - times![0] || 1;
        const target = times![0] + pp * total;
        let i = 1;
        while (i < n - 1 && times![i] < target) i++;
        const span = times![i] - times![i - 1] || 1;
        return i - 1 + clamp01((target - times![i - 1]) / span);
      }
      return pp * (n - 1);
    },
    [n, usesTimes, times]
  );

  const indexToProgress = useCallback(
    (idx: number): number => {
      if (n < 2) return 0;
      if (usesTimes) {
        const total = times![n - 1] - times![0] || 1;
        const i = Math.floor(idx);
        const t = times![i] + (times![Math.min(i + 1, n - 1)] - times![i]) * (idx - i);
        return clamp01((t - times![0]) / total);
      }
      return clamp01(idx / (n - 1));
    },
    [n, usesTimes, times]
  );

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // New route (or screen reuse) → rewind.
  useEffect(() => {
    stop();
    setPlaying(false);
    setIndex(0);
  }, [coords, stop]);

  const toggle = useCallback(() => {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    if (n < 2) return;
    const startIdx = index >= n - 1 ? 0 : index; // restart if parked at the end
    baseMs.current = Date.now() - indexToProgress(startIdx) * REPLAY_MS;
    setPlaying(true);
    timer.current = setInterval(() => {
      const p = (Date.now() - baseMs.current) / REPLAY_MS;
      if (p >= 1) {
        setIndex(n - 1);
        setPlaying(false);
        stop();
        return;
      }
      setIndex(progressToIndex(p));
    }, TICK_MS);
  }, [playing, index, n, stop, indexToProgress, progressToIndex]);

  const reset = useCallback(() => {
    stop();
    setPlaying(false);
    setIndex(0);
  }, [stop]);

  const cursor = useMemo(() => {
    if (n < 2 || index <= 0) return null;
    const i = Math.floor(index);
    const j = Math.min(i + 1, n - 1);
    const frac = index - i;
    return {
      latitude: coords[i].latitude + (coords[j].latitude - coords[i].latitude) * frac,
      longitude: coords[i].longitude + (coords[j].longitude - coords[i].longitude) * frac,
    };
  }, [coords, index, n]);

  return { playing, cursor, index, progress: indexToProgress(index), toggle, reset };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
