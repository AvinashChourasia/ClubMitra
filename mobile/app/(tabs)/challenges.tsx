// Challenges tab — the competition hub. A hero card tracks your most urgent
// live challenge with an animated progress ring; below it, everything visible
// to you grouped by where it is in its life (Live / Starting soon / Ended).
// Progress is GPS-native: recorded runs count automatically, no proof uploads.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { Tap } from "../../components/Tap";

import { useAuth } from "../../lib/auth";
import {
  listChallenges,
  challengeUnit,
  challengeTarget,
  challengeProgress,
  challengeFraction,
  challengePhase,
  daysUntil,
  windowElapsedFraction,
  type Challenge,
} from "../../lib/challenges";
import { ProgressRing } from "../../components/ProgressRing";
import { GradientCard } from "../../components/GradientCard";
import { TYPE_THEME, LiveDot } from "../../components/ChallengeBits";
import { SearchBar } from "../../components/discovery";
import { colors, styles, useThemeMode } from "../../lib/theme";
import { GuestChallenges } from "../../components/GuestScreens";

export default function Challenges() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Spinner only while we have NOTHING; revisits show last data instantly and
  // refresh silently in the background (stale-while-revalidate).
  const loading = challenges === null;

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) setChallenges(await listChallenges(token, joinedOnly));
    } catch {
      // Keep the last-good list; only land on "empty" if we never had data.
      setChallenges((prev) => prev ?? []);
    }
  }, [getAccessToken, joinedOnly]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!user) return <GuestChallenges />;

  const q = search.trim().toLowerCase();
  const visible = (challenges ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));

  // Group by phase: what's on now, what's coming, what's done.
  const live = visible.filter((c) => challengePhase(c) === "live").sort(byEndAsc);
  const upcoming = visible.filter((c) => challengePhase(c) === "upcoming").sort(byStartAsc);
  const ended = visible.filter((c) => challengePhase(c) === "ended").sort(byEndDesc);

  // Hero: your most urgent live challenge (soonest deadline first).
  const hero = live.find((c) => c.joined);
  const empty = live.length + upcoming.length + ended.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Challenges</Text>
          <Tap
            onPress={() => router.push("/challenge/new")}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>New</Text>
          </Tap>
        </View>

        {hero && !q && <HeroCard item={hero} onPress={() => router.push(`/challenge/${hero.id}`)} />}

        <SearchBar value={search} onChange={setSearch} placeholder="Search challenges" />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <FilterChip label="All" active={!joinedOnly} onPress={() => setJoinedOnly(false)} />
          <FilterChip label="Joined" active={joinedOnly} onPress={() => setJoinedOnly(true)} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : empty ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32, marginTop: 8 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="trophy" size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>
              {q ? "No matches" : joinedOnly ? "No joined challenges" : "No challenges yet"}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              {q ? "Try a different search." : joinedOnly ? "Join one from the All tab." : "Create one with New."}
            </Text>
          </View>
        ) : (
          <>
            <Section title="Live" count={live.length} live>
              {live.map((c) => (
                <ChallengeCard key={c.id} item={c} onPress={() => router.push(`/challenge/${c.id}`)} />
              ))}
            </Section>
            <Section title="Starting soon" count={upcoming.length}>
              {upcoming.map((c) => (
                <ChallengeCard key={c.id} item={c} onPress={() => router.push(`/challenge/${c.id}`)} />
              ))}
            </Section>
            <Section title="Ended" count={ended.length}>
              {ended.slice(0, 5).map((c) => (
                <ChallengeCard key={c.id} item={c} onPress={() => router.push(`/challenge/${c.id}`)} />
              ))}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const byEndAsc = (a: Challenge, b: Challenge) => +new Date(a.end_date) - +new Date(b.end_date);
const byStartAsc = (a: Challenge, b: Challenge) => +new Date(a.start_date) - +new Date(b.start_date);
const byEndDesc = (a: Challenge, b: Challenge) => +new Date(b.end_date) - +new Date(a.end_date);

function Section({ title, count, live, children }: { title: string; count: number; live?: boolean; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4 }}>
        {live && <LiveDot color={colors.primary} />}
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 }}>
          {title} · {count}
        </Text>
      </View>
      {children}
    </View>
  );
}

// HeroCard: your most urgent live challenge, front and center — animated ring,
// what's left, and the deadline. One glance, then go run.
function HeroCard({ item, onPress }: { item: Challenge; onPress: () => void }) {
  const t = TYPE_THEME[item.type];
  const unit = challengeUnit(item);
  const target = challengeTarget(item);
  const progress = challengeProgress(item);
  const frac = challengeFraction(item);
  const left = Math.max(0, target - progress);
  const dleft = daysUntil(item.end_date);
  const done = frac >= 1;
  const remainText = done
    ? "Goal completed — legend! 🎉"
    : item.type === "distance"
      ? `${left.toFixed(1)} km to go`
      : `${Math.ceil(left)} ${item.type === "streak" ? "streak days" : "run days"} to go`;

  return (
    <Tap onPress={onPress}>
      <GradientCard colors={t.hero} glowColor={t.hero[1]} radius={22} style={{ padding: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <ProgressRing size={92} stroke={9} fraction={frac} colors={["#FFFFFF", "rgba(255,255,255,0.85)"]} track="rgba(255,255,255,0.25)">
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, letterSpacing: -0.5 }}>{Math.round(frac * 100)}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 10, marginTop: -3 }}>%</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <LiveDot />
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontWeight: "800", letterSpacing: 1 }}>YOUR ACTIVE CHALLENGE</Text>
            </View>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.3 }} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "700" }}>
              {remainText}
              {!done && ` · ${dleft}d left`}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
              {progress.toFixed(item.type === "distance" ? 1 : 0)} / {target} {unit}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
        </View>
      </GradientCard>
    </Tap>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Tap
      onPress={onPress}
      haptic={false}
      style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? colors.primary : colors.bg, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
    >
      <Text style={{ color: active ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Tap>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Stat({ icon, text, tint }: { icon: keyof typeof Ionicons.glyphMap; text: string; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ionicons name={icon} size={13} color={tint ?? colors.muted} />
      <Text style={{ color: tint ?? colors.muted, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

// StatusPill: where the challenge is in its life, at a glance.
function StatusPill({ item }: { item: Challenge }) {
  const phase = challengePhase(item);
  if (phase === "live") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(225,29,46,0.1)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 }}>
        <LiveDot color={colors.primary} size={6} />
        <Text style={{ color: colors.primary, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 }}>LIVE</Text>
      </View>
    );
  }
  if (phase === "upcoming") {
    const d = daysUntil(item.start_date);
    return (
      <View style={{ backgroundColor: colors.bgSecondary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 }}>
        <Text style={{ color: colors.accent, fontSize: 10.5, fontWeight: "800" }}>{d === 0 ? "TODAY" : `IN ${d}D`}</Text>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: colors.bgSecondary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 }}>
      <Text style={{ color: colors.subtle, fontSize: 10.5, fontWeight: "800" }}>ENDED</Text>
    </View>
  );
}

function ChallengeCard({ item, onPress }: { item: Challenge; onPress: () => void }) {
  const t = TYPE_THEME[item.type];
  const unit = challengeUnit(item);
  const target = challengeTarget(item);
  const frac = challengeFraction(item);
  const phase = challengePhase(item);
  const timeText =
    phase === "live" ? `${daysUntil(item.end_date)}d left` : phase === "upcoming" ? `starts ${fmtDate(item.start_date)}` : `ended ${fmtDate(item.end_date)}`;

  return (
    <Tap onPress={onPress} style={[styles.card, { gap: 10, padding: 16, opacity: phase === "ended" ? 0.72 : 1 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: `${t.tint}1C`, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={t.icon} size={22} color={t.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {t.label} · {item.visibility === "city" && item.city ? item.city : item.visibility}
            {item.description ? ` · ${item.description}` : ""}
          </Text>
        </View>
        <StatusPill item={item} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
          <Stat icon="flag" text={`${target} ${unit}`} />
          <Stat icon="people" text={`${item.participant_count}`} />
          <Stat icon="time" text={timeText} />
          {item.joined && phase !== "ended" && <Stat icon="checkmark-circle" text="In" tint={colors.success} />}
        </View>
        {item.joined && (
          <ProgressRing size={46} stroke={5} fraction={frac} colors={t.ring}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 11 }}>{Math.round(frac * 100)}</Text>
          </ProgressRing>
        )}
      </View>

      {/* Live + not joined: how far through its window it is. */}
      {phase === "live" && !item.joined && (
        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
          <View style={{ width: `${windowElapsedFraction(item) * 100}%`, height: "100%", backgroundColor: t.tint, borderRadius: 2 }} />
        </View>
      )}
    </Tap>
  );
}
