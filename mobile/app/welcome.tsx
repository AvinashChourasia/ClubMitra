// Welcome — the first thing a brand-new person sees. One screen: the brand, a
// city (GPS-detected or picked), and a single CTA into guest explore. No login
// wall — identity is asked for later, at the moment they try to act.

import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { publicCities, setGuestCity, markWelcomeSeen, type CityCount } from "../lib/discover";
import { Tap } from "../components/Tap";
import { Button } from "../components/Button";
import { GradientCard } from "../components/GradientCard";
import { colors, styles, gradients, useThemeMode } from "../lib/theme";

export default function Welcome() {
  const router = useRouter();
  useThemeMode();

  const [city, setCity] = useState("");
  const [cities, setCities] = useState<CityCount[]>([]);
  const [detecting, setDetecting] = useState(false);

  // Cities with clubs, busiest first — one-tap chips under the input.
  useEffect(() => {
    publicCities().then(setCities).catch(() => {});
  }, []);

  // GPS detect: ask for foreground permission only when tapped, reverse-geocode,
  // and fill the input (still editable — GPS city names aren't always right).
  async function detect() {
    setDetecting(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
      const places = await Location.reverseGeocodeAsync(loc.coords);
      const detected = places[0]?.city ?? places[0]?.subregion ?? places[0]?.region;
      if (detected) setCity(detected);
    } catch {
      /* leave the input manual */
    } finally {
      setDetecting(false);
    }
  }

  async function explore() {
    const chosen = city.trim();
    if (chosen) await setGuestCity(chosen);
    await markWelcomeSeen();
    router.replace("/explore");
  }

  async function toLogin() {
    await markWelcomeSeen();
    router.push("/login");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.screen, { flexGrow: 1, justifyContent: "center" }]} keyboardShouldPersistTaps="handled">
        {/* Brand */}
        <View style={{ alignItems: "center", gap: 12, marginBottom: 18 }}>
          <GradientCard colors={gradients.red} glowColor={colors.primary} radius={26} style={{ width: 84, height: 84, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="walk" size={40} color="#fff" />
          </GradientCard>
          <Text style={{ fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.6 }}>ClubMitra</Text>
          <Text style={{ color: colors.muted, fontSize: 16, textAlign: "center" }}>
            Your city runs together.{"\n"}Find your club, race your challenges.
          </Text>
        </View>

        {/* City */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                placeholder="Your city (e.g. Pune)"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                value={city}
                onChangeText={setCity}
              />
            </View>
            <Tap onPress={detect} haptic={false} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
              {detecting ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            </Tap>
          </View>

          {/* One-tap city chips (cities that already have clubs) */}
          {cities.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {cities.slice(0, 6).map((c) => (
                <Tap
                  key={c.city}
                  haptic={false}
                  onPress={() => setCity(c.city)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: city.trim().toLowerCase() === c.city.toLowerCase() ? colors.primary : colors.bgSecondary,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                  }}
                >
                  <Text style={{ color: city.trim().toLowerCase() === c.city.toLowerCase() ? "#fff" : colors.text, fontWeight: "700", fontSize: 13 }}>
                    {c.city}
                  </Text>
                  <Text style={{ color: city.trim().toLowerCase() === c.city.toLowerCase() ? "rgba(255,255,255,0.8)" : colors.muted, fontSize: 12 }}>
                    {c.clubs}
                  </Text>
                </Tap>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 18 }} />

        <Button label={city.trim() ? `Explore clubs in ${city.trim()}` : "Explore clubs"} onPress={explore} />

        <Tap onPress={toLogin} haptic={false}>
          <Text style={styles.link}>Already a member? Log in</Text>
        </Tap>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
