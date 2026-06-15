// Durable read-through cache — the app's local "database" for offline resilience.
//
// Why AsyncStorage (not SQLite/Room/Firebase)? Our cached data is a handful of
// JSON lists (your clubs, challenges, runs, chats), read whole and replaced
// whole — not relational queries. AsyncStorage is the right-sized, zero-setup
// tool for that, and it's already a dependency (the offline run queue uses it).
// Room is Android-native Kotlin (N/A in Expo); SQLite (expo-sqlite) is overkill
// for blobs we never query into; Firebase would be a second backend to run.
//
// The contract: a screen shows whatever it cached last — INSTANTLY, before any
// network — then refreshes in the background and persists the result. So a
// sleeping backend, a dropped connection, or airplane mode never makes your
// data "disappear"; you always see the last-known state.

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "cache:";

// readCache returns the last value stored under key, or null. Never throws —
// a corrupt/absent entry is simply a cache miss.
export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// writeCache persists a value (best-effort; a storage failure must never break
// the screen that's otherwise working).
export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* out of space / serialization issue — cache is an optimization, skip */
  }
}

// swr ("stale-while-revalidate") is the pattern every list screen wants:
//   1. apply the cached value immediately, if we have one (instant paint);
//   2. fetch fresh, apply it, and persist for next time.
// On a fetch failure the cached value already shown stays put. The boolean
// resolves true when fresh data landed, false when we fell back to cache only
// (offline) — callers can use it to decide whether to surface an error.
export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  apply: (value: T) => void
): Promise<boolean> {
  const cached = await readCache<T>(key);
  if (cached != null) apply(cached);
  try {
    const fresh = await fetcher();
    apply(fresh);
    await writeCache(key, fresh);
    return true;
  } catch (e) {
    if (cached == null) throw e; // nothing to show and the network failed
    return false; // showed cache; refresh failed — that's fine offline
  }
}
