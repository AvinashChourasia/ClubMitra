// Race calendar client: browse upcoming races by city, list one, toggle
// "I'm going", and hand a race to the phone's calendar (native when the build
// has expo-calendar; Google Calendar link as the universal fallback).

import { Linking } from "react-native";

import { request } from "./api";

export type Race = {
  id: string;
  title: string;
  city: string;
  race_date: string; // YYYY-MM-DD
  distances: string; // "5K · 10K · Half Marathon"
  location?: string | null;
  url?: string | null;
  image_url?: string | null; // event banner from MarathonMitra
  organizer?: string | null;
  created_by?: string | null;
  going_count: number;
  going: boolean;
};

// ── Presentation helpers (shared by the calendar screen + the home carousel) ──

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// dateBlock splits a YYYY-MM-DD into the pieces a date badge shows.
export function dateBlock(ymd: string): { day: string; month: string; weekday: string } {
  const d = new Date(`${ymd}T12:00:00`);
  if (isNaN(d.getTime())) return { day: "?", month: "", weekday: "" };
  return {
    day: String(d.getDate()),
    month: MONTHS[d.getMonth()],
    weekday: d.toLocaleDateString([], { weekday: "short" }),
  };
}

// countdownLabel — "how soon is this?" at a glance. Past dates return null;
// anything within 3 days reads as urgent so the UI can light it up.
export function countdownLabel(ymd: string): { label: string; urgent: boolean } | null {
  const race = new Date(`${ymd}T12:00:00`);
  if (isNaN(race.getTime())) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const days = Math.round((race.getTime() - now.getTime()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return { label: "Today", urgent: true };
  if (days === 1) return { label: "Tomorrow", urgent: true };
  if (days <= 6) return { label: `In ${days} days`, urgent: days <= 3 };
  if (days <= 13) return { label: "Next week", urgent: false };
  if (days <= 60) return { label: `In ${Math.round(days / 7)} weeks`, urgent: false };
  return { label: `In ${Math.round(days / 30)} months`, urgent: false };
}

// shortDist renders a distance token the way runners say it: "Half Marathon" →
// HM, "Marathon"/"Full Marathon" → FM; everything else (5K, 10K…) is left as-is.
export function shortDist(t: string): string {
  const s = t.trim();
  if (/^half marathon$/i.test(s)) return "HM";
  if (/^(full\s+)?marathon$/i.test(s)) return "FM";
  return s;
}

// cityMatch mirrors the backend's prefix-tolerant comparison so on-device
// filtering agrees with the server: "Bengaluru Urban" matches "Bengaluru".
export function cityMatch(raceCity: string, selected: string): boolean {
  const a = raceCity.trim().toLowerCase();
  const b = selected.trim().toLowerCase();
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

export async function listRaces(token: string, city?: string): Promise<Race[]> {
  const qs = city ? `?city=${encodeURIComponent(city)}` : "";
  return (await request<Race[] | null>(`/races${qs}`, { token })) ?? [];
}

// Race submissions happen on MarathonMitra (their approval system feeds this
// calendar via API). This is the page organizers are sent to.
export const MARATHONMITRA_SUBMIT_URL = "https://marathonmitra.com";

export function toggleGoing(token: string, raceId: string): Promise<{ going: boolean; going_count: number }> {
  return request(`/races/${raceId}/interest`, { method: "POST", token });
}

export function deleteRace(token: string, raceId: string): Promise<void> {
  return request(`/races/${raceId}`, { method: "DELETE", token });
}

// addRaceToCalendar puts the race on the user's device calendar. Native
// (expo-calendar → syncs to Google/Apple calendar) when the installed build
// includes the module; otherwise opens a prefilled Google Calendar event —
// works everywhere, today. Races default to a 6:00–9:00 AM block.
// Returns "device" | "google" for the caller's success message.
export async function addRaceToCalendar(race: Race): Promise<"device" | "google"> {
  try {
    // Lazy require: the module's native side may be absent in older builds.
    const Calendar = require("expo-calendar") as typeof import("expo-calendar");
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (!perm.granted) throw new Error("no permission");
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const target =
      cals.find((c) => c.allowsModifications && c.isPrimary) ??
      cals.find((c) => c.allowsModifications);
    if (!target) throw new Error("no writable calendar");
    const start = new Date(`${race.race_date}T06:00:00`);
    const end = new Date(`${race.race_date}T09:00:00`);
    await Calendar.createEventAsync(target.id, {
      title: `🏁 ${race.title}`,
      startDate: start,
      endDate: end,
      location: race.location ?? race.city,
      notes: [race.distances, race.url ?? ""].filter(Boolean).join("\n"),
      alarms: [{ relativeOffset: -12 * 60 }], // nudge the evening before
    });
    return "device";
  } catch {
    // Universal fallback: a prefilled Google Calendar event in the browser/app.
    const ymd = race.race_date.replaceAll("-", "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `🏁 ${race.title}`,
      dates: `${ymd}T060000/${ymd}T090000`,
      location: race.location ?? race.city,
      details: [race.distances, race.url ?? ""].filter(Boolean).join("\n"),
    });
    await Linking.openURL(`https://calendar.google.com/calendar/render?${params.toString()}`);
    return "google";
  }
}
