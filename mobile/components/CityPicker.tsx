// CityPicker: a tappable field that opens a searchable list of Indian cities.
// If the user's city isn't listed, they can still use whatever they typed.

import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, styles } from "../lib/theme";
import { INDIAN_CITIES } from "../lib/cities";

type Props = {
  value: string | null;
  onChange: (city: string) => void;
  placeholder?: string;
};

// Sorted, de-duplicated city list (built once).
const CITIES = Array.from(new Set(INDIAN_CITIES)).sort((a, b) => a.localeCompare(b));

export function CityPicker({ value, onChange, placeholder = "Select city" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CITIES;
    return CITIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  // Offer the typed value as a custom option when it isn't an exact match.
  const trimmed = query.trim();
  const showCustom = trimmed.length > 0 && !CITIES.some((c) => c.toLowerCase() === trimmed.toLowerCase());

  // Built in render so it reads the live (themed) palette.
  const rowStyle = { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border } as const;

  function pick(city: string) {
    onChange(city);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <Pressable
        style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
        onPress={() => setOpen(true)}
      >
        <Text style={{ fontSize: 16, color: value ? colors.text : colors.muted }}>{value || placeholder}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ padding: 16, gap: 12, flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Select city</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 15 }}>Close</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Search cities…"
              placeholderTextColor={colors.muted}
              autoFocus
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
            />

            <FlatList
              data={results}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                showCustom ? (
                  <Pressable onPress={() => pick(trimmed)} style={rowStyle}>
                    <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 15 }}>Use “{trimmed}”</Text>
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={
                showCustom ? null : <Text style={{ color: colors.muted, padding: 14 }}>No matches.</Text>
              }
              renderItem={({ item }) => (
                <Pressable onPress={() => pick(item)} style={rowStyle}>
                  <Text style={{ color: value === item ? colors.primary : colors.text, fontSize: 15, fontWeight: value === item ? "700" : "400" }}>
                    {item}
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
