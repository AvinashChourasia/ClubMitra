// Guest variants of the five tabs. The Swiggy/Strava pattern: a guest sees the
// REAL app shell filled with public content — their city's clubs, live
// challenges, what tracking and chat look like — and hits the auth gate only
// when they act. Every CTA funnels to /register (intent-stashed where it makes
// sense), so signup always happens with a reason attached.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { publicClubs, publicChallenges, type DiscoverClub, type PublicChallenge } from "../lib/discover";
import {
  useGuestCity,
  useJoinGate,
  ClubCarousel,
  DiscoverClubCard,
  PublicChallengeCard,
  EmptyState,
  SearchBar,
  TrackRunCard,
} from "./discovery";
import { CityAutocomplete } from "./CityAutocomplete";
import { Avatar } from "./Avatar";
import { Tap } from "./Tap";
import { Button } from "./Button";
import { GradientCard } from "./GradientCard";
import { colors, styles, gradients, useThemeMode } from "../lib/theme";

// --- shared scaffolding ---

// GuestHeader: brand/title row with the city chip (tap to edit, with type-ahead)
// and a Log in pill. The one consistent thing across guest tabs.
function GuestHeader({
  title,
  city,
  onCity,
  showCity = true,
}: {
  title: string;
  city?: string;
  onCity?: (c: string) => void;
  showCity?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(city ?? "");

  useEffect(() => setDraft(city ?? ""), [city]);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{title}</Text>
          {showCity && (
            <Tap haptic={false} onPress={() => setEditing((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
              <Ionicons name="location" size={13} color={colors.primary} />
              <Text style={{ color: colors.muted, fontSize: 13 }}>{city?.trim() || "All cities"}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.muted} />
            </Tap>
          )}
        </View>
        <Tap onPress={() => router.push("/login")} haptic={false} style={{ backgroundColor: colors.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>Log in</Text>
        </Tap>
      </View>
      {editing && onCity && (
        <CityAutocomplete
          value={draft}
          onChange={setDraft}
          onPick={(c) => {
            onCity(c);
            setEditing(false);
          }}
          autoFocus
        />
      )}
    </View>
  );
}

// useGuestData: shared loader for the guest surfaces (clubs + challenges for a
// city, optional search/type), with pull-to-refresh support.
function useGuestData(city: string, search = "", type = "") {
  const [clubs, setClubs] = useState<DiscoverClub[] | null>(null);
  const [challenges, setChallenges] = useState<PublicChallenge[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [cl, ch] = await Promise.all([
      publicClubs(city.trim(), search.trim()).catch(() => []),
      publicChallenges(city.trim(), search.trim(), type).catch(() => []),
    ]);
    setClubs(cl);
    setChallenges(ch);
  }, [city, search, type]);

  // Debounce: search retypes shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { clubs, challenges, refreshing, refresh };
}

// --- Home ---

export function GuestHome() {
  useThemeMode();
  const router = useRouter();
  const [city, setCity] = useGuestCity();
  const { clubs, challenges, refreshing, refresh } = useGuestData(city);
  const { joinClub, joinPublicChallenge, joiningId } = useJoinGate();

  const runners = useMemo(() => (clubs ?? []).reduce((s, c) => s + c.member_count, 0), [clubs]);
  const cityLabel = city.trim() || "Your city";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <GuestHeader title="ClubMitra" city={city} onCity={setCity} />

        {/* Hero: the city's pulse */}
        <GradientCard colors={gradients.red} glowColor={colors.primary} style={{ padding: 22, gap: 14 }}>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: -0.4 }}>
            {cityLabel} runs together
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>
            Find your crew, race your challenges, climb your city's leaderboard.
          </Text>
          <View style={{ flexDirection: "row", gap: 24 }}>
            <HeroStat value={clubs?.length ?? 0} label={(clubs?.length ?? 0) === 1 ? "club" : "clubs"} />
            <HeroStat value={challenges?.length ?? 0} label="live challenges" />
            <HeroStat value={runners} label="runners" />
          </View>
        </GradientCard>

        {/* GPS tracking teaser — show the actual product, not a screenshot */}
        <TrackRunCard onPress={() => router.push("/register")} />

        {/* Popular clubs (horizontal) */}
        {clubs === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : clubs.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Popular clubs in {cityLabel}</Text>
            <ClubCarousel clubs={clubs.slice(0, 8)} joiningId={joiningId} onJoin={joinClub} />
          </View>
        ) : (
          <EmptyState icon="people" title={`No clubs in ${cityLabel} yet`} body="Be the first — create your city's running club." />
        )}

        {/* Live challenges */}
        {challenges !== null && challenges.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Live challenges</Text>
            {challenges.slice(0, 3).map((ch) => (
              <PublicChallengeCard key={ch.id} challenge={ch} joiningId={joiningId} onJoin={joinPublicChallenge} />
            ))}
          </View>
        )}

        {/* What you get */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <FeatureTile icon="podium" label="City leaderboards" />
          <FeatureTile icon="chatbubbles" label="Club chat" />
          <FeatureTile icon="flame" label="Streaks" />
        </View>

        {/* Bottom CTA */}
        <View style={{ gap: 4 }}>
          <Button label="Create your free profile" icon="person-add" onPress={() => router.push("/register")} />
          <Tap onPress={() => router.push("/login")} haptic={false}>
            <Text style={styles.link}>Already a member? Log in</Text>
          </Tap>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <View>
      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function FeatureTile({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const router = useRouter();
  return (
    <Tap onPress={() => router.push("/register")} style={[styles.card, { flex: 1, alignItems: "center", gap: 8, paddingVertical: 16 }]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 12, textAlign: "center" }}>{label}</Text>
    </Tap>
  );
}

// --- Clubs ---

export function GuestClubs() {
  useThemeMode();
  const [city, setCity] = useGuestCity();
  const [search, setSearch] = useState("");
  const { clubs, refreshing, refresh } = useGuestData(city, search);
  const { joinClub, joiningId } = useJoinGate();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <GuestHeader title="Clubs" city={city} onCity={setCity} />
        <SearchBar value={search} onChange={setSearch} placeholder="Search clubs" />
        {clubs === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : clubs.length === 0 ? (
          <EmptyState
            icon="people"
            title={city.trim() ? `No clubs in ${city.trim()} yet` : "No clubs found"}
            body={city.trim() ? "Be the first — create your city's running club." : "Try a different search or city."}
          />
        ) : (
          clubs.map((c) => <DiscoverClubCard key={c.id} club={c} joiningId={joiningId} onJoin={joinClub} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Challenges ---

const TYPE_CHIPS = [
  { key: "", label: "All" },
  { key: "distance", label: "Distance" },
  { key: "days", label: "Days" },
  { key: "streak", label: "Streak" },
] as const;

export function GuestChallenges() {
  useThemeMode();
  const [city, setCity] = useGuestCity();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("");
  const { challenges, refreshing, refresh } = useGuestData(city, search, type);
  const { joinPublicChallenge, joiningId } = useJoinGate();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <GuestHeader title="Challenges" city={city} onCity={setCity} />
        <SearchBar value={search} onChange={setSearch} placeholder="Search challenges" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TYPE_CHIPS.map((t) => (
            <Tap
              key={t.key}
              haptic={false}
              onPress={() => setType(t.key)}
              style={{ backgroundColor: type === t.key ? colors.primary : colors.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
            >
              <Text style={{ color: type === t.key ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{t.label}</Text>
            </Tap>
          ))}
        </View>
        {challenges === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : challenges.length === 0 ? (
          <EmptyState icon="flag" title="No challenges found" body="Try a different search, type, or city." />
        ) : (
          challenges.map((ch) => <PublicChallengeCard key={ch.id} challenge={ch} joiningId={joiningId} onJoin={joinPublicChallenge} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Chat (locked preview) ---

export function GuestChat() {
  useThemeMode();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <GuestHeader title="Chat" showCity={false} />

        {/* A taste of what club chat looks like */}
        <View style={[styles.card, { gap: 10, padding: 16 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name="Pune Pacers" size={36} bg={colors.accent} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Pune Pacers</Text>
            <View style={{ marginLeft: "auto", backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800" }}>club group</Text>
            </View>
          </View>
          <DemoBubble who="Asha" text="Sunday long run — 6 AM from the lake gate. Who's in? 🏃‍♀️" />
          <DemoBubble who="Rohit" text="In! Targeting 12k this week for the challenge." />
          <DemoBubble who="You" mine text="Count me in 🙌" />
        </View>

        <View style={[styles.card, { alignItems: "center", paddingVertical: 28, gap: 8 }]}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed" size={24} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Chat is for members</Text>
          <Text style={{ color: colors.muted, textAlign: "center" }}>
            Every club gets a group chat, plus 1:1 messages with any runner you meet.
          </Text>
          <Button label="Create your free profile" onPress={() => router.push("/register")} style={{ alignSelf: "stretch", marginTop: 6 }} />
          <Tap onPress={() => router.push("/login")} haptic={false}>
            <Text style={styles.link}>Already a member? Log in</Text>
          </Tap>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DemoBubble({ who, text, mine }: { who: string; text: string; mine?: boolean }) {
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}>
      {!mine && <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 2, marginLeft: 4 }}>{who}</Text>}
      <View
        style={{
          backgroundColor: mine ? colors.bubbleMine ?? colors.primary : colors.bgSecondary,
          borderRadius: 14,
          borderBottomRightRadius: mine ? 4 : 14,
          borderBottomLeftRadius: mine ? 14 : 4,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 14 }}>{text}</Text>
      </View>
    </View>
  );
}

// --- Profile (locked preview) ---

export function GuestProfile() {
  useThemeMode();
  const router = useRouter();

  const perks: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
    { icon: "navigate", title: "GPS run history", body: "Every run saved — route, pace, splits, elevation." },
    { icon: "podium", title: "City ranking", body: "See where you stand among your city's runners." },
    { icon: "shield-checkmark", title: "Trust score", body: "Show up, log runs, build a verified reputation." },
    { icon: "flame", title: "Streaks & stats", body: "Day streaks, personal records, all-time totals." },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <GuestHeader title="Profile" showCity={false} />

        <GradientCard colors={gradients.red} glowColor={colors.primary} style={{ padding: 22, alignItems: "center", gap: 10 }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.5)" }}>
            <Ionicons name="person" size={40} color="#fff" />
          </View>
          <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>Your runner profile</Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, textAlign: "center" }}>
            Free, takes a minute — and everything you do starts counting.
          </Text>
        </GradientCard>

        <View style={[styles.card, { gap: 4 }]}>
          {perks.map((p, i) => (
            <View key={p.title} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: i === perks.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={p.icon} size={19} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 14 }}>{p.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Button label="Create your free profile" icon="person-add" onPress={() => router.push("/register")} />
        <Tap onPress={() => router.push("/login")} haptic={false}>
          <Text style={styles.link}>Already a member? Log in</Text>
        </Tap>
      </ScrollView>
    </SafeAreaView>
  );
}
