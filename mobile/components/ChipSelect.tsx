// ChipSelect: a row of selectable "chips" for picking one value from a small
// set (running level, t-shirt size). Shared by register + edit-profile so the
// look and behaviour stay consistent.

import { Pressable, Text, View } from "react-native";
import { colors } from "../lib/theme";

type Option = { key: string; label: string };

type Props = {
  options: Option[] | string[];
  value: string | null;
  onChange: (key: string | null) => void;
  // When true, tapping the selected chip clears it (used for optional fields).
  allowDeselect?: boolean;
};

export function ChipSelect({ options, value, onChange, allowDeselect = false }: Props) {
  const normalized: Option[] = options.map((o) => (typeof o === "string" ? { key: o, label: o } : o));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {normalized.map((opt) => {
        const selected = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(selected && allowDeselect ? null : opt.key)}
            style={{
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : colors.bg,
              borderRadius: 8,
              paddingVertical: 8,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: selected ? "#fff" : colors.text, fontWeight: "600" }}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
