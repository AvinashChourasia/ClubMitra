// Race calendar — real upcoming races, synced from MarathonMitra's public
// events API. Cards lead with the event banner; filter by your city and by
// distance (the runner's first question: "do they have my distance?"); mark
// yourself going, add to the phone calendar, and tap through to the
// MarathonMitra event page for full details + registration.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useAuth } from "../../lib/auth";
import { listRaces, toggleGoing, deleteRace, addRaceToCalendar, dateBlock, countdownLabel, shortDist, cityMatch, MARATHONMITRA_SUBMIT_URL, type Race } from "../../lib/races";
import { Tap } from "../../components/Tap";
import { colors, styles, gradients, glow, radius, shadow, useThemeMode } from "../../lib/theme";

// Distance filter chips → which token must appear in the race's distances.
// Runners speak in shorthand: HM = half marathon, FM = full marathon.
const DIST_FILTERS: { key: string; label: string; token: string }[] = [
  { key: "5k", label: "5K", token: "5K" },
  { key: "10k", label: "10K", token: "10K" },
  { key: "half", label: "HM", token: "Half Marathon" },
  { key: "full", label: "FM", token: "Marathon" },
];

// Banner scrim (transparent → ink) so overlaid title text stays legible over any
// photo; gradient stops for the "I'm going" CTA in its two states.
const SCRIM = ["rgba(2,6,23,0)", "rgba(2,6,23,0.55)", "rgba(2,6,23,0.9)"] as const;
const SUCCESS_GRAD = ["#34D399", "#12B76A"] as const;

type Scope = "city" | "all" | "saved";

export default function Races() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [races, setRaces] = useState<Race[] | null>(null);
  // We pull the whole upcoming list once and filter on-device — that powers the
  // city picker, the "Saved" view, and instant chip switches with no refetch.
  const [scope, setScope] = useState<Scope>(user?.city ? "city" : "all");
  const [city, setCity] = useState<string>(user?.city ?? "");
  const [dist, setDist] = useState(""); // "" = all distances
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      setRaces(await listRaces(token)); // all upcoming; city/saved/distance filtered on-device
    } catch {
      // Keep the last-good list; only land on "empty" if we never had data.
      setRaces((prev) => prev ?? []);
    }
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Cities that actually have upcoming races, busiest first — the only cities
  // worth offering in the picker (no dead ends).
  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of races ?? []) {
      const c = r.city?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [races]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
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
            await load();
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

  const all = races ?? [];
  const savedCount = all.filter((r) => r.going).length;
  const distToken = DIST_FILTERS.find((f) => f.key === dist)?.token;
  const visible = all.filter((r) => {
    if (scope === "saved" && !r.going) return false;
    if (scope === "city" && city && !cityMatch(r.city, city)) return false;
    if (distToken && !r.distances.split("·").some((t) => t.trim() === distToken)) return false;
    return true;
  });

  // Empty-state copy depends on why the list is empty.
  let emptyIcon: keyof typeof Ionicons.glyphMap = "flag";
  let emptyTitle = "No races match";
  let emptyBody = "Try a different distance or city.";
  if (scope === "saved") {
    emptyIcon = "heart-outline";
    emptyTitle = "No saved races yet";
    emptyBody = "Tap “I’m going” on any race and it lands here — your personal start-line wishlist.";
  } else if (all.length === 0) {
    emptyTitle = "Syncing races";
    emptyBody = "Pulling the latest from MarathonMitra — pull down to refresh in a moment.";
  } else if (scope === "city" && city) {
    emptyTitle = `No races in ${city}`;
    emptyBody = "Try All cities or a different distance.";
  }

  function pickCity(c: string) {
    setCity(c);
    setScope("city");
    setPickerOpen(false);
  }

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

        {/* Scope: tap the city pill to search/switch cities, browse all, or open
            your saved wishlist. */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ScopeChip
            icon="location"
            label={city || "Pick city"}
            active={scope === "city"}
            trailing="chevron-down"
            onPress={() => setPickerOpen(true)}
          />
          <ScopeChip icon="earth" label="All cities" active={scope === "all"} onPress={() => setScope("all")} />
          <ScopeChip icon="heart" label="Saved" badge={savedCount} active={scope === "saved"} onPress={() => setScope("saved")} />
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
              <Ionicons name={emptyIcon} size={28} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12, textAlign: "center" }}>{emptyTitle}</Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 12 }}>{emptyBody}</Text>
          </View>
        ) : (
          visible.map((r, i) => (
            <RaceCard
              key={r.id}
              race={r}
              index={i}
              busy={busyId === r.id}
              mine={r.created_by === user.id}
              saved={r.going}
              onGoing={() => void onGoing(r)}
              onCalendar={() => void onAddToCalendar(r)}
              onDelete={() => onDelete(r)}
            />
          ))
        )}

        {visible.length > 0 && (
          <Text style={{ color: colors.subtle, fontSize: 11, textAlign: "center" }}>
            {visible.length} {visible.length === 1 ? "race" : "races"} · data from MarathonMitra · tap a card for details
          </Text>
        )}
      </ScrollView>

      <CityFilterSheet
        visible={pickerOpen}
        cities={cityOptions}
        selected={scope === "city" ? city : ""}
        onPick={pickCity}
        onClose={() => setPickerOpen(false)}
      />
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

// ScopeChip — the top-row filter pills (city / all cities / saved). Carries an
// icon, an optional trailing chevron (the city pill, signalling it opens the
// picker), and an optional count badge (Saved shows how many you've marked).
function ScopeChip({
  icon,
  label,
  active,
  onPress,
  trailing,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  trailing?: keyof typeof Ionicons.glyphMap;
  badge?: number;
}) {
  return (
    <Tap
      haptic={false}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : colors.bg,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Ionicons name={icon} size={14} color={active ? "#fff" : colors.muted} />
      <Text style={{ color: active ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
        {label}
      </Text>
      {badge !== undefined && badge > 0 ? (
        <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: active ? "rgba(255,255,255,0.25)" : colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: active ? "#fff" : colors.primary, fontSize: 11, fontWeight: "800" }}>{badge}</Text>
        </View>
      ) : null}
      {trailing ? <Ionicons name={trailing} size={13} color={active ? "rgba(255,255,255,0.85)" : colors.subtle} /> : null}
    </Tap>
  );
}

// CityFilterSheet — a searchable bottom-up list of the cities that actually have
// upcoming races (with a count each), so picking a city always lands on results.
// Modeled on the app's CityPicker for a consistent feel.
function CityFilterSheet({
  visible,
  cities,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  cities: { name: string; count: number }[];
  selected: string;
  onPick: (city: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = q ? cities.filter((c) => c.name.toLowerCase().includes(q)) : cities;

  function close() {
    setQuery("");
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      {/* Dim backdrop; tap to dismiss. */}
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.45)" }} />
      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "75%", ...shadow.xl }}>
        {/* Grab handle */}
        <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: 10, marginBottom: 6 }} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Choose a city</Text>
            <Pressable onPress={close} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 15 }}>Done</Text>
            </Pressable>
          </View>
          <View style={[styles.input, { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 0 }]}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <TextInput
              style={{ flex: 1, fontSize: 16, color: colors.text, paddingVertical: 13 }}
              placeholder="Search cities…"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
            />
          </View>
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.name}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          ListEmptyComponent={<Text style={{ color: colors.muted, paddingVertical: 18, textAlign: "center" }}>No cities with races match “{query.trim()}”.</Text>}
          renderItem={({ item }) => {
            const isSel = cityMatch(item.name, selected);
            return (
              <Pressable
                onPress={() => onPick(item.name)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.divider }}
              >
                <Ionicons name="location" size={16} color={isSel ? colors.primary : colors.subtle} />
                <Text style={{ flex: 1, color: isSel ? colors.primary : colors.text, fontSize: 15, fontWeight: isSel ? "800" : "500" }}>{item.name}</Text>
                <Text style={{ color: colors.subtle, fontSize: 13, fontWeight: "700" }}>{item.count}</Text>
                {isSel ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

// RaceCard — a 2026 hero card. The event banner leads full-bleed with an ink
// scrim; the title + place ride on the photo, a glassy date badge sits top-left,
// and a smart countdown ("In 3 days" / "Tomorrow") lights up top-right when the
// start line is near. Distance chips answer "can I run my race?", and the CTA is
// a glossy gradient. Motion sells the depth: each card springs up + scales in on
// mount (staggered down the list), and the whole surface tilts back in 3D on
// press. User-listed races without a banner fall back to the classic date block.
function RaceCard({
  race: r,
  index,
  busy,
  mine,
  saved,
  onGoing,
  onCalendar,
  onDelete,
}: {
  race: Race;
  index: number;
  busy: boolean;
  mine: boolean;
  saved: boolean;
  onGoing: () => void;
  onCalendar: () => void;
  onDelete: () => void;
}) {
  const d = dateBlock(r.race_date);
  const openDetails = r.url ? () => Linking.openURL(r.url!).catch(() => {}) : undefined;
  const distances = r.distances ? r.distances.split("·").map((t) => t.trim()).filter(Boolean) : [];
  const cd = countdownLabel(r.race_date);

  // 3D motion (native-driver Animated, no extra deps):
  // `mount` 0→1 springs the card up + scales it in, staggered by list position.
  // `press` 0→1 tilts the card back on a perspective axis while you hold it.
  const mount = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(mount, {
      toValue: 1,
      useNativeDriver: true,
      delay: Math.min(index, 8) * 65,
      speed: 11,
      bounciness: 7,
    }).start();
  }, [mount, index]);
  const pressTo = (v: number) =>
    Animated.spring(press, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();

  const animatedStyle = {
    opacity: mount,
    transform: [
      { perspective: 1000 },
      { translateY: mount.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
      { rotateX: press.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "7deg"] }) },
      {
        scale: Animated.multiply(
          mount.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] }),
          press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] })
        ),
      },
    ],
  };

  return (
    <Animated.View style={[styles.card, { padding: 0 }, animatedStyle]}>
      <Pressable
        onPressIn={() => pressTo(1)}
        onPressOut={() => pressTo(0)}
        onPress={() => {
          if (!openDetails) return;
          Haptics.selectionAsync().catch(() => {});
          openDetails();
        }}
        style={{ borderRadius: radius.xl, overflow: "hidden" }}
      >
        {r.image_url ? (
          <View>
            <Image source={{ uri: r.image_url }} style={{ width: "100%", height: 184 }} resizeMode="cover" />
            <LinearGradient
              colors={SCRIM}
              locations={[0, 0.5, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* Glassy date badge, top-left */}
            <View style={{ position: "absolute", top: 12, left: 12, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7, alignItems: "center", ...shadow.sm }}>
              <Text style={{ color: "#0F172A", fontSize: 18, fontWeight: "900", letterSpacing: -0.5, lineHeight: 20 }}>{d.day}</Text>
              <Text style={{ color: "#E11D2E", fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
            </View>

            {/* Top-right cluster: delete (if mine) + saved heart + countdown */}
            <View style={{ position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
              {mine && (
                <Pressable onPress={onDelete} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(2,6,23,0.5)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="trash-outline" size={15} color="#fff" />
                </Pressable>
              )}
              {saved ? (
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(225,29,46,0.95)", alignItems: "center", justifyContent: "center", ...shadow.sm }}>
                  <Ionicons name="heart" size={15} color="#fff" />
                </View>
              ) : null}
              {cd ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: cd.urgent ? "rgba(225,29,46,0.95)" : "rgba(2,6,23,0.55)" }}>
                  <Ionicons name={cd.urgent ? "flame" : "time-outline"} size={12} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 11.5, fontWeight: "800" }}>{cd.label}</Text>
                </View>
              ) : null}
            </View>

            {/* Title + place, overlaid on the scrim */}
            <View style={{ position: "absolute", left: 14, right: 14, bottom: 12, flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 19, letterSpacing: -0.3, textShadowColor: "rgba(0,0,0,0.35)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } }} numberOfLines={2}>
                  {r.title}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                  <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.9)" />
                  <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 12.5, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                    {d.weekday} · {r.location ?? r.city}
                  </Text>
                </View>
              </View>
              {openDetails && (
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="open-outline" size={15} color="#fff" />
                </View>
              )}
            </View>
          </View>
        ) : null}

        <View style={{ padding: 14, gap: 11 }}>
          {/* No banner → classic date block keeps the layout scannable */}
          {!r.image_url && (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 56, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", paddingVertical: 10, alignSelf: "flex-start" }}>
                <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "900", letterSpacing: -0.5 }}>{d.day}</Text>
                <Text style={{ color: colors.primary, fontSize: 10.5, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
              </View>
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {saved ? <Ionicons name="heart" size={17} color={colors.primary} /> : null}
                {mine && (
                  <Pressable onPress={onDelete} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.subtle} />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* Organizer credit for banner cards (place already rides the photo) */}
          {r.image_url && r.organizer ? (
            <Text style={{ color: colors.subtle, fontSize: 11.5, marginTop: -2 }} numberOfLines={1}>
              by {r.organizer}
            </Text>
          ) : null}

          {/* Distance chips — what can I run here? Banner cards already show the
              countdown on the photo; classic cards fold it in here. */}
          {(distances.length > 0 || (!r.image_url && cd)) && (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {!r.image_url && cd ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: cd.urgent ? colors.primary : colors.bgSecondary, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Ionicons name={cd.urgent ? "flame" : "time-outline"} size={11} color={cd.urgent ? "#fff" : colors.muted} />
                  <Text style={{ color: cd.urgent ? "#fff" : colors.muted, fontSize: 11.5, fontWeight: "800" }}>{cd.label}</Text>
                </View>
              ) : null}
              {distances.map((t) => (
                <View key={t} style={{ backgroundColor: colors.primarySoft, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primary, fontSize: 11.5, fontWeight: "800" }}>{shortDist(t)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions — glossy gradient CTA + the outline calendar button */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, borderRadius: 999, ...glow(r.going ? colors.success : colors.primary, 0.35) }}>
              <Tap onPress={onGoing} disabled={busy} scaleTo={0.95} style={{ borderRadius: 999, overflow: "hidden", opacity: busy ? 0.6 : 1 }}>
                <LinearGradient
                  colors={r.going ? SUCCESS_GRAD : gradients.red}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 11 }}
                >
                  {/* Top gloss highlight — the lit, 3D button look */}
                  <LinearGradient
                    colors={gradients.gloss}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60%" }}
                    pointerEvents="none"
                  />
                  <Ionicons name={r.going ? "checkmark-circle" : "walk"} size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{r.going ? "You're going" : "I'm going"}</Text>
                </LinearGradient>
              </Tap>
            </View>
            <Tap
              onPress={onCalendar}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
            >
              <Ionicons name="calendar" size={15} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>Calendar</Text>
            </Tap>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
