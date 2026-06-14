// Chapter rolling leaderboards. Mirrors the backend /runlog leaderboard route.
// (Manual run logging is gone — GPS-recorded activities feed these boards via
// the backend's credit hook, so the client only ever reads.)

import { request } from "./api";

export type BoardEntry = {
  rank: number;
  user_id: string;
  display_name: string;
  km: number;
  runs: number;
};

export type Period = "daily" | "weekly" | "monthly" | "alltime";

export async function leaderboard(token: string, chapterId: string, period: Period) {
  return (await request<BoardEntry[] | null>(`/runlog/leaderboard/${chapterId}/${period}`, { token })) ?? [];
}

// ClubStanding is the chapter's club-level gamification: an XP/level from all
// its logged distance, plus this week's standout runner (Member of the Week).
export type ClubStanding = {
  xp: number;
  level: number;
  level_title: string;
  next_at?: number | null;
  next_title?: string | null;
  progress: number; // 0..1 toward the next level
  total_km: number;
  total_runs: number;
  week_km: number;
  week_runners: number;
  member_of_week?: BoardEntry | null;
};

export function clubStanding(token: string, chapterId: string): Promise<ClubStanding> {
  return request(`/runlog/club/${chapterId}`, { token });
}
