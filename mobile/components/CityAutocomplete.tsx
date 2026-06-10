// CityAutocomplete — an inline type-ahead city field. As the user types, a
// dropdown suggests matches: cities that already have clubs first (with a count
// badge — social proof), then the Indian-cities list (prefix matches before
// substring matches). Free text still works for cities we don't know yet.

import { useEffect, useMemo, useState } from "react";
import { Keyboard, Text, TextInput, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { publicCities, type CityCount } from "../lib/discover";
import { INDIAN_CITIES } from "../lib/cities";
import { Tap } from "./Tap";
import { colors, styles } from "../lib/theme";

type Props = {
  value: string;
  onChange: (city: string) => void;
  /** Called when a suggestion is tapped (a definite choice, not just typing). */
  onPick?: (city: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: ViewStyle;
};

const ALL_CITIES = Array.from(new Set(INDIAN_CITIES)).sort((a, b) => a.localeCompare(b));
const MAX_SUGGESTIONS = 6;

export function CityAutocomplete({ value, onChange, onPick, placeholder = "Your city (e.g. Pune)", autoFocus, style }: Props) {
  const [clubCities, setClubCities] = useState<CityCount[]>([]);
  const [focused, setFocused] = useState(false);

  // Cities that already have clubs — ranked first in suggestions.
  useEffect(() => {
    publicCities().then(setClubCities).catch(() => {});
  }, []);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const out: { city: string; clubs: number }[] = [];
    const seen = new Set<string>();
    const push = (city: string, clubs: number) => {
      const key = city.toLowerCase();
      if (seen.has(key) || key === q) return;
      seen.add(key);
      out.push({ city, clubs });
    };
    // 1. Cities with clubs (prefix, then substring).
    for (const c of clubCities) if (c.city.toLowerCase().startsWith(q)) push(c.city, c.clubs);
    for (const c of clubCities) if (c.city.toLowerCase().includes(q)) push(c.city, c.clubs);
    // 2. The full city list (prefix, then substring).
    for (const c of ALL_CITIES) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (c.toLowerCase().startsWith(q)) push(c, 0);
    }
    for (const c of ALL_CITIES) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (c.toLowerCase().includes(q)) push(c, 0);
    }
    return out.slice(0, MAX_SUGGESTIONS);
  }, [value, clubCities]);

  function pick(city: string) {
    onChange(city);
    onPick?.(city);
    setFocused(false);
    Keyboard.dismiss();
  }

  const open = focused && suggestions.length > 0;

  return (
    <View style={style}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        // Delay the blur-close so a tap on a suggestion still lands.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoFocus={autoFocus}
      />
      {open && (
        <View
          style={{
            backgroundColor: colors.bg,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            marginTop: 6,
            overflow: "hidden",
          }}
        >
          {suggestions.map((s, i) => (
            <Tap
              key={s.city}
              haptic={false}
              onPress={() => pick(s.city)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: i === suggestions.length - 1 ? 0 : 1,
                borderBottomColor: colors.border,
              }}
            >
              <Ionicons name="location-outline" size={16} color={s.clubs > 0 ? colors.primary : colors.muted} />
              <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: s.clubs > 0 ? "700" : "400" }}>{s.city}</Text>
              {s.clubs > 0 && (
                <View style={{ backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800" }}>
                    {s.clubs} {s.clubs === 1 ? "club" : "clubs"}
                  </Text>
                </View>
              )}
            </Tap>
          ))}
        </View>
      )}
    </View>
  );
}
