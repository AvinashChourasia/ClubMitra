// Splits — a per-kilometre breakdown of a run. Each row shows the km number, a
// pace bar (longer = faster, coloured on the same green→red ramp as the route),
// and the split's pace. The fastest km gets a badge. Rows are tappable and drive
// the map (selecting a km flies the camera to that split marker).

import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Split } from "../lib/pace";
import { paceColor } from "../lib/pace";
import { formatPace } from "../lib/format";
import { Tap } from "./Tap";
import { colors, styles } from "../lib/theme";

type Props = {
  splits: Split[];
  selectedKm?: number | null;
  onSelect?: (km: number | null) => void;
};

export function Splits({ splits, selectedKm = null, onSelect }: Props) {
  if (splits.length < 1) return null;

  const paces = splits.map((s) => s.paceSPerKm);
  const fast = Math.min(...paces);
  const slow = Math.max(...paces);
  const span = slow - fast || 1;
  const fastestKm = splits.find((s) => s.paceSPerKm === fast)?.km;

  return (
    <View style={[styles.card, { gap: 2 }]}>
      <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>Splits</Text>
      {splits.map((s) => {
        const t = (s.paceSPerKm - fast) / span; // 0 fast → 1 slow
        const barFrac = 0.25 + (1 - t) * 0.75; // fastest longest, slowest still visible
        const sel = s.km === selectedKm;
        return (
          <Tap
            key={s.km}
            haptic={false}
            onPress={() => onSelect?.(sel ? null : s.km)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 9,
              paddingHorizontal: 8,
              borderRadius: 10,
              backgroundColor: sel ? colors.primarySoft : "transparent",
            }}
          >
            <Text style={{ width: 28, color: colors.text, fontWeight: "800", fontSize: 13 }}>{s.km}</Text>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bgSecondary, overflow: "hidden" }}>
              <View style={{ width: `${barFrac * 100}%`, height: "100%", borderRadius: 5, backgroundColor: paceColor(t) }} />
            </View>
            <Text style={{ width: 64, textAlign: "right", color: colors.text, fontWeight: "700", fontSize: 13 }}>
              {formatPace(s.paceSPerKm)}
            </Text>
            {s.km === fastestKm ? (
              <Ionicons name="flash" size={14} color="#F59E0B" />
            ) : (
              <View style={{ width: 14 }} />
            )}
          </Tap>
        );
      })}
    </View>
  );
}
