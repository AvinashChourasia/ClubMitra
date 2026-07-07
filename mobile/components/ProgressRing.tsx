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
  /** Sweep animation on mount. Turn OFF for small rings stacked in lists —
      the tween is JS-driven (strokeDashoffset can't be native), so each ring
      costs ~66 frames of bridge traffic right through the nav transition. */
  animate?: boolean;
  children?: React.ReactNode;
};

export function ProgressRing({
  size = 140,
  stroke = 13,
  fraction,
  colors = ["#F87171", "#DC2626"],
  track = "rgba(127,127,127,0.18)",
  animate = true,
  children,
}: Props) {
  const pct = Math.max(0, Math.min(1, fraction));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sweep = useRef(new Animated.Value(animate ? 0 : pct)).current;
  // Unique gradient id per instance so multiple rings on one screen don't clash.
  const gid = useRef(`ring-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    if (!animate) {
      sweep.setValue(pct); // one prop update, no per-frame tween
      return;
    }
    Animated.timing(sweep, {
      toValue: pct,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a native-driver prop
    }).start();
  }, [pct, sweep, animate]);

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
    let committed = 0;
    const t0 = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic, matches the ring
      const next = target * eased;
      // Throttle: every setValue is a full component re-render, and 60/s of
      // them land exactly during the nav transition. Skip sub-0.5% steps;
      // always commit the final frame so we end exactly on target.
      if (k >= 1 || Math.abs(next - committed) >= Math.abs(target) * 0.005) {
        committed = next;
        setValue(next);
      }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
