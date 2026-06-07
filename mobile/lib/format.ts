// Display formatters for run stats. Shared because the live screen, history,
// and detail views all show the same units the same way — format once, here.

// Meters -> "1.23 km" (or "650 m" under 1km).
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

// Seconds -> "H:MM:SS" or "M:SS". Used for elapsed time.
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Seconds-per-km -> "5:30 /km". null/0 -> "--" (no movement yet).
export function formatPace(secondsPerKm: number | null): string {
  if (!secondsPerKm || !isFinite(secondsPerKm)) return "-- /km";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")} /km`;
}

// Average speed in km/h, derived from distance + duration. Some runners prefer
// speed over pace; it's just the inverse. "--" until there's movement.
export function formatSpeed(meters: number, seconds: number): string {
  if (seconds <= 0 || meters <= 0) return "-- km/h";
  const kmh = meters / 1000 / (seconds / 3600);
  return `${kmh.toFixed(1)} km/h`;
}

// Meters of climb -> "12 m". Elevation gain is always whole meters here.
export function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ISO timestamp -> "Sun, 14 Jun · 6:00 AM" in the device's local time. Built
// manually (not toLocaleString) for consistent output across Hermes/Intl.
export function formatRunTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} · ${h}:${mm} ${ampm}`;
}

// ISO -> "Sun, 14 Jun" (date only).
export function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ISO -> just the time "6:00 AM".
export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${d.getMinutes().toString().padStart(2, "0")} ${ampm}`;
}

// Respects has_time: full date+time, or date + "Time TBD" when time is unset.
export function formatRunWhen(iso: string, hasTime: boolean): string {
  return hasTime ? formatRunTime(iso) : `${formatRunDate(iso)} · Time TBD`;
}

// True if the timestamp is in the past (used to label runs upcoming vs done).
export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
