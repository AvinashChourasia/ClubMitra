// Podium3D: an isometric 3D podium for a challenge's top three — extruded
// gold/silver/bronze blocks (lit top face, shaded side face) with the runners
// standing on them, rising into place with a staggered spring. Pure SVG, no
// native modules, works everywhere react-native-svg does.

import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import Svg, { Polygon, Rect } from "react-native-svg";

import { Avatar } from "./Avatar";
import { colors } from "../lib/theme";

export type PodiumEntry = { name: string; score: string; you?: boolean };

const MEDAL = ["#F5C518", "#C7CEDB", "#D8965B"]; // gold / silver / bronze

// blend mixes a hex color toward white (amt>0) or black (amt<0) — cheap
// lighting for the box faces.
function blend(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    const t = amt >= 0 ? 255 : 0;
    return Math.round(v + (t - v) * Math.abs(amt));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// One extruded block. Oblique projection: front rectangle + parallelogram top
// (lighter) + parallelogram side (darker) = the 3D read.
function Block({ height, color, rank }: { height: number; color: string; rank: number }) {
  const W = 92; // total svg width
  const dx = 12; // horizontal depth offset
  const d = 10; // vertical depth offset
  const fw = W - dx; // front face width
  const H = height;
  return (
    <View>
      <Svg width={W} height={H + d}>
        {/* top face */}
        <Polygon points={`0,${d} ${dx},0 ${W},0 ${fw},${d}`} fill={blend(color, 0.42)} />
        {/* side face */}
        <Polygon points={`${fw},${d} ${W},0 ${W},${H}  ${fw},${H + d}`} fill={blend(color, -0.3)} />
        {/* front face */}
        <Rect x={0} y={d} width={fw} height={H} fill={color} />
        {/* gloss strip down the front */}
        <Rect x={0} y={d} width={fw} height={Math.max(10, H * 0.28)} fill="rgba(255,255,255,0.22)" />
      </Svg>
      <Text
        style={{
          position: "absolute",
          top: d,
          left: 0,
          width: fw,
          height: H,
          textAlign: "center",
          lineHeight: H,
          fontSize: Math.min(30, H - 14),
          fontWeight: "900",
          color: "rgba(255,255,255,0.92)",
          textShadowColor: "rgba(0,0,0,0.25)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 3,
        }}
      >
        {rank}
      </Text>
    </View>
  );
}

// One podium place: avatar + name + score above its rising block.
function Place({ entry, rank, height, delay }: { entry?: PodiumEntry; rank: number; height: number; delay: number }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(rise, { toValue: 1, delay, friction: 7, tension: 60, useNativeDriver: true }).start();
  }, [rise, delay]);

  return (
    <Animated.View
      style={{
        alignItems: "center",
        gap: 5,
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [44, 0] }) }],
      }}
    >
      {rank === 1 && <Text style={{ fontSize: 22, marginBottom: -2 }}>👑</Text>}
      {entry ? (
        <Avatar name={entry.name || "?"} size={rank === 1 ? 46 : 38} bg={entry.you ? colors.primary : colors.accent} />
      ) : (
        // Ghost slot: the step is still up for grabs.
        <View
          style={{
            width: rank === 1 ? 46 : 38,
            height: rank === 1 ? 46 : 38,
            borderRadius: 999,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.subtle, fontWeight: "800" }}>?</Text>
        </View>
      )}
      <Text numberOfLines={1} style={{ maxWidth: 92, color: entry?.you ? colors.primary : colors.text, fontWeight: "800", fontSize: 12 }}>
        {entry ? (entry.you ? "You" : entry.name) : "Open"}
      </Text>
      <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 11, marginTop: -3 }}>{entry?.score ?? "—"}</Text>
      <Block height={height} color={MEDAL[rank - 1]} rank={rank} />
    </Animated.View>
  );
}

// Podium3D lays out 2nd · 1st · 3rd, blocks bottom-aligned like a real podium.
export function Podium3D({ entries }: { entries: PodiumEntry[] }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6, paddingTop: 6 }}>
      <Place entry={entries[1]} rank={2} height={64} delay={160} />
      <Place entry={entries[0]} rank={1} height={92} delay={0} />
      <Place entry={entries[2]} rank={3} height={46} delay={300} />
    </View>
  );
}
