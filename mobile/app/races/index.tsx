// Race calendar — real upcoming races, synced from MarathonMitra's public
// events API. Cards lead with the event banner; filter by your city and by
// distance (the runner's first question: "do they have my distance?"); mark
// yourself going, add to the phone calendar, and tap through to the
// MarathonMitra event page for full details + registration.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { listRaces, toggleGoing, deleteRace, addRaceToCalendar, MARATHONMITRA_SUBMIT_URL, type Race } from "../../lib/races";
import { Tap } from "../../components/Tap";
import { colors, styles, useThemeMode } from "../../lib/theme";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dateBlock(ymd: string): { day: string; month: string; weekday: string } {
  const d = new Date(`${ymd}T12:00:00`);
  if (isNaN(d.getTime())) return { day: "?", month: "", weekday: "" };
  return {
    day: String(d.getDate()),
    month: MONTHS[d.getMonth()],
    weekday: d.toLocaleDateString([], { weekday: "short" }),
  };
}

// Distance filter chips → which token must appear in the race's distances.
const DIST_FILTERS: { key: string; label: string; token: string }[] = [
  { key: "5k", label: "5K", token: "5K" },
  { key: "10k", label: "10K", token: "10K" },
  { key: "half", label: "Half", token: "Half Marathon" },
  { key: "full", label: "Marathon", token: "Marathon" },
];

export default function Races() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [races, setRaces] = useState<Race[] | null>(null);
  const [myCityOnly, setMyCityOnly] = useState(true);
  const [dist, setDist] = useState(""); // "" = all distances
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (cityOnly: boolean) => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      setRaces(await listRaces(token, cityOnly ? user?.city ?? undefined : undefined));
    } catch {
      // Keep the last-good list; only land on "empty" if we never had data.
      setRaces((prev) => prev ?? []);
    }
  }, [getAccessToken, user?.city]);

  useFocusEffect(
    useCallback(() => {
      void load(myCityOnly);
    }, [load, myCityOnly])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load(myCityOnly);
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

  // Race listings flow in from MarathonMitra (their submission + approval
  // system). The + button explains that and hands organizers over.
  function onAddRace() {
    Alert.alert(
      "List your race 🏁",
      "Races on this calendar come from MarathonMitra. Submit your marathon there — once it's approved, it appears here automatically.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open MarathonMitra", onPress: () => Linking.openURL(MARATHONMITRA_SUBMIT_URL).catch(() => {}) },
      ]
    );
  }

  if (!user) return <Redirect href="/login" />;

  const distToken = DIST_FILTERS.find((f) => f.key === dist)?.token;
  const visible = (races ?? []).filter((r) => {
    if (!distToken) return true;
    return r.distances.split("·").some((t) => t.trim() === distToken);
  });

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
          <Tap onPress={onAddRace} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Tap>
        </View>

        {/* City filter */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label={user.city ? user.city : "My city"} active={myCityOnly} onPress={() => setMyCityOnly(true)} />
          <Chip label="All cities" active={!myCityOnly} onPress={() => setMyCityOnly(false)} />
        </View>

        {/* Distance filter — the runner's first question */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip small label="All" active={dist === ""} onPress={() => setDist("")} />
          {DIST_FILTERS.map((f) => (
            <Chip key={f.key} small label={f.label} active={dist === f.key} onPress={() => setDist(dist === f.key ? "" : f.key)} />
          ))}
        </View>

        {races === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : visible.length === 0 ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="flag" size={28} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>
              No races match{myCityOnly && user.city ? ` in ${user.city}` : ""}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              {races.length === 0
                ? "Syncing from MarathonMitra — pull down to refresh in a moment."
                : "Try All cities or a different distance."}
            </Text>
          </View>
        ) : (
          visible.map((r) => (
            <RaceCard
              key={r.id}
              race={r}
              busy={busyId === r.id}
              mine={r.created_by === user.id}
              onGoing={() => void onGoing(r)}
              onCalendar={() => void onAddToCalendar(r)}
              onDelete={() => onDelete(r)}
            />
          ))
        )}

        {visible.length > 0 && (
          <Text style={{ color: colors.subtle, fontSize: 11, textAlign: "center" }}>
            Event data from MarathonMitra · tap a card for details & registration
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress, small }: { label: string; active: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Tap
      haptic={false}
      onPress={onPress}
      style={{
        paddingHorizontal: small ? 12 : 14,
        paddingVertical: small ? 6 : 8,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : colors.bg,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.muted, fontWeight: "700", fontSize: small ? 12 : 13 }}>{label}</Text>
    </Tap>
  );
}

// RaceCard — the event banner leads (every MarathonMitra event has one), the
// date rides on it, distances are scannable chips, and the whole card taps
// through to the event page. User-listed races without a banner fall back to
// the classic date-block layout.
function RaceCard({
  race: r,
  busy,
  mine,
  onGoing,
  onCalendar,
  onDelete,
}: {
  race: Race;
  busy: boolean;
  mine: boolean;
  onGoing: () => void;
  onCalendar: () => void;
  onDelete: () => void;
}) {
  const d = dateBlock(r.race_date);
  const openDetails = r.url ? () => Linking.openURL(r.url!).catch(() => {}) : undefined;
  const distances = r.distances ? r.distances.split("·").map((t) => t.trim()).filter(Boolean) : [];

  return (
    <Tap onPress={openDetails ?? (() => {})} haptic={!!openDetails} style={[styles.card, { padding: 0, overflow: "hidden", gap: 0 }]}>
      {r.image_url ? (
        <View>
          <Image source={{ uri: r.image_url }} style={{ width: "100%", height: 150 }} resizeMode="cover" />
          {/* Date chip riding the banner */}
          <View style={{ position: "absolute", top: 10, left: 10, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" }}>
            <Text style={{ color: "#0F172A", fontSize: 17, fontWeight: "900", letterSpacing: -0.5, lineHeight: 19 }}>{d.day}</Text>
            <Text style={{ color: "#E11D2E", fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
          </View>
          {openDetails && (
            <View style={{ position: "absolute", top: 10, right: 10, backgroundColor: "rgba(2,6,23,0.55)", borderRadius: 999, padding: 7 }}>
              <Ionicons name="open-outline" size={14} color="#fff" />
            </View>
          )}
        </View>
      ) : null}

      <View style={{ padding: 14, gap: 9 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {/* No banner → classic date block keeps the layout scannable */}
          {!r.image_url && (
            <View style={{ width: 54, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", paddingVertical: 9, alignSelf: "flex-start" }}>
              <Text style={{ color: colors.primary, fontSize: 21, fontWeight: "800", letterSpacing: -0.5 }}>{d.day}</Text>
              <Text style={{ color: colors.primary, fontSize: 10.5, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, letterSpacing: -0.2 }} numberOfLines={2}>
              {r.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
              <Ionicons name="location-outline" size={12} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
                {d.weekday} · {r.location ?? r.city}
              </Text>
            </View>
            {r.organizer ? (
              <Text style={{ color: colors.subtle, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                by {r.organizer}
              </Text>
            ) : null}
          </View>
          {mine && (
            <Pressable onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={colors.subtle} />
            </Pressable>
          )}
        </View>

        {/* Distance chips — what can I run here? */}
        {distances.length > 0 && (
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {distances.map((t) => (
              <View key={t} style={{ backgroundColor: colors.primarySoft, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontSize: 11.5, fontWeight: "800" }}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="people" size={13} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {r.going_count} going{r.going ? " · including you" : ""}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Tap
            onPress={onGoing}
            disabled={busy}
            style={{
              flex: 1,
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              gap: 6,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: r.going ? colors.success : colors.primary,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Ionicons name={r.going ? "checkmark-circle" : "walk"} size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{r.going ? "You're going" : "I'm going"}</Text>
          </Tap>
          <Tap
            onPress={onCalendar}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
          >
            <Ionicons name="calendar" size={15} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>Calendar</Text>
          </Tap>
        </View>
      </View>
    </Tap>
  );
}
