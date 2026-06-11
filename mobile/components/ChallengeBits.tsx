// Shared challenge visuals: each challenge type's identity (icon, tint, ring +
// hero gradients) and the pulsing LiveDot — used by the tab and the detail page
// so the two always match.

import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { gradients } from "../lib/theme";
import type { ChallengeType } from "../lib/challenges";

export const TYPE_THEME: Record<
  ChallengeType,
  { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string; ring: readonly [string, string]; hero: readonly [string, string] }
> = {
  distance: { label: "Distance", icon: "speedometer", tint: "#E11D2E", ring: ["#FF8A9B", "#E11D2E"], hero: gradients.red },
  days: { label: "Run days", icon: "calendar", tint: "#4F46E5", ring: ["#818CF8", "#4F46E5"], hero: gradients.cool },
  streak: { label: "Streak", icon: "flame", tint: "#F59E0B", ring: ["#FCD34D", "#F59E0B"], hero: gradients.sunset },
};

// LiveDot: the pulsing "this is happening now" indicator.
export function LiveDot({ color = "#fff", size = 7 }: { color?: string; size?: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }],
      }}
    />
  );
}
