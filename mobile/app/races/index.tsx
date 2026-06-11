// Race calendar — upcoming races, community-listed. Filter to your city or see
// all, mark yourself going (with a live count), add any race straight to your
// phone/Google calendar, and list a race for others with the + button.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { listRaces, createRace, toggleGoing, deleteRace, addRaceToCalendar, type Race } from "../../lib/races";
import { CityAutocomplete } from "../../components/CityAutocomplete";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { colors, styles, useThemeMode } from "../../lib/theme";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dateBlock(ymd: string): { day: string; month: string; weekday: string } {
  const d = new Date(`${ymd}T12:00:00`);
  if (isNaN(d.getTime())) return { day: "?", month: "", weekday: "" };
  return {
    day: String(d.getDate()),
    month: MONTHS[d.getMonth()],
    weekday: d.toLocaleDateString([], { weekday: "long" }),
  };
}

export default function Races() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [races, setRaces] = useState<Race[] | null>(null);
  const [myCityOnly, setMyCityOnly] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create-form state
  const [title, setTitle] = useState("");
  const [city, setCity] = useState(user?.city ?? "");
  const [date, setDate] = useState("");
  const [distances, setDistances] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (cityOnly: boolean) => {
    const token = await getAccessToken();
    if (!token) return;
    setRaces(await listRaces(token, cityOnly ? user?.city ?? undefined : undefined));
  }, [getAccessToken, user?.city]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load(myCityOnly);
        } catch {
          if (active) setRaces([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [load, myCityOnly])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load(myCityOnly);
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  async function onGoing(r: Race) {
    setBusyId(r.id);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await toggleGoing(token, r.id);
      setRaces((rs) => (rs ?? []).map((x) => (x.id === r.id ? { ...x, going: res.going, going_count: res.going_count } : x)));
    } catch {
      /* row unchanged */
    } finally {
      setBusyId(null);
    }
  }

  async function onAddToCalendar(r: Race) {
    const how = await addRaceToCalendar(r);
    if (how === "device") {
      Alert.alert("Added to your calendar 🗓️", `${r.title} is on ${r.race_date} — reminder set for the evening before.`);
    }
    // Google fallback opens externally; no alert needed.
  }

  function onDelete(r: Race) {
    Alert.alert("Remove this race?", r.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            const token = await getAccessToken();
            if (token) await deleteRace(token, r.id);
            await load(myCityOnly);
          } catch {
            /* keep */
          }
        },
      },
    ]);
  }

  async function onCreate() {
    if (!title.trim() || !city.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert("Almost there", "Race name, city, and a date in YYYY-MM-DD form are required.");
      return;
    }
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await createRace(token, {
        title: title.trim(),
        city: city.trim(),
        race_date: date.trim(),
        distances: distances.trim(),
        url: url.trim() || undefined,
      });
      setCreating(false);
      setTitle("");
      setDate("");
      setDistances("");
      setUrl("");
      await load(myCityOnly);
    } catch (e) {
      Alert.alert("Couldn't add race", e instanceof Error ? e.message : "Check the details and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tap
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            hitSlop={12}
            haptic={false}
            style={{ marginLeft: -8, padding: 6 }}
          >
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Tap>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Race calendar</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Find your next start line</Text>
          </View>
          <Tap onPress={() => setCreating(true)} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Tap>
        </View>

        {/* City filter */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Tap
            haptic={false}
            onPress={() => setMyCityOnly(true)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: myCityOnly ? colors.primary : colors.bg, borderWidth: 1, borderColor: myCityOnly ? colors.primary : colors.border }}
          >
            <Text style={{ color: myCityOnly ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>
              {user.city ? user.city : "My city"}
            </Text>
          </Tap>
          <Tap
            haptic={false}
            onPress={() => setMyCityOnly(false)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: !myCityOnly ? colors.primary : colors.bg, borderWidth: 1, borderColor: !myCityOnly ? colors.primary : colors.border }}
          >
            <Text style={{ color: !myCityOnly ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>All cities</Text>
          </Tap>
        </View>

        {races === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : races.length === 0 ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="flag" size={28} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>No upcoming races{myCityOnly && user.city ? ` in ${user.city}` : ""}</Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              Know one? Add it with the + button so the whole community sees it.
            </Text>
          </View>
        ) : (
          races.map((r) => {
            const d = dateBlock(r.race_date);
            return (
              <View key={r.id} style={[styles.card, { gap: 12 }]}>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  {/* Date block */}
                  <View style={{ width: 56, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", paddingVertical: 10 }}>
                    <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 }}>{d.day}</Text>
                    <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={2}>{r.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                      {d.weekday} · {r.city}{r.distances ? ` · ${r.distances}` : ""}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
                      <Ionicons name="people" size={13} color={colors.muted} />
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {r.going_count} going{r.going ? " · including you" : ""}
                      </Text>
                    </View>
                  </View>
                  {r.created_by === user.id && (
                    <Pressable onPress={() => onDelete(r)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.subtle} />
                    </Pressable>
                  )}
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Tap
                    onPress={() => void onGoing(r)}
                    disabled={busyId === r.id}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: r.going ? colors.success : colors.primary,
                      opacity: busyId === r.id ? 0.6 : 1,
                    }}
                  >
                    <Ionicons name={r.going ? "checkmark-circle" : "walk"} size={16} color="#fff" />
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{r.going ? "You're going" : "I'm going"}</Text>
                  </Tap>
                  <Tap
                    onPress={() => void onAddToCalendar(r)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Ionicons name="calendar" size={15} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>Calendar</Text>
                  </Tap>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add-a-race sheet */}
      {creating && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setCreating(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, gap: 10 }}>
              <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 6 }} />
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>List a race</Text>
              <TextInput style={styles.input} placeholder="Race name (e.g. Bengaluru Half Marathon)" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
              <CityAutocomplete value={city} onChange={setCity} placeholder="City" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.muted} value={date} onChangeText={setDate} autoCapitalize="none" />
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Distances (5K · 10K)" placeholderTextColor={colors.muted} value={distances} onChangeText={setDistances} />
              </View>
              <TextInput style={styles.input} placeholder="Registration link (optional)" placeholderTextColor={colors.muted} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />
              <Button label="Add race" onPress={() => void onCreate()} loading={saving} />
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </SafeAreaView>
  );
}
