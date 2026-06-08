// Chapter analytics client (admin-only): drop-off, engagement, and weekly
// activity volume. Mirrors the backend /analytics/{chapterID}/* routes.

import { request } from "./api";

export type Dropoff = {
  inactive_7d: number;
  inactive_14d: number;
  inactive_30d: number;
  inactive_60d: number;
  total_members: number;
};

export type Engagement = {
  weekly_active: number;
  total_members: number;
  engagement_rate: number; // 0..100
};

export type VolumePoint = {
  week_start: string; // "YYYY-MM-DD" (Monday)
  km: number;
  runs: number;
};

export function getDropoff(token: string, chapterId: string) {
  return request<Dropoff>(`/analytics/${chapterId}/dropoff`, { token });
}

export function getEngagement(token: string, chapterId: string) {
  return request<Engagement>(`/analytics/${chapterId}/engagement`, { token });
}

export async function getVolume(token: string, chapterId: string) {
  return (await request<VolumePoint[] | null>(`/analytics/${chapterId}/volume`, { token })) ?? [];
}
