// Typed client for the challenges API (visibility-aware club model). A challenge
// has a type (distance/days/streak) and a visibility scope; progress is credited
// from admin-verified proof in Phase 1.

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

export type Proof = {
  id: string;
  challenge_id: string;
  user_id: string;
  strava_link?: string | null;
  screenshot_url?: string | null;
  km_claimed?: number | null;
  proof_date?: string | null; // "YYYY-MM-DD"
  verified: boolean;
  verified_by?: string | null;
  created_at: string;
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

export type ProofInput = { strava_link?: string; screenshot_url?: string; km_claimed?: number; proof_date?: string };

export function submitProof(token: string, id: string, body: ProofInput): Promise<Proof> {
  return request<Proof>(`/challenges/${id}/proof`, { method: "POST", token, body });
}

// listProof + verifyProof are creator-only (the backend enforces this).
export async function listProof(token: string, id: string): Promise<Proof[]> {
  return (await request<Proof[] | null>(`/challenges/${id}/proof`, { token })) ?? [];
}

export function verifyProof(token: string, id: string, proofId: string): Promise<Proof> {
  return request<Proof>(`/challenges/${id}/proof/${proofId}/verify`, { method: "POST", token });
}
