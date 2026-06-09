// RouteTrace — draws a run's GPS route as a clean SVG line, with no map tiles
// and no API key (Google or Apple). It projects lat/lng to screen space with a
// simple equirectangular projection (longitude scaled by cos(latitude) so the
// shape isn't squashed), fits it to the box, and flips Y so north points up.
//
// Used both live while recording (the line grows as you run) and on the saved
// run's detail screen. Renders anywhere react-native-svg runs — including Expo
// Go — so the route view never needs a dev build.

import { useMemo } from "react";
import { Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import type { LatLng } from "../lib/activities";
import { colors } from "../lib/theme";

type Props = {
  coords: LatLng[];
  height?: number;
  /** Live mode dims the "finish" dot to a moving cursor (still recording). */
  live?: boolean;
  style?: ViewStyle;
};

// Inner padding so the line and end-dots never touch the rounded edges.
const PAD = 16;
const DOT = 5;

export function RouteTrace({ coords, height = 220, live = false, style }: Props) {
  // Project + fit the route into a unit-ish box. Recomputed only when the point
  // count changes (cheap, and live mode pushes one point at a time).
  const fitted = useMemo(() => project(coords, height), [coords, height]);

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

  return (
    <View style={[{ borderRadius: 16, overflow: "hidden", backgroundColor: colors.bgSecondary }, style]}>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {/* Soft underlay for a bit of depth, then the route on top. */}
        <Path d={d} stroke={colors.primary} strokeOpacity={0.18} strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={d} stroke={colors.primary} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Start marker (green). */}
        <Circle cx={start.x} cy={start.y} r={DOT + 2} fill="#fff" />
        <Circle cx={start.x} cy={start.y} r={DOT} fill={colors.success} />
        {/* Finish / current position. Pulsey cursor while live, red flag when done. */}
        <Circle cx={end.x} cy={end.y} r={DOT + 2} fill="#fff" />
        <Circle cx={end.x} cy={end.y} r={DOT} fill={live ? colors.primary : colors.danger} />
      </Svg>
    </View>
  );
}

// project maps lat/lng to box coordinates, preserving aspect ratio. We size the
// viewBox to a 16:height-ish box and letter-box the route inside it.
function project(coords: LatLng[], height: number) {
  if (coords.length < 2) return null;

  const meanLatRad = (coords.reduce((s, c) => s + c.latitude, 0) / coords.length) * (Math.PI / 180);
  const kx = Math.cos(meanLatRad) || 1e-6; // longitude shrinks toward the poles

  // World-space points (x scaled for latitude, y = latitude). Y is flipped later.
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

  // viewBox: fixed height, width derived from the route's aspect ratio (clamped
  // so a near-straight run still gets a sensible box).
  const h = height;
  const innerH = h - PAD * 2;
  const aspect = spanX / spanY;
  const innerW = Math.max(40, Math.min(innerH * aspect, innerH * 3));
  const w = innerW + PAD * 2;

  const pts = world.map((p) => ({
    x: PAD + ((p.x - minX) / spanX) * innerW,
    y: PAD + (1 - (p.y - minY) / spanY) * innerH, // flip Y so north is up
  }));

  return { pts, w, h };
}
