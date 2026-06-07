// A simple horizontal progress bar: a filled track showing fraction 0..1.
// Used on challenge cards to show "progress toward the target distance".

import { View } from "react-native";

import { colors } from "../lib/theme";

export function ProgressBar({ fraction, height = 8 }: { fraction: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, fraction)); // clamp to [0,1]
  return (
    <View
      style={{
        height,
        backgroundColor: colors.border,
        borderRadius: height / 2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          backgroundColor: colors.primary,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}
