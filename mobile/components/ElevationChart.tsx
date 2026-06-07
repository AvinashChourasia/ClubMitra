// A tiny elevation profile chart, drawn with plain Views — no charting library.
// Each altitude sample becomes a vertical bar; bars are scaled between the run's
// min and max altitude so the shape of the climb is visible. Kept dependency-
// free and small on purpose (matches the project's "few files" preference).

import { useMemo } from "react";
import { Text, View } from "react-native";

import { colors } from "../lib/theme";

type Props = {
  // Altitude in meters, one value per GPS point, in order.
  series: number[];
  height?: number;
};

export function ElevationChart({ series, height = 90 }: Props) {
  const { min, max, bars } = useMemo(() => {
    if (series.length < 2) return { min: 0, max: 0, bars: [] as number[] };
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const span = hi - lo || 1; // avoid /0 on a perfectly flat run
    // Normalize each sample to 0..1 for its bar height fraction.
    return { min: lo, max: hi, bars: series.map((a) => (a - lo) / span) };
  }, [series]);

  // Need at least a couple of 3D points to show anything meaningful.
  if (bars.length < 2) {
    return (
      <View
        style={{
          height,
          borderRadius: 12,
          backgroundColor: colors.bgSecondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.muted, fontSize: 13 }}>No elevation data for this run</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          height,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 1,
          backgroundColor: colors.bgSecondary,
          borderRadius: 12,
          paddingHorizontal: 8,
          paddingVertical: 8,
          overflow: "hidden",
        }}
      >
        {bars.map((frac, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              // Keep a 2px minimum so even the lowest point is visible.
              height: Math.max(2, frac * (height - 16)),
              backgroundColor: colors.primary,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
            }}
          />
        ))}
      </View>
      {/* Min / max altitude labels for context. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{Math.round(min)} m</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{Math.round(max)} m</Text>
      </View>
    </View>
  );
}
