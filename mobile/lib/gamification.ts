// Gamification client: XP, level, and the badge wall. Everything is computed
// server-side from GPS-verified data — fetching the profile is also the award
// pass, so `new_badges` carries anything unlocked by that very call (the post-
// run celebration uses this).

import { request } from "./api";

export type BadgeStatus = {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  category: "distance" | "single" | "streak" | "consistency" | "pace" | "time" | "club" | "challenge";
  tier: number; // 1 bronze · 2 silver · 3 gold
  xp: number;
  target: number;
  unit: string;
  earned: boolean;
  earned_at?: string | null;
  current: number;
};

export type Badge = Omit<BadgeStatus, "earned" | "earned_at" | "current">;

export type LevelInfo = {
  index: number;
  title: string;
  next_at?: number | null;
  next_title?: string | null;
  progress: number; // 0..1 toward next level (1 at max level)
};

export type GamificationProfile = {
  xp: number;
  level: LevelInfo;
  badges: BadgeStatus[];
  new_badges: Badge[];
  announce_badges: boolean;
};

export function getGamification(token: string): Promise<GamificationProfile> {
  return request<GamificationProfile>("/gamification", { token });
}

export function setBadgeAnnounce(token: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return request("/gamification/announce", { method: "PUT", token, body: { enabled } });
}

// Display labels for the wall's section headers, in render order.
export const BADGE_CATEGORIES: { key: BadgeStatus["category"]; label: string }[] = [
  { key: "club", label: "Club life" },
  { key: "distance", label: "Distance" },
  { key: "single", label: "Single run" },
  { key: "streak", label: "Streaks" },
  { key: "consistency", label: "Consistency" },
  { key: "pace", label: "Speed" },
  { key: "time", label: "Personality" },
  { key: "challenge", label: "Challenges" },
];

// Medal accent per tier (bronze / silver / gold).
export function tierColor(tier: number): string {
  return tier >= 3 ? "#F5C518" : tier === 2 ? "#9FB3C8" : "#D8965B";
}
