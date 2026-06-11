// BadgeMedal: a medal rendered in SVG. Two faithful sizes:
//  - compact (< 90px): a crisp coin — metallic ring + inner disc + emoji.
//    No ribbon: at grid sizes the straps just turn to visual mush.
//  - ceremonial (>= 90px): the full medal with hanging ribbon, for the unlock
//    moment and detail views.
// Locked badges render as grey silhouettes (the wall pairs them with progress).

import { Text, View } from "react-native";
import Svg, { Circle, Defs, Path, Polygon, RadialGradient, Stop } from "react-native-svg";

// blend mixes a hex color toward white (amt>0) or black (amt<0).
function blend(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    const t = amt >= 0 ? 255 : 0;
    return Math.round(v + (t - v) * Math.abs(amt));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

type Props = {
  emoji: string;
  color: string; // tier accent (gold/silver/bronze)
  size?: number;
  locked?: boolean;
};

export function BadgeMedal({ emoji, color, size = 72, locked = false }: Props) {
  const c = locked ? "#A6B0BD" : color;
  const gid = `medal-${c.replace(/[^a-zA-Z0-9]/g, "")}-${size}`;
  const ceremonial = size >= 90;

  // Coin geometry: centered for compact; hung below the ribbon for ceremonial.
  const cx = size / 2;
  const cy = ceremonial ? size * 0.58 : size / 2;
  const r = ceremonial ? size * 0.36 : size * 0.44;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: locked ? 0.45 : 1 }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gid} cx="38%" cy="32%" r="80%">
            <Stop offset="0%" stopColor={blend(c, 0.55)} />
            <Stop offset="55%" stopColor={c} />
            <Stop offset="100%" stopColor={blend(c, -0.3)} />
          </RadialGradient>
        </Defs>
        {ceremonial && (
          <>
            {/* Ribbon straps — only at sizes where they read cleanly */}
            <Polygon
              points={`${cx - size * 0.2},0 ${cx - size * 0.02},0 ${cx},${cy - r * 0.6} ${cx - size * 0.11},${cy - r * 0.45}`}
              fill={locked ? "#7C8794" : blend(c, -0.25)}
            />
            <Polygon
              points={`${cx + size * 0.02},0 ${cx + size * 0.2},0 ${cx + size * 0.11},${cy - r * 0.45} ${cx},${cy - r * 0.6}`}
              fill={locked ? "#8B96A5" : blend(c, -0.1)}
            />
          </>
        )}
        {/* Medal body: sheen ring + inner disc */}
        <Circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
        <Circle cx={cx} cy={cy} r={r * 0.76} fill={blend(c, locked ? 0.22 : 0.34)} />
        {/* Gloss arc, top-left — one clean highlight, no extra ornament */}
        <Path
          d={`M ${cx - r * 0.58} ${cy - r * 0.3} A ${r * 0.68} ${r * 0.68} 0 0 1 ${cx + r * 0.08} ${cy - r * 0.64}`}
          stroke="rgba(255,255,255,0.65)"
          strokeWidth={Math.max(1.5, size * 0.03)}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Text
        style={{
          position: "absolute",
          top: cy - r * 0.52,
          fontSize: r * 1.0,
          lineHeight: r * 1.15,
          opacity: locked ? 0.55 : 1,
        }}
      >
        {emoji}
      </Text>
    </View>
  );
}
