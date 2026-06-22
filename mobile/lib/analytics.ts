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

// One quiet member, for the admin's "reach out" list. last_active_at/days_quiet
// are null for someone who has never logged a run or checked in.
export type InactiveMember = {
  user_id: string;
  name: string;
  profile_photo?: string | null;
  last_active_at: string | null;
  days_quiet: number | null;
};

export function getDropoff(token: string, chapterId: string) {
  return request<Dropoff>(`/analytics/${chapterId}/dropoff`, { token });
}

export async function getInactiveMembers(token: string, chapterId: string, days = 14) {
  return (await request<InactiveMember[] | null>(`/analytics/${chapterId}/inactive?days=${days}`, { token })) ?? [];
}

export function getEngagement(token: string, chapterId: string) {
  return request<Engagement>(`/analytics/${chapterId}/engagement`, { token });
}

export async function getVolume(token: string, chapterId: string) {
  return (await request<VolumePoint[] | null>(`/analytics/${chapterId}/volume`, { token })) ?? [];
}
