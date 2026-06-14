// Guest discovery: the public (no-token) API plus the little bits of guest
// state — chosen city, whether welcome was seen, and the "pending intent" that
// makes deferred auth feel seamless: a guest taps Join, we stash what they were
// trying to do, send them through signup/login, then finish the join for them.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { request } from "./api";
import type { Chapter } from "./clubs";

// --- public API (no token) ---

// A club as guests see it: enough to want in, nothing private.
export type DiscoverClub = {
  id: string;
  name: string;
  city: string;
  description: string;
  logo?: string | null;
  banner?: string | null;
  join_policy: "open" | "invite";
  member_count: number;
};

export function publicClubs(city?: string, q?: string): Promise<DiscoverClub[]> {
  const qs = new URLSearchParams();
  if (city) qs.set("city", city);
  if (q) qs.set("q", q);
  return request<DiscoverClub[]>(`/public/chapters?${qs.toString()}`);
}

// publicClub fetches one club's public teaser for the non-member profile page.
export function publicClub(id: string): Promise<DiscoverClub> {
  return request<DiscoverClub>(`/public/chapters/${id}`);
}

export type CityCount = { city: string; clubs: number };

export function publicCities(): Promise<CityCount[]> {
  return request<CityCount[]>("/public/cities");
}

// A challenge as guests see it (no leaderboard, no creator).
export type PublicChallenge = {
  id: string;
  title: string;
  description: string;
  type: "distance" | "days" | "streak";
  city?: string | null;
  target_km?: number | null;
  target_days?: number | null;
  start_date: string;
  end_date: string;
  participant_count: number;
};

export function publicChallenges(city?: string, q?: string, type?: string): Promise<PublicChallenge[]> {
  const qs = new URLSearchParams();
  if (city) qs.set("city", city);
  if (q) qs.set("q", q);
  if (type) qs.set("type", type);
  return request<PublicChallenge[]>(`/public/challenges?${qs.toString()}`);
}

// joinOpenClub joins a discovered open club directly (auth required).
export function joinOpenClub(token: string, chapterId: string): Promise<{ chapter: Chapter; status: string }> {
  return request(`/chapters/${chapterId}/join`, { method: "POST", token });
}

// --- guest state (AsyncStorage) ---

const CITY_KEY = "guest_city";
const WELCOME_KEY = "welcome_seen";
const INTENT_KEY = "pending_intent";

export async function getGuestCity(): Promise<string | null> {
  return AsyncStorage.getItem(CITY_KEY);
}

export async function setGuestCity(city: string): Promise<void> {
  await AsyncStorage.setItem(CITY_KEY, city.trim());
}

export async function welcomeSeen(): Promise<boolean> {
  return (await AsyncStorage.getItem(WELCOME_KEY)) === "1";
}

export async function markWelcomeSeen(): Promise<void> {
  await AsyncStorage.setItem(WELCOME_KEY, "1");
}

// --- pending intent (deferred-auth resume) ---

// What a guest was trying to do when the auth gate stopped them. After
// signup/login the auth screens replay it, so "Join → sign up → joined" feels
// like one motion instead of a dead end.
export type PendingIntent =
  | { type: "join_club"; id: string; name: string }
  | { type: "join_challenge"; id: string; name: string };

export async function setPendingIntent(intent: PendingIntent): Promise<void> {
  await AsyncStorage.setItem(INTENT_KEY, JSON.stringify(intent));
}

export async function takePendingIntent(): Promise<PendingIntent | null> {
  const raw = await AsyncStorage.getItem(INTENT_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(INTENT_KEY);
  try {
    return JSON.parse(raw) as PendingIntent;
  } catch {
    return null;
  }
}

// resumePendingIntent finishes what the guest started, right after signup/login.
// Returns where to land + what to tell them, or null when there was nothing
// pending (or the join failed — never block a fresh login on it).
export async function resumePendingIntent(
  token: string
): Promise<{ route: string; title: string; message: string } | null> {
  const intent = await takePendingIntent();
  if (!intent) return null;
  try {
    if (intent.type === "join_club") {
      const res = await joinOpenClub(token, intent.id);
      const active = res.status === "active";
      return {
        route: `/club/${intent.id}`,
        title: active ? "Welcome to the club! 🎉" : "Request sent",
        message: active
          ? `You're now a member of ${intent.name}.`
          : res.status === "pending_payment"
            ? `${intent.name} has a membership fee — pay in the club page to activate.`
            : `${intent.name} reviews join requests — you'll be in once an admin approves.`,
      };
    }
    const { joinChallenge } = await import("./challenges");
    await joinChallenge(token, intent.id);
    return { route: `/challenge/${intent.id}`, title: "You're in! 🏁", message: `${intent.name} — go log those runs.` };
  } catch {
    // Join didn't go through (e.g. a join fee) — still land them on the thing
    // they wanted so they can finish from there, instead of dumping them home.
    return {
      route: intent.type === "join_club" ? `/club/${intent.id}` : `/challenge/${intent.id}`,
      title: "Almost there",
      message: `Your account is ready — finish joining ${intent.name} from this page.`,
    };
  }
}
