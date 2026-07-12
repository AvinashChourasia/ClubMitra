// Activity Sync client — connect Strava (read-only) so your Strava runs flow
// into MarathonMitra and count toward challenges/leaderboards/badges. The whole
// feature is dormant unless the backend has Strava credentials (status.configured).

import * as WebBrowser from "expo-web-browser";

import { request } from "./api";

export type StravaStatus = {
  configured: boolean; // backend has Strava credentials
  connected: boolean; // this user has linked their Strava
  athlete_id?: string;
  last_synced_at?: string | null;
};

export function stravaStatus(token: string) {
  return request<StravaStatus>("/integrations/strava/status", { token });
}

export function stravaSync(token: string) {
  return request<{ imported: number }>("/integrations/strava/sync", { method: "POST", token });
}

export function stravaDisconnect(token: string) {
  return request<void>("/integrations/strava/disconnect", { method: "POST", token });
}

// connectStrava runs the OAuth consent flow: fetch the authorize URL, open it
// in the auth browser, and detect the deep-link return (clubmitra://strava).
// Returns the outcome so the caller can sync + toast appropriately.
export async function connectStrava(token: string): Promise<"connected" | "cancelled" | "failed"> {
  const { url } = await request<{ url: string }>("/integrations/strava/connect", { token });
  const res = await WebBrowser.openAuthSessionAsync(url, "clubmitra://strava");
  if (res.type !== "success") return "cancelled"; // user dismissed the browser
  if (res.url.includes("connected=1")) return "connected";
  return "failed"; // returned with ?error=...
}
