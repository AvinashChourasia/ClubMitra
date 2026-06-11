// Profile — the athlete card. Answers three things at a glance: who you are as
// a runner (identity hero), whether you're consistent (this week, all-time,
// 12-week volume bars), and where you belong (city rank, your clubs). Personal
// details (phone, age, t-shirt) live behind Edit — they're admin, not identity.

import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myChapters, isChapterAdmin, type MyChapter } from "../../lib/clubs";
import {
  listActivities,
  getStats,
  getRoute,
  geoJSONToLatLng,
  offsetsToTimes,
  cityLeaderboard,
  type Activity,
  type Stats,
  type LatLng,
} from "../../lib/activities";
import { getGamification, tierColor, type GamificationProfile, type BadgeStatus } from "../../lib/gamification";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { runningLevelLabel } from "../../lib/profile";
import { formatDistance, formatDuration, formatPace } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { BadgeMedal } from "../../components/BadgeMedal";
import { GradientCard } from "../../components/GradientCard";
import { RouteTrace } from "../../components/RouteTrace";
import { Tap } from "../../components/Tap";
import { GuestProfile } from "../../components/GuestScreens";

// medalStrip: the profile teaser — latest pride (6 newest medals) plus the
// 3 nearest unlocks. A glance, not the whole wall; "See all" carries the rest.
function medalStrip(gam: GamificationProfile): BadgeStatus[] {
  const earned = gam.badges
    .filter((b) => b.earned)
    .sort((a, b) => (b.earned_at ?? "").localeCompare(a.earned_at ?? ""))
    .slice(0, 6);
  const next = gam.badges
    .filter((b) => !b.earned && b.target > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target)
    .slice(0, 3);
  return [...earned, ...next];
}

function Pill({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
      <Ionicons name={icon} size={13} color="#fff" />
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// startOfWeek: Monday 00:00 local for the week containing d.
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

// WeeklyBars: the consistency strip — distance per week for the last 12 weeks,
// current week highlighted. Pure Views, no chart lib.
function WeeklyBars({ activities }: { activities: Activity[] }) {
  const weeks = useMemo(() => {
    const thisWeek = startOfWeek(new Date());
    const buckets = new Array(12).fill(0) as number[];
    for (const a of activities) {
      const t = new Date(a.started_at);
      if (isNaN(t.getTime())) continue;
      const diff = Math.floor((thisWeek.getTime() - startOfWeek(t).getTime()) / (7 * 86400000));
      if (diff >= 0 && diff < 12) buckets[11 - diff] += a.distance_m;
    }
    return buckets;
  }, [activities]);

  const max = Math.max(...weeks, 1);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 56 }}>
        {weeks.map((m, i) => {
          const frac = m / max;
          const current = i === weeks.length - 1;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <View
                style={{
                  width: "100%",
                  height: m > 0 ? Math.max(6, frac * 56) : 3,
                  borderRadius: 4,
                  backgroundColor: current ? colors.primary : m > 0 ? colors.primarySoft : colors.bgSecondary,
                }}
              />
            </View>
          );
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600" }}>Last 12 weeks · km per week</Text>
    </View>
  );
}

export default function Profile() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe so a theme toggle re-themes this screen instantly
  const [clubs, setClubs] = useState<MyChapter[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [lastRoute, setLastRoute] = useState<LatLng[]>([]);
  const [lastTimes, setLastTimes] = useState<number[] | undefined>(undefined);
  const [cityRank, setCityRank] = useState<number | null>(null);
  const [gam, setGam] = useState<GamificationProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const [c, s, acts] = await Promise.all([
        myChapters(token).catch(() => [] as MyChapter[]),
        getStats(token).catch(() => null),
        listActivities(token, 100).catch(() => [] as Activity[]),
      ]);
      setClubs(c);
      setStats(s);
      setActivities(acts);
      getGamification(token).then(setGam).catch(() => {});

      // Last run's route thumbnail + this week's city rank — both best-effort.
      const latest = acts[0];
      if (latest) {
        getRoute(token, latest.id)
          .then((r) => {
            setLastRoute(geoJSONToLatLng(r.geometry));
            setLastTimes(offsetsToTimes(r.offsets_s));
          })
          .catch(() => setLastRoute([]));
      } else {
        setLastRoute([]);
      }
      cityLeaderboard(token, "week")
        .then((b) => {
          const me = b.entries.find((e) => e.user_id === user?.id);
          setCityRank(me?.rank ?? null);
        })
        .catch(() => setCityRank(null));
    } catch {
      setClubs([]);
    }
  }, [getAccessToken, user?.id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (active) await load();
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // This week's volume from the fetched runs (Mon-start, local).
  const week = useMemo(() => {
    const from = startOfWeek(new Date()).getTime();
    let distanceM = 0;
    let durationS = 0;
    let runs = 0;
    for (const a of activities) {
      const t = new Date(a.started_at).getTime();
      if (!isNaN(t) && t >= from) {
        distanceM += a.distance_m;
        durationS += a.duration_s;
        runs++;
      }
    }
    return { distanceM, durationS, runs };
  }, [activities]);

  if (!user) return <GuestProfile />;

  const lastRun = activities[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Hero — identity */}
        <GradientCard colors={gradients.red} glowColor={colors.primary} style={{ padding: 24, alignItems: "center", gap: 10 }}>
          <View style={{ position: "absolute", top: 16, right: 16, flexDirection: "row", gap: 16, zIndex: 1 }}>
            <Pressable onPress={() => router.push("/profile/edit")} hitSlop={10}>
              <Ionicons name="create-outline" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={() => router.push("/settings")} hitSlop={10}>
              <Ionicons name="settings-outline" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={{ borderWidth: 3, borderColor: "rgba(255,255,255,0.55)", borderRadius: 50 }}>
            <Avatar name={user.name} uri={user.profile_photo} size={88} bg="rgba(255,255,255,0.18)" />
          </View>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.3 }}>{user.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2, flexWrap: "wrap", justifyContent: "center" }}>
            {gam && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(250,204,21,0.22)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
                <Text style={{ fontSize: 11 }}>⚡</Text>
                <Text style={{ color: "#FDE68A", fontSize: 12, fontWeight: "800" }}>{gam.level.title}</Text>
              </View>
            )}
            <Pill icon="flash" text={runningLevelLabel(user.running_level)} />
            {user.city ? <Pill icon="location" text={user.city} /> : null}
            {user.age ? <Pill icon="hourglass" text={`${user.age} yrs`} /> : null}
          </View>
        </GradientCard>

        {/* Achievements — level runway + the medal strip */}
        {gam && (
          <Tap onPress={() => router.push("/achievements" as Href)} style={[styles.card, { gap: 10 }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>ACHIEVEMENTS</Text>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>See all ›</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
                ⚡ {gam.xp.toLocaleString()} XP
              </Text>
              <View style={{ flex: 1, height: 7, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(Math.min(1, Math.max(0, gam.level.progress)) * 100)}%`, height: "100%", backgroundColor: "#FACC15", borderRadius: 4 }} />
              </View>
              {gam.level.next_title ? (
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>{gam.level.next_title}</Text>
              ) : (
                <Text style={{ fontSize: 13 }}>🏆</Text>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
              {medalStrip(gam).map((b) => (
                <View key={b.id} style={{ alignItems: "center", width: 72 }}>
                  <BadgeMedal emoji={b.emoji} color={tierColor(b.tier)} size={58} locked={!b.earned} />
                  <Text numberOfLines={1} style={{ color: b.earned ? colors.text : colors.muted, fontSize: 10, fontWeight: "700" }}>
                    {b.name}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Tap>
        )}

        {/* This week */}
        <View style={[styles.card, { gap: 12 }]}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>THIS WEEK</Text>
          <View style={{ flexDirection: "row" }}>
            <StatCell value={formatDistance(week.distanceM)} label="Distance" />
            <StatCell value={String(week.runs)} label="Runs" />
            <StatCell value={formatDuration(week.durationS)} label="Time" />
          </View>
        </View>

        {/* All time + consistency */}
        <View style={[styles.card, { gap: 14 }]}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>ALL TIME</Text>
          <View style={{ flexDirection: "row" }}>
            <StatCell value={stats ? formatDistance(stats.total_distance_m) : "—"} label="Distance" />
            <StatCell value={stats ? String(stats.total_runs) : "—"} label="Runs" />
            <StatCell value={stats ? `${stats.current_streak_days}d` : "—"} label="Streak" />
            <StatCell value={stats?.best_pace_s_per_km ? formatPace(stats.best_pace_s_per_km) : "—"} label="Best pace" />
          </View>
          <WeeklyBars activities={activities} />
          {stats && (
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600" }}>
              ❄️ {stats.streak_freezes_left} streak freeze{stats.streak_freezes_left === 1 ? "" : "s"} left this month — a
              rest day won't break your streak.
            </Text>
          )}
        </View>

        {/* Last run — the route shape is the athlete card's "photo" */}
        {lastRun && lastRoute.length >= 2 && (
          <Tap onPress={() => router.push(`/activity/${lastRun.id}`)} style={[styles.card, { gap: 10 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.sectionTitle}>Last run</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {formatDistance(lastRun.distance_m)} · {formatPace(lastRun.avg_pace_s_per_km)}
              </Text>
            </View>
            <RouteTrace coords={lastRoute} times={lastTimes} height={120} />
          </Tap>
        )}

        {/* Your runs + city rank */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Tap onPress={() => router.push("/activity")} style={[styles.card, { flex: 1, alignItems: "center", gap: 8, paddingVertical: 16 }]}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="map" size={20} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 13 }}>Your runs</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{stats?.total_runs ?? 0} recorded</Text>
          </Tap>
          <Tap onPress={() => router.push("/leaderboard/city")} style={[styles.card, { flex: 1, alignItems: "center", gap: 8, paddingVertical: 16 }]}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="trophy" size={20} color="#F59E0B" />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 13 }}>City rank</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {cityRank ? `#${cityRank} this week` : "Unranked — go run"}
            </Text>
          </Tap>
        </View>

        {/* Clubs — belonging */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={styles.sectionTitle}>Your clubs</Text>
            <Pressable onPress={() => router.push("/clubs")} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>All</Text>
            </Pressable>
          </View>
          {clubs === null ? null : clubs.length === 0 ? (
            <Text style={{ color: colors.muted }}>You haven&apos;t joined a club yet.</Text>
          ) : (
            <View style={{ gap: 4 }}>
              {clubs.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/club/${c.id}`)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    borderBottomWidth: i === clubs.length - 1 ? 0 : 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Avatar name={c.name} uri={c.logo} size={40} bg={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{c.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{c.city}</Text>
                  </View>
                  <Text
                    style={{
                      color: isChapterAdmin(c.role) ? colors.primary : colors.muted,
                      fontSize: 12,
                      fontWeight: "700",
                      textTransform: "capitalize",
                    }}
                  >
                    {isChapterAdmin(c.role) ? (c.role ?? "").replace("_", " ") : c.status ?? "member"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
