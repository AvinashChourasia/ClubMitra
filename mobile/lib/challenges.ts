// Typed client for the challenges API (visibility-aware club model). A challenge
// has a type (distance/days/streak) and a visibility scope; progress is GPS-
// native — every recorded run credits all active challenges automatically.

import { request } from "./api";

export type ChallengeType = "distance" | "days" | "streak";
export type Visibility = "public" | "chapter" | "city" | "org";

export type Challenge = {
  id: string;
  creator_id: string;
  org_id?: string | null;
  chapter_id?: string | null;
  title: string;
  description: string;
  type: ChallengeType;
  visibility: Visibility;
  city?: string | null;
  target_km?: number | null;
  target_days?: number | null;
  start_date: string;
  end_date: string;
  allow_teams: boolean;
  join_fee?: number | null;
  lock_date?: string | null;
  created_at: string;
  // Per-user annotations:
  joined: boolean;
  progress_km: number;
  progress_days: number;
  current_streak: number;
  participant_count: number;
};

export type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  score: number;
  rank: number;
};

export const CHALLENGE_TYPES: { key: ChallengeType; label: string }[] = [
  { key: "distance", label: "Distance" },
  { key: "days", label: "Days" },
  { key: "streak", label: "Streak" },
];

export const VISIBILITIES: { key: Visibility; label: string }[] = [
  { key: "public", label: "Public" },
  { key: "chapter", label: "Chapter" },
  { key: "city", label: "City" },
  { key: "org", label: "Org-wide" },
];

// --- progress helpers (distance is km; days/streak are day counts) ---
export function challengeUnit(c: Challenge): "km" | "days" {
  return c.type === "distance" ? "km" : "days";
}
export function challengeTarget(c: Challenge): number {
  return (c.type === "distance" ? c.target_km : c.target_days) ?? 0;
}
export function challengeProgress(c: Challenge): number {
  return c.type === "distance" ? c.progress_km : c.progress_days;
}
export function challengeFraction(c: Challenge): number {
  const t = challengeTarget(c);
  return t > 0 ? Math.min(1, challengeProgress(c) / t) : 0;
}

// --- phase helpers (a challenge's life: upcoming → live → ended) ---
export type ChallengePhase = "upcoming" | "live" | "ended";

export function challengePhase(c: Challenge, now = Date.now()): ChallengePhase {
  if (now > new Date(c.end_date).getTime()) return "ended";
  if (now >= new Date(c.start_date).getTime()) return "live";
  return "upcoming";
}

// Whole days until an instant (>=0); used for "3d left" / "starts in 2d".
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000));
}

// How far through its window a live challenge is, 0..1 (for time bars).
export function windowElapsedFraction(c: Challenge, now = Date.now()): number {
  const s = new Date(c.start_date).getTime();
  const e = new Date(c.end_date).getTime();
  if (e <= s) return 1;
  return Math.max(0, Math.min(1, (now - s) / (e - s)));
}

// listChallenges: visible challenges (browse), or only the user's when joinedOnly.
export async function listChallenges(token: string, joinedOnly = false): Promise<Challenge[]> {
  const qs = joinedOnly ? "?joined=true" : "";
  return (await request<Challenge[] | null>(`/challenges${qs}`, { token })) ?? [];
}

export function getChallenge(token: string, id: string): Promise<Challenge> {
  return request<Challenge>(`/challenges/${id}`, { token });
}

export type NewChallenge = {
  title: string;
  description?: string;
  type: ChallengeType;
  visibility: Visibility;
  city?: string;
  org_id?: string;
  chapter_id?: string;
  target_km?: number;
  target_days?: number;
  start_date: string; // ISO
  end_date: string; // ISO
  allow_teams?: boolean;
  join_fee?: number;
  lock_date?: string; // ISO; after this, participants can't leave
};

export function createChallenge(token: string, body: NewChallenge): Promise<Challenge> {
  return request<Challenge>("/challenges", { method: "POST", token, body });
}

// joinChallenge: individual join (paid = mock-payment confirmation for a fee
// challenge), or join as a club when chapterId is given.
export function joinChallenge(token: string, id: string, opts?: { chapterId?: string; paid?: boolean }): Promise<Challenge> {
  return request<Challenge>(`/challenges/${id}/join`, {
    method: "POST",
    token,
    body: opts?.chapterId ? { chapter_id: opts.chapterId } : { paid: !!opts?.paid },
  });
}

// leaveChallenge: un-join (allowed only before the lock date).
export function leaveChallenge(token: string, id: string): Promise<Challenge> {
  return request<Challenge>(`/challenges/${id}/leave`, { method: "POST", token });
}

export async function getLeaderboard(token: string, id: string): Promise<LeaderboardEntry[]> {
  return (await request<LeaderboardEntry[] | null>(`/challenges/${id}/leaderboard`, { token })) ?? [];
}

// updateChallenge: organiser edit, open until the start date (backend enforces
// creator + pre-start). Send only the fields being changed.
export type ChallengeEdit = {
  title?: string;
  description?: string;
  target_km?: number;
  target_days?: number;
  start_date?: string; // ISO
  end_date?: string; // ISO
  lock_date?: string; // ISO
};

export function updateChallenge(token: string, id: string, body: ChallengeEdit): Promise<Challenge> {
  return request<Challenge>(`/challenges/${id}`, { method: "PUT", token, body });
}
