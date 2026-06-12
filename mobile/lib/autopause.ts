// Auto-pause: detect when the runner has stopped (waiting at a crossing, tying a
// shoe) and freeze the moving-time clock until they move again — so pace/time
// reflect actual running, like Strava/Nike auto-pause. Pure + engine-agnostic so
// the foreground (Expo Go) recorder and the background TaskManager task share it.

// Hysteresis: pause below PAUSE_SPEED, but only resume once clearly moving again
// (RESUME_SPEED), so a brief GPS speed dip doesn't flicker pause on/off.
const PAUSE_SPEED = 0.7;   // m/s (~2.5 km/h) — slower than a walk
const RESUME_SPEED = 1.3;  // m/s (~4.7 km/h) — a brisk walk / jog
const PAUSE_AFTER_MS = 4000; // must be slow this long before we pause

export type PauseState = {
  paused: boolean;
  pausedAccumMs: number;     // total paused time banked so far
  pauseStartMs: number | null; // when the current pause began (null if moving)
  slowSinceMs: number | null;  // when the current slow spell began (null if moving)
};

export function initPause(): PauseState {
  return { paused: false, pausedAccumMs: 0, pauseStartMs: null, slowSinceMs: null };
}

// updatePause folds one speed sample into the state and returns the next state.
// speedMps may be -1/NaN when the device doesn't report it — callers pass a
// distance/dt fallback in that case.
export function updatePause(s: PauseState, speedMps: number, nowMs: number): PauseState {
  const next = { ...s };
  if (speedMps < PAUSE_SPEED) {
    next.slowSinceMs = s.slowSinceMs ?? nowMs;
    if (!next.paused && nowMs - next.slowSinceMs >= PAUSE_AFTER_MS) {
      next.paused = true;
      next.pauseStartMs = nowMs;
    }
  } else if (speedMps >= RESUME_SPEED) {
    next.slowSinceMs = null;
    if (next.paused) {
      next.paused = false;
      next.pausedAccumMs += nowMs - (next.pauseStartMs ?? nowMs);
      next.pauseStartMs = null;
    }
  }
  // Between the two thresholds: hold the current state (hysteresis band).
  return next;
}

// pausedMsAt returns total paused milliseconds as of nowMs, including any
// in-progress pause. movingMs = (nowMs - startMs) - pausedMsAt(...).
export function pausedMsAt(s: PauseState, nowMs: number): number {
  return s.pausedAccumMs + (s.paused && s.pauseStartMs != null ? nowMs - s.pauseStartMs : 0);
}

// forceResume is the runner's manual override: when detection gets stuck
// (Android can report speed=0 through a bad-GPS stretch even while moving),
// the runner taps "resume" and we close the pause spell unconditionally.
export function forceResume(s: PauseState, nowMs: number): PauseState {
  if (!s.paused) return { ...s, slowSinceMs: null };
  return {
    paused: false,
    pausedAccumMs: s.pausedAccumMs + (s.pauseStartMs != null ? nowMs - s.pauseStartMs : 0),
    pauseStartMs: null,
    slowSinceMs: null,
  };
}
