// Run logging + chapter rolling leaderboards. Mirrors the backend /runlog routes.

import { request } from "./api";

export type RunLog = {
  id: string;
  user_id: string;
  chapter_id: string;
  distance_km: number;
  ran_on: string; // YYYY-MM-DD
  note?: string | null;
  proof_url?: string | null;
  created_at: string;
};

export type BoardEntry = {
  rank: number;
  user_id: string;
  display_name: string;
  km: number;
  runs: number;
};

export type Period = "daily" | "weekly" | "monthly" | "alltime";

export type NewRunLog = {
  chapter_id: string;
  distance_km: number;
  ran_on: string;
  note?: string;
  proof_url?: string;
};

export function logRun(token: string, body: NewRunLog) {
  return request<RunLog>("/runlog", { method: "POST", body, token });
}

export async function myRunLogs(token: string) {
  return (await request<RunLog[] | null>("/runlog/mine", { token })) ?? [];
}

export async function leaderboard(token: string, chapterId: string, period: Period) {
  return (await request<BoardEntry[] | null>(`/runlog/leaderboard/${chapterId}/${period}`, { token })) ?? [];
}
