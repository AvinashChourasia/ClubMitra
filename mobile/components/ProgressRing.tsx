// ProgressRing: an animated circular progress gauge — gradient stroke with a
// soft glow halo, sweeping from 12 o'clock on mount. The 2026 replacement for
// flat progress bars on challenge heroes. Center content is whatever children
// you pass (big number, unit, %).

import { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  size?: number;
  stroke?: number;
  fraction: number; // 0..1
  colors?: readonly [string, string]; // gradient stops for the arc
  track?: string; // background ring color
  children?: React.ReactNode;
};

export function ProgressRing({
  size = 140,
  stroke = 13,
  fraction,
  colors = ["#FF8A9B", "#E11D2E"],
  track = "rgba(127,127,127,0.18)",
  children,
}: Props) {
  const pct = Math.max(0, Math.min(1, fraction));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sweep = useRef(new Animated.Value(0)).current;
  // Unique gradient id per instance so multiple rings on one screen don't clash.
  const gid = useRef(`ring-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    Animated.timing(sweep, {
      toValue: pct,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a native-driver prop
    }).start();
  }, [pct, sweep]);

  const dashOffset = sweep.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Defs>
          <SvgGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors[0]} />
            <Stop offset="100%" stopColor={colors[1]} />
          </SvgGradient>
        </Defs>
        {/* Track */}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {/* Glow halo: same arc, wider + faint, sits behind the crisp stroke */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors[1]}
          opacity={0.25}
          strokeWidth={stroke + 7}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
        />
        {/* Progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      {children}
    </View>
  );
}

// useCountUp: animates a number 0 → target on mount (and when target changes),
// for odometer-style stats next to the ring.
export function useCountUp(target: number, duration = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic, matches the ring
      setValue(target * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
