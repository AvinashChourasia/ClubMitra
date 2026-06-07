// TimePicker: a tappable field that opens a list of times (15-min steps). Value
// is "HH:MM" (24-hour) or null for "Time TBD" (time is optional on a run).

import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, styles } from "../lib/theme";

// Build "HH:MM" slots from 04:00 to 21:45 in 15-minute steps.
const TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 4; h <= 21; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
    }
  }
  return out;
})();

// "06:30" -> "6:30 AM".
export function label12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ampm}`;
}

type Props = {
  value: string | null; // "HH:MM" or null
  onChange: (time: string | null) => void;
};

export function TimePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  function pick(t: string | null) {
    onChange(t);
    setOpen(false);
  }

  // Built in render so it reads the live (themed) palette.
  const rowStyle = { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border } as const;

  return (
    <>
      <Pressable
        style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
        onPress={() => setOpen(true)}
      >
        <Text style={{ fontSize: 16, color: value ? colors.text : colors.muted }}>
          {value ? label12h(value) : "Time TBD (optional)"}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ padding: 16, gap: 12, flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Pick a time</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 15 }}>Close</Text>
              </Pressable>
            </View>

            <FlatList
              data={TIMES}
              keyExtractor={(t) => t}
              ListHeaderComponent={
                <Pressable onPress={() => pick(null)} style={rowStyle}>
                  <Text style={{ color: colors.muted, fontSize: 15, fontWeight: "600" }}>No specific time (TBD)</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <Pressable onPress={() => pick(item)} style={rowStyle}>
                  <Text style={{ color: value === item ? colors.primary : colors.text, fontSize: 15, fontWeight: value === item ? "700" : "400" }}>
                    {label12h(item)}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
