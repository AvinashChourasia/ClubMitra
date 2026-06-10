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
