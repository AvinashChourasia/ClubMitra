// Social graph client: a runner's public profile, and following other runners.
// Profiles aggregate identity + follow counts + run stats + a gamification level
// snapshot, served by the backend `social` package.

import { request } from "./api";

export type RunnerProfile = {
  id: string;
  name: string;
  city?: string | null;
  running_level?: string | null;
  profile_photo?: string | null;
  member_since: string; // YYYY-MM-DD
  followers: number;
  following: number;
  is_following: boolean;
  is_self: boolean;
  total_runs: number;
  total_distance_m: number;
  xp: number;
  level_title: string;
  badges: number;
};

export type RunnerCard = {
  id: string;
  name: string;
  city?: string | null;
  profile_photo?: string | null;
  is_following: boolean;
};

export type FollowState = { following: boolean; followers: number };

export function getRunnerProfile(token: string, id: string): Promise<RunnerProfile> {
  return request(`/social/users/${id}`, { token });
}

export function followRunner(token: string, id: string): Promise<FollowState> {
  return request(`/social/users/${id}/follow`, { method: "POST", token });
}

export function unfollowRunner(token: string, id: string): Promise<FollowState> {
  return request(`/social/users/${id}/follow`, { method: "DELETE", token });
}

export async function listFollowers(token: string, id: string): Promise<RunnerCard[]> {
  return (await request<RunnerCard[] | null>(`/social/users/${id}/followers`, { token })) ?? [];
}

export async function listFollowing(token: string, id: string): Promise<RunnerCard[]> {
  return (await request<RunnerCard[] | null>(`/social/users/${id}/following`, { token })) ?? [];
}
