// Offline-first queue for recorded runs.
//
// The golden rule of a run tracker: a finished run must NEVER be lost to a
// flaky network. So on finish we ALWAYS persist the run locally first, then try
// to upload. If the upload fails (offline, server unreachable), the run stays
// queued and we retry later — on app startup and whenever Home regains focus.
//
// Storage: AsyncStorage (not SecureStore) — runs aren't secrets, and a run has
// thousands of GPS points which would exceed SecureStore's ~2KB-per-item limit.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { uploadRun, type Activity, type RunPoint } from "./activities";

const QUEUE_KEY = "run_queue";

// A run waiting to be uploaded. id is a local client id (not the server's) so
// we can dedupe and remove the exact entry after a successful upload.
export type QueuedRun = {
  id: string;
  points: RunPoint[];
  queuedAt: string;
  // Whether this run counts toward challenges. Optional for backward-compat with
  // any runs queued before this field existed (treated as true on upload).
  countTowardChallenges?: boolean;
  // Auto-paused seconds to subtract server-side (moving time). Optional/back-compat.
  pausedS?: number;
};

async function readQueue(): Promise<QueuedRun[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedRun[];
  } catch {
    // Corrupt data shouldn't brick the app — start clean.
    return [];
  }
}

async function writeQueue(runs: QueuedRun[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(runs));
}

// enqueue persists a freshly finished run. This is the call that guarantees the
// run survives even if everything else fails.
export async function enqueue(
  points: RunPoint[],
  countTowardChallenges = true,
  pausedS = 0
): Promise<QueuedRun> {
  const run: QueuedRun = {
    // Date.now()+random is plenty unique for a local id; no uuid dep needed.
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    points,
    queuedAt: new Date().toISOString(),
    countTowardChallenges,
    pausedS,
  };
  const queue = await readQueue();
  queue.push(run);
  await writeQueue(queue);
  return run;
}

// pendingCount lets the UI show "2 runs waiting to sync".
export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

// FlushResult reports what happened so the caller can update the UI.
export type FlushResult = {
  uploaded: Activity[]; // server results for runs that synced this pass
  remaining: number; // how many are still queued (e.g. still offline)
};

// flush tries to upload every queued run, oldest first. Successful ones are
// removed; failures stay queued and stop the pass (likely all will fail while
// offline, so there's no point hammering the network).
//
// SINGLE-FLIGHT: only one flush runs at a time; concurrent callers join it.
// Without this, a slow upload + a screen-focus flush could both read the same
// queue and upload the same run TWICE (the server doesn't dedupe live runs).
//
// It needs a token getter rather than a raw token because a flush may run later
// than when it was scheduled, and we want a fresh token at upload time.
let flushInFlight: Promise<FlushResult> | null = null;

export function flush(getToken: () => Promise<string | null>): Promise<FlushResult> {
  if (!flushInFlight) {
    flushInFlight = doFlush(getToken).finally(() => {
      flushInFlight = null;
    });
  }
  return flushInFlight;
}

async function doFlush(getToken: () => Promise<string | null>): Promise<FlushResult> {
  const queue = await readQueue();
  if (queue.length === 0) return { uploaded: [], remaining: 0 };

  const token = await getToken();
  if (!token) return { uploaded: [], remaining: queue.length };

  const uploaded: Activity[] = [];
  let index = 0;
  for (; index < queue.length; index++) {
    try {
      const run = queue[index];
      // Omitted flag (older queued runs) defaults to counting.
      const activity = await uploadRun(token, run.points, run.countTowardChallenges !== false, run.pausedS ?? 0);
      uploaded.push(activity);
    } catch {
      // Network/server failure: stop here, keep this and the rest for later.
      break;
    }
  }

  // Persist whatever we didn't manage to upload (the unprocessed tail).
  const remainingRuns = queue.slice(index);
  await writeQueue(remainingRuns);
  return { uploaded, remaining: remainingRuns.length };
}
