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
  distances: string;
  location?: string | null;
  url?: string | null;
  created_by?: string | null;
  going_count: number;
  going: boolean;
};

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
