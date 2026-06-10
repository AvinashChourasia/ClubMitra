// Explore — discovery for everyone. Guests land here from Welcome and browse
// clubs (filtered by their city) and public challenges (search + type filter)
// without an account; the auth gate fires only when they try to JOIN, and the
// pending intent is resumed right after signup/login. Logged-in members reach
// this same screen from the Clubs tab to find new clubs.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../lib/auth";
import {
  publicClubs,
  publicChallenges,
  joinOpenClub,
  getGuestCity,
  setGuestCity,
  setPendingIntent,
  type DiscoverClub,
  type PublicChallenge,
} from "../lib/discover";
import { joinChallenge } from "../lib/challenges";
import { Avatar } from "../components/Avatar";
import { Tap } from "../components/Tap";
import { colors, styles, useThemeMode } from "../lib/theme";

type Segment = "clubs" | "challenges";
type TypeFilter = "" | "distance" | "days" | "streak";

const TYPE_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "distance", label: "Distance" },
  { key: "days", label: "Days" },
  { key: "streak", label: "Streak" },
];

export default function Explore() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [segment, setSegment] = useState<Segment>("clubs");
  const [city, setCity] = useState("");
  const [editingCity, setEditingCity] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [clubs, setClubs] = useState<DiscoverClub[] | null>(null);
  const [challenges, setChallenges] = useState<PublicChallenge[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null); // id being joined
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // City: the guest's chosen city, or the member's profile city.
  useEffect(() => {
    if (user?.city) setCity(user.city);
    else getGuestCity().then((c) => c && setCity(c));
  }, [user?.city]);

  const load = useCallback(async (cty: string, q: string, type: TypeFilter) => {
    const [cl, ch] = await Promise.all([
      publicClubs(cty, q).catch(() => []),
      publicChallenges(cty, q, type).catch(() => []),
    ]);
    setClubs(cl);
    setChallenges(ch);
  }, []);

  // Debounced reload whenever city/search/type change.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(city.trim(), search.trim(), typeFilter), 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [city, search, typeFilter, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load(city.trim(), search.trim(), typeFilter);
    setRefreshing(false);
  }

  // The auth gate: members act directly; guests get their intent stashed and go
  // to signup (which resumes the join after).
  async function joinClub(club: DiscoverClub) {
    if (!user) {
      await setPendingIntent({ type: "join_club", id: club.id, name: club.name });
      router.push("/register");
      return;
    }
    setJoining(club.id);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await joinOpenClub(token, club.id);
      Alert.alert(
        res.status === "active" ? "Welcome to the club! 🎉" : "Request sent",
        res.status === "active"
          ? `You're now a member of ${club.name}.`
          : res.status === "pending_payment"
            ? `${club.name} has a membership fee — open the club to pay and activate.`
            : `${club.name} reviews join requests — you'll be in once an admin approves.`,
        [{ text: "Open club", onPress: () => router.push(`/club/${club.id}`) }, { text: "OK" }]
      );
    } catch (e) {
      Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
    } finally {
      setJoining(null);
    }
  }

  async function joinPublicChallenge(ch: PublicChallenge) {
    if (!user) {
      await setPendingIntent({ type: "join_challenge", id: ch.id, name: ch.title });
      router.push("/register");
      return;
    }
    setJoining(ch.id);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await joinChallenge(token, ch.id);
      Alert.alert("You're in! 🏁", `${ch.title} — go log those runs.`, [
        { text: "Open challenge", onPress: () => router.push(`/challenge/${ch.id}`) },
        { text: "OK" },
      ]);
    } catch (e) {
      Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
    } finally {
      setJoining(null);
    }
  }

  const list = segment === "clubs" ? clubs : challenges;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header: title + city chip + login/back */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {user && (
            <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} hitSlop={12} haptic={false} style={{ marginLeft: -8, padding: 6 }}>
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </Tap>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Explore</Text>
            <Tap haptic={false} onPress={() => setEditingCity((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
              <Ionicons name="location" size={13} color={colors.primary} />
              <Text style={{ color: colors.muted, fontSize: 13 }}>{city.trim() || "All cities"}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.muted} />
            </Tap>
          </View>
          {!user && (
            <Tap onPress={() => router.push("/login")} haptic={false} style={{ backgroundColor: colors.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>Log in</Text>
            </Tap>
          )}
        </View>

        {/* City editor (toggled from the chip) */}
        {editingCity && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                placeholder="City (blank = all cities)"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                value={city}
                onChangeText={setCity}
                onSubmitEditing={() => {
                  setEditingCity(false);
                  if (!user) void setGuestCity(city);
                }}
                returnKeyType="done"
                autoFocus
              />
            </View>
            <Tap
              haptic={false}
              onPress={() => {
                setEditingCity(false);
                if (!user) void setGuestCity(city);
              }}
              style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="checkmark" size={22} color="#fff" />
            </Tap>
          </View>
        )}

        {/* Search */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg, borderRadius: 12, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 15 }}
            placeholder={segment === "clubs" ? "Search clubs" : "Search challenges"}
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search !== "" && (
            <Tap haptic={false} onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Tap>
          )}
        </View>

        {/* Segments */}
        <View style={{ flexDirection: "row", backgroundColor: colors.bg, borderRadius: 12, padding: 4, gap: 4 }}>
          {(["clubs", "challenges"] as Segment[]).map((s) => (
            <Tap
              key={s}
              haptic={false}
              onPress={() => setSegment(s)}
              style={{ flex: 1, paddingVertical: 9, borderRadius: 9, backgroundColor: segment === s ? colors.primary : "transparent", alignItems: "center" }}
            >
              <Text style={{ color: segment === s ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13, textTransform: "capitalize" }}>{s}</Text>
            </Tap>
          ))}
        </View>

        {/* Challenge type chips */}
        {segment === "challenges" && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {TYPE_CHIPS.map((t) => (
              <Tap
                key={t.key}
                haptic={false}
                onPress={() => setTypeFilter(t.key)}
                style={{ backgroundColor: typeFilter === t.key ? colors.primary : colors.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
              >
                <Text style={{ color: typeFilter === t.key ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{t.label}</Text>
              </Tap>
            ))}
          </View>
        )}

        {/* Results */}
        {list === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : segment === "clubs" ? (
          clubs!.length === 0 ? (
            <EmptyState
              icon="people"
              title={city.trim() ? `No clubs in ${city.trim()} yet` : "No clubs found"}
              body={city.trim() ? "Be the first — start your city's running club." : "Try a different search or city."}
            />
          ) : (
            clubs!.map((c) => (
              <View key={c.id} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
                <Avatar name={c.name} uri={c.logo} size={48} bg={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{c.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {c.city} · {c.member_count} {c.member_count === 1 ? "member" : "members"}
                  </Text>
                </View>
                {c.join_policy === "open" ? (
                  <Tap
                    onPress={() => joinClub(c)}
                    disabled={joining === c.id}
                    style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, opacity: joining === c.id ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{joining === c.id ? "Joining…" : "Join"}</Text>
                  </Tap>
                ) : (
                  <View style={{ backgroundColor: colors.bgSecondary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Invite only</Text>
                  </View>
                )}
              </View>
            ))
          )
        ) : challenges!.length === 0 ? (
          <EmptyState icon="flag" title="No challenges found" body="Try a different search, type, or city." />
        ) : (
          challenges!.map((ch) => (
            <View key={ch.id} style={[styles.card, { gap: 8 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={ch.type === "distance" ? "speedometer" : ch.type === "streak" ? "flame" : "calendar"} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{ch.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {challengeGoal(ch)} · ends {endDate(ch.end_date)} · {ch.participant_count} joined
                  </Text>
                </View>
                <Tap
                  onPress={() => joinPublicChallenge(ch)}
                  disabled={joining === ch.id}
                  style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, opacity: joining === ch.id ? 0.6 : 1 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{joining === ch.id ? "Joining…" : "Join"}</Text>
                </Tap>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function challengeGoal(ch: PublicChallenge): string {
  if (ch.type === "distance" && ch.target_km) return `${ch.target_km} km`;
  if (ch.target_days) return `${ch.target_days} days`;
  return ch.type;
}

function endDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>{title}</Text>
      <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>{body}</Text>
    </View>
  );
}
