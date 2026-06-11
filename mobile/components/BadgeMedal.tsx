// BadgeMedal: a 3D-feeling medal rendered in SVG — hanging ribbon, metallic
// ring with a radial sheen, inner disc, gloss highlight, and the badge emoji at
// the center. Locked badges render as grey silhouettes (the wall pairs them
// with a progress bar).

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
  const c = locked ? "#9AA4B2" : color;
  const cx = size / 2;
  const ribbonW = size * 0.2;
  const cy = size * 0.58; // medal hangs below the ribbon
  const r = size * 0.36;
  const gid = `medal-${c.replace(/[^a-zA-Z0-9]/g, "")}-${size}`;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: locked ? 0.55 : 1 }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gid} cx="38%" cy="32%" r="80%">
            <Stop offset="0%" stopColor={blend(c, 0.55)} />
            <Stop offset="55%" stopColor={c} />
            <Stop offset="100%" stopColor={blend(c, -0.3)} />
          </RadialGradient>
        </Defs>
        {/* Ribbon straps */}
        <Polygon
          points={`${cx - ribbonW},0 ${cx - ribbonW * 0.1},0 ${cx},${cy - r * 0.6} ${cx - ribbonW * 0.55},${cy - r * 0.45}`}
          fill={locked ? "#7C8794" : blend(c, -0.25)}
        />
        <Polygon
          points={`${cx + ribbonW * 0.1},0 ${cx + ribbonW},0 ${cx + ribbonW * 0.55},${cy - r * 0.45} ${cx},${cy - r * 0.6}`}
          fill={locked ? "#8B96A5" : blend(c, -0.1)}
        />
        {/* Medal body: sheen ring + inner disc */}
        <Circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
        <Circle cx={cx} cy={cy} r={r * 0.78} fill={blend(c, locked ? 0.18 : 0.3)} />
        <Circle cx={cx} cy={cy} r={r * 0.78} stroke={blend(c, -0.2)} strokeWidth={1} fill="none" />
        {/* Gloss arc, top-left */}
        <Path
          d={`M ${cx - r * 0.62} ${cy - r * 0.28} A ${r * 0.7} ${r * 0.7} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.68}`}
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={size * 0.035}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Text
        style={{
          position: "absolute",
          top: cy - size * 0.17,
          fontSize: size * 0.3,
          opacity: locked ? 0.6 : 1,
        }}
      >
        {emoji}
      </Text>
    </View>
  );
}
