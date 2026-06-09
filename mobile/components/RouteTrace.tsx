// RouteTrace — draws a run's GPS route as a clean SVG line, with no map tiles
// and no API key (Google or Apple). It projects lat/lng to screen space with a
// simple equirectangular projection (longitude scaled by cos(latitude) so the
// shape isn't squashed), fits it to the box, and flips Y so north points up.
//
// Extras: a faint distance grid, km markers along the route, and an optional
// per-point pace gradient (fast → slow as green → amber → red), normalised to
// the run's own spread so it reads well regardless of the runner's speed.
//
// Renders anywhere react-native-svg runs — including Expo Go — so the route
// view never needs a dev build.

import { useMemo } from "react";
import { Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import type { LatLng } from "../lib/activities";
import { colors } from "../lib/theme";

type Props = {
  coords: LatLng[];
  height?: number;
  /** Optional per-vertex timestamp (epoch ms) parallel to coords → pace gradient. */
  times?: number[];
  /** Stroke width of the route line. */
  weight?: number;
  /** Live mode dims the "finish" dot to a moving cursor (still recording). */
  live?: boolean;
  style?: ViewStyle;
};

const PAD = 18; // inner padding so the line/markers never touch the edges
const DOT = 5;
const MAX_SEG = 240; // cap gradient segments for perf on long runs

export function RouteTrace({ coords, height = 220, times, weight = 5, live = false, style }: Props) {
  const fitted = useMemo(() => project(coords, height), [coords, height]);
  const kmMarks = useMemo(() => (fitted ? kmMarkers(coords, fitted) : []), [coords, fitted]);
  const segments = useMemo(() => {
    if (!fitted || !times || times.length !== coords.length) return null;
    const paces = paceFromTimes(coords, times);
    return paces.some((p) => p != null) ? paceSegments(fitted.pts, paces) : null;
  }, [fitted, coords, times]);

  if (!fitted || coords.length < 2) {
    return (
      <View
        style={[
          { height: Math.min(height, 160), borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" },
          style,
        ]}
      >
        <Text style={{ color: colors.muted }}>{live ? "Waiting for GPS…" : "No route to display"}</Text>
      </View>
    );
  }

  const { pts, w, h } = fitted;
  const d = "M" + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
  const start = pts[0];
  const end = pts[pts.length - 1];

  // Faint background grid (purely a sense-of-scale backdrop).
  const cols = 6, rows = Math.max(2, Math.round((rows0(h, w))));
  const gridV = Array.from({ length: cols + 1 }, (_, i) => (w / cols) * i);
  const gridH = Array.from({ length: rows + 1 }, (_, i) => (h / rows) * i);

  return (
    <View style={[{ borderRadius: 16, overflow: "hidden", backgroundColor: colors.bgSecondary }, style]}>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        <Rect x={0} y={0} width={w} height={h} fill={colors.bgSecondary} />
        <G>
          {gridV.map((x, i) => (
            <Line key={`v${i}`} x1={x} y1={0} x2={x} y2={h} stroke={colors.border} strokeWidth={1} strokeOpacity={0.5} />
          ))}
          {gridH.map((y, i) => (
            <Line key={`h${i}`} x1={0} y1={y} x2={w} y2={y} stroke={colors.border} strokeWidth={1} strokeOpacity={0.5} />
          ))}
        </G>

        {/* Soft underlay for depth */}
        <Path d={d} stroke={colors.primary} strokeOpacity={0.16} strokeWidth={weight + 5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Route: gradient segments if paces given, else a single accent line */}
        {segments ? (
          segments.map((s, i) => (
            <Line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={weight} strokeLinecap="round" />
          ))
        ) : (
          <Path d={d} stroke={colors.primary} strokeWidth={weight} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Km markers */}
        {kmMarks.map((m) => (
          <G key={m.km}>
            <Circle cx={m.x} cy={m.y} r={8} fill="#fff" stroke={colors.border} strokeWidth={1} />
            <SvgText x={m.x} y={m.y + 3.5} fontSize={9} fontWeight="700" fill={colors.text} textAnchor="middle">
              {m.km}
            </SvgText>
          </G>
        ))}

        {/* Start marker (green) */}
        <Circle cx={start.x} cy={start.y} r={DOT + 2} fill="#fff" />
        <Circle cx={start.x} cy={start.y} r={DOT} fill={colors.success} />
        {/* Finish / current position */}
        <Circle cx={end.x} cy={end.y} r={DOT + 2} fill="#fff" />
        <Circle cx={end.x} cy={end.y} r={DOT} fill={live ? colors.primary : colors.danger} />
      </Svg>

      {/* Pace legend (only when we drew a gradient) */}
      {segments && (
        <View style={{ position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#16A34A" }}>fast</Text>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: "#F59E0B" }} />
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#DC2626" }}>slow</Text>
        </View>
      )}
    </View>
  );
}

// rows0 derives a grid row count that keeps cells roughly square for the box.
function rows0(h: number, w: number): number {
  return (h / w) * 6;
}

// project maps lat/lng to box coordinates, preserving aspect ratio.
function project(coords: LatLng[], height: number) {
  if (coords.length < 2) return null;

  const meanLatRad = (coords.reduce((s, c) => s + c.latitude, 0) / coords.length) * (Math.PI / 180);
  const kx = Math.cos(meanLatRad) || 1e-6;

  const world = coords.map((c) => ({ x: c.longitude * kx, y: c.latitude }));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of world) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;

  const h = height;
  const innerH = h - PAD * 2;
  const aspect = spanX / spanY;
  const innerW = Math.max(40, Math.min(innerH * aspect, innerH * 3));
  const w = innerW + PAD * 2;

  const pts = world.map((p) => ({
    x: PAD + ((p.x - minX) / spanX) * innerW,
    y: PAD + (1 - (p.y - minY) / spanY) * innerH,
  }));

  return { pts, w, h };
}

// kmMarkers walks the route accumulating geodesic distance and returns the
// screen position at each whole kilometre (1, 2, 3, …).
function kmMarkers(coords: LatLng[], fitted: { pts: { x: number; y: number }[] }) {
  const out: { km: number; x: number; y: number }[] = [];
  let acc = 0;
  let nextKm = 1;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    while (acc + seg >= nextKm * 1000 && seg > 0) {
      const t = (nextKm * 1000 - acc) / seg; // fraction along this segment
      const a = fitted.pts[i - 1], b = fitted.pts[i];
      out.push({ km: nextKm, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      nextKm++;
    }
    acc += seg;
  }
  return out;
}

// paceFromTimes derives a per-vertex pace (sec/km) from coordinates + per-vertex
// timestamps, then lightly smooths it with a rolling window so GPS jitter doesn't
// make the colour flicker segment-to-segment.
function paceFromTimes(coords: LatLng[], times: number[]): (number | null)[] {
  const raw: (number | null)[] = [null];
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    const dt = (times[i] - times[i - 1]) / 1000;
    raw.push(d > 1 && dt > 0 ? dt / (d / 1000) : null);
  }
  // Rolling average over ±2 neighbours (ignoring nulls).
  return raw.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      if (raw[j] != null) { sum += raw[j] as number; n++; }
    }
    return n ? sum / n : null;
  });
}

// paceSegments builds coloured line segments from per-vertex pace. Pace is
// normalised to the run's own 10th–90th percentile so the ramp reads well for
// any runner, then mapped green (fast) → amber → red (slow). Downsampled so a
// long run doesn't emit thousands of SVG nodes.
function paceSegments(pts: { x: number; y: number }[], paces: (number | null)[]) {
  const valid = paces.filter((p): p is number => p != null && isFinite(p) && p > 0).sort((a, b) => a - b);
  if (valid.length < 2) return null;
  const lo = valid[Math.floor(valid.length * 0.1)];
  const hi = valid[Math.floor(valid.length * 0.9)] || lo + 1;

  const step = Math.max(1, Math.ceil(pts.length / MAX_SEG));
  const segs: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  for (let i = step; i < pts.length; i += step) {
    const p = paces[i] ?? paces[i - 1];
    const t = p == null ? 0.5 : clamp01((p - lo) / (hi - lo || 1)); // 0 fast → 1 slow
    segs.push({ x1: pts[i - step].x, y1: pts[i - step].y, x2: pts[i].x, y2: pts[i].y, color: paceColor(t) });
  }
  return segs;
}

// paceColor ramps 0 (fast) → green, 0.5 → amber, 1 (slow) → red.
function paceColor(t: number): string {
  const c = t < 0.5
    ? mix([22, 163, 74], [245, 158, 11], t / 0.5) // green → amber
    : mix([245, 158, 11], [220, 38, 38], (t - 0.5) / 0.5); // amber → red
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function mix(a: number[], b: number[], t: number): number[] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// haversine — great-circle distance between two coords, in metres.
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
