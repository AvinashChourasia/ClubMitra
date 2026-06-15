// API client for attendance: a chapter's scheduled group runs and check-ins.
// Mirrors the backend /runs routes.

import { request } from "./api";

export type Run = {
  id: string;
  chapter_id: string;
  created_by: string;
  title: string;
  scheduled_at: string;
  has_time: boolean;
  location?: string | null;
  distance_target?: number | null;
  notes?: string | null;
  created_at: string;
  attendee_count: number;
  checkin_open: boolean; // organiser has check-in running (QR shown)
};

// A run on the user's personal schedule (across all their clubs).
export type MyRun = Run & { chapter_name: string; checked_in: boolean };

export type Attendee = {
  user_id: string;
  name: string;
  checked_in_at: string;
  self_check_in: boolean;
};

// A member's attendance record within one club ("attended 8 of 12").
export type MemberAttendance = { run_id: string; title: string; scheduled_at: string; checked_in_at: string };
export type ChapterAttendance = { attended: number; total_runs: number; history: MemberAttendance[] };

// List endpoints coerce null -> [] defensively (an empty list must never crash
// a .map / .length on the screen).
export async function listRuns(token: string, chapterId: string) {
  return (await request<Run[] | null>(`/runs?chapter_id=${chapterId}`, { token })) ?? [];
}

export function getRun(token: string, runId: string) {
  return request<Run>(`/runs/${runId}`, { token });
}

// myRuns: the caller's schedule across all their clubs (coerce null -> []).
export async function myRuns(token: string) {
  return (await request<MyRun[] | null>("/runs/mine", { token })) ?? [];
}

export type BulkScheduleBody = {
  chapter_id: string;
  title: string;
  has_time: boolean;
  location?: string;
  distance_target?: number;
  notes?: string;
  scheduled_ats: string[]; // RFC3339 occurrences (client-expanded)
};

// scheduleRuns creates one or many runs (recurring) in one call.
export function scheduleRuns(token: string, body: BulkScheduleBody) {
  return request<Run[]>("/runs/bulk", { method: "POST", body, token });
}

export type UpdateRunBody = {
  title: string;
  scheduled_at: string;
  has_time: boolean;
  location?: string;
  distance_target?: number;
  notes?: string;
};

export function updateRun(token: string, runId: string, body: UpdateRunBody) {
  return request<Run>(`/runs/${runId}`, { method: "PUT", body, token });
}

// --- recurrence ---

export type Frequency = "once" | "daily" | "weekday" | "weekend" | "alternate" | "custom";

export const FREQUENCY_OPTIONS: { key: Frequency; label: string }[] = [
  { key: "once", label: "One-time" },
  { key: "daily", label: "Every day" },
  { key: "weekday", label: "Weekdays" },
  { key: "weekend", label: "Weekends" },
  { key: "alternate", label: "Alternate days" },
  { key: "custom", label: "Custom days" },
];

// expandOccurrences turns a recurrence into concrete ISO timestamps in the
// device's local timezone. The date math lives on the client (which knows the
// timezone); the server just stores the resulting instants.
export function expandOccurrences(opts: {
  frequency: Frequency;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive); ignored for "once"
  weekdays?: number[]; // 0=Sun..6=Sat, for "custom"
  time?: string | null; // "HH:MM" local, or null for time-TBD (uses 00:00)
}): string[] {
  const [sy, sm, sd] = opts.startDate.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end =
    opts.frequency === "once"
      ? new Date(sy, sm - 1, sd)
      : (() => {
          const [ey, em, ed] = opts.endDate.split("-").map(Number);
          return new Date(ey, em - 1, ed);
        })();
  const [hh, mm] = opts.time ? opts.time.split(":").map(Number) : [0, 0];

  const out: string[] = [];
  const day = 86400000;
  for (const d = new Date(start); d <= end && out.length <= 120; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    let include = false;
    switch (opts.frequency) {
      case "once":
      case "daily":
        include = true;
        break;
      case "weekday":
        include = dow >= 1 && dow <= 5;
        break;
      case "weekend":
        include = dow === 0 || dow === 6;
        break;
      case "alternate":
        include = Math.round((d.getTime() - start.getTime()) / day) % 2 === 0;
        break;
      case "custom":
        include = opts.weekdays?.includes(dow) ?? false;
        break;
    }
    if (include) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0).toISOString());
  }
  return out;
}

// checkIn marks attendance. A MEMBER self-checks-in by passing the live `code`
// (scanned/typed from the organiser's QR) — required now that couch check-in is
// closed. An ADMIN marks another member present by passing their userId (no code).
export function checkIn(token: string, runId: string, opts?: { userId?: string; code?: string }) {
  const body: Record<string, string> = {};
  if (opts?.userId) body.user_id = opts.userId;
  if (opts?.code) body.code = opts.code;
  return request<Run>(`/runs/${runId}/checkin`, { method: "POST", body, token });
}

// checkOut removes the caller's check-in (with an optional reason).
export function checkOut(token: string, runId: string, reason?: string) {
  return request<Run>(`/runs/${runId}/checkout`, { method: "POST", body: reason ? { reason } : {}, token });
}

export async function listAttendees(token: string, runId: string) {
  return (await request<Attendee[] | null>(`/runs/${runId}/attendance`, { token })) ?? [];
}

// --- QR check-in (organiser side) ---

// openCheckin / closeCheckin start and stop check-in for a run (admin only).
export function openCheckin(token: string, runId: string) {
  return request<Run>(`/runs/${runId}/checkin/open`, { method: "POST", token });
}
export function closeCheckin(token: string, runId: string) {
  return request<Run>(`/runs/${runId}/checkin/close`, { method: "POST", token });
}

// getCheckinCode returns the run's current rotating code + seconds-to-rotate
// (admin only) — the organiser's QR screen polls this every window.
export function getCheckinCode(token: string, runId: string) {
  return request<{ code: string; expires_in_s: number }>(`/runs/${runId}/checkin/code`, { token });
}

// memberChapterAttendance: a member's record within one club. Allowed for the
// member themselves or an admin of that chapter (the backend enforces it).
export function memberChapterAttendance(token: string, chapterId: string, userId: string) {
  return request<ChapterAttendance>(`/members/${userId}/attendance?chapter_id=${chapterId}`, { token });
}
