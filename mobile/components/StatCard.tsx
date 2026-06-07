// StatCard: one metric tile — a big value over a small uppercase label.
// Shared by the live run screen and the activity rows so every stat looks the
// same. This is the first component in components/ (UI building blocks), kept
// separate from lib/ (logic) — the same handler-vs-service split, for the UI.

import { Text, View } from "react-native";

import { colors, styles } from "../lib/theme";

type Props = {
  label: string;
  value: string;
  // Optional accent color for the value (e.g. green for elevation). Defaults to
  // the normal text color.
  valueColor?: string;
};

export function StatCard({ label, value, valueColor }: Props) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// StatRow: a horizontal group of StatCards with consistent spacing.
export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 12 }}>{children}</View>;
}

// A faint divider, handy between sections.
export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />;
}
