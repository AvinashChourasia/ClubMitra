// Home: the daily front door. Leads with the run you can start right now (the
// GPS track card), then your personal slice — next run, challenges in flight,
// upcoming marathons to chase — and fresh clubs in your city to discover.

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myRuns, type MyRun } from "../../lib/attendance";
import { listChallenges, challengeFraction, challengeProgress, challengeTarget, challengeUnit, type Challenge } from "../../lib/challenges";
import { myChapters, type MyChapter } from "../../lib/clubs";
import { publicClubs, type DiscoverClub } from "../../lib/discover";
import { listActivities, getRoute, geoJSONToLatLng, offsetsToTimes, type Activity, type LatLng } from "../../lib/activities";
import { listRaces, cityMatch, type Race } from "../../lib/races";
import { useJoinGate, ClubCarousel, TrackRunCard } from "../../components/discovery";
import { RaceCarousel } from "../../components/RaceCarousel";
import { ProgressBar } from "../../components/ProgressBar";
import { RouteTrace } from "../../components/RouteTrace";
import { Tap } from "../../components/Tap";
import { GradientCard } from "../../components/GradientCard";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { formatDistance, formatDuration, formatPace, formatRunWhen, isPast } from "../../lib/format";
import { GuestHome } from "../../components/GuestScreens";

function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && (
        <Tap onPress={action.onPress} hitSlop={8} haptic={false}>
          <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>{action.label}</Text>
        </Tap>
      )}
    </View>
  );
}

export default function Home() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates
  const [runs, setRuns] = useState<MyRun[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [clubs, setClubs] = useState<MyChapter[]>([]);
  const [cityClubs, setCityClubs] = useState<DiscoverClub[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [lastRun, setLastRun] = useState<Activity | null>(null);
  const [lastRoute, setLastRoute] = useState<LatLng[]>([]);
  const [lastTimes, setLastTimes] = useState<number[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { joinClub, joiningId } = useJoinGate();

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        const [r, c, ch, pc, acts, rc] = await Promise.all([
          myRuns(token),
          listChallenges(token, true),
          myChapters(token),
          // Discovery strip: public clubs in the member's own city.
          user?.city ? publicClubs(user.city).catch(() => []) : Promise.resolve([]),
          listActivities(token).catch(() => [] as Activity[]),
          // Upcoming marathons teaser — fetch all, prioritise the member's city.
          listRaces(token).catch(() => [] as Race[]),
        ]);
        setRuns(r);
        setChallenges(c);
        setClubs(ch);
        setCityClubs(pc);
        setRaces(rc);
        // Latest GPS run + its route for the thumbnail (best-effort).
        const latest = acts[0] ?? null;
        setLastRun(latest);
        if (latest) {
          try {
            const route = await getRoute(token, latest.id);
            setLastRoute(geoJSONToLatLng(route.geometry));
            setLastTimes(offsetsToTimes(route.offsets_s));
          } catch {
            setLastRoute([]);
          }
        }
      }
    } catch {
      /* keep last good state */
    }
  }, [getAccessToken, user?.city]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await load();
        if (active) setLoading(false);
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

  // Clubs in the member's city they haven't joined yet — the discovery strip.
  // (Hook, so it must run before the guest early-return.)
  const discoverClubs = useMemo(() => {
    const mine = new Set(clubs.map((c) => c.id));
    return cityClubs.filter((c) => !mine.has(c.id)).slice(0, 8);
  }, [cityClubs, clubs]);

  // Upcoming marathons for the Home teaser: the member's own city first (most
  // relevant), then the rest of the soonest races to fill the strip. (Hook —
  // must run before the guest early-return.)
  const upcomingRaces = useMemo(() => {
    const city = user?.city;
    const mine = city ? races.filter((r) => cityMatch(r.city, city)) : [];
    const mineIds = new Set(mine.map((r) => r.id));
    const rest = races.filter((r) => !mineIds.has(r.id));
    return [...mine, ...rest].slice(0, 8);
  }, [races, user?.city]);

  if (!user) return <GuestHome />;

  const firstName = user.name.split(" ")[0];
  const nextRun = runs.filter((r) => !isPast(r.scheduled_at)).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0];
  const activeChallenges = challenges.slice(0, 3);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Greeting */}
        <GradientCard colors={gradients.red} glowColor={colors.primary} style={{ padding: 22, gap: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600" }}>Welcome back</Text>
              <Text style={{ color: "#fff", fontSize: 27, fontWeight: "800", letterSpacing: -0.4 }}>Hi, {firstName} 👋</Text>
            </View>
            <Ionicons name="walk" size={30} color="rgba(255,255,255,0.9)" />
          </View>
          <View style={{ flexDirection: "row", gap: 24 }}>
            <HeroStat value={clubs.length} label={clubs.length === 1 ? "club" : "clubs"} />
            <HeroStat value={challenges.length} label="challenges" />
            <HeroStat value={runs.filter((r) => !isPast(r.scheduled_at)).length} label="upcoming" />
          </View>
        </GradientCard>

        {/* Start a run — the GPS track card IS the record button. */}
        <TrackRunCard
          onPress={() => router.push("/activity/record")}
          title="Record your run"
          subtitle="GPS route, pace, splits — counts for your clubs & challenges."
        />

        {/* Your last run — real route thumbnail + the headline numbers. */}
        {lastRun && (
          <View style={{ gap: 10 }}>
            <SectionHeader title="Your last run" action={{ label: "All runs", onPress: () => router.push("/activity") }} />
            <Tap onPress={() => router.push(`/activity/${lastRun.id}`)} style={[styles.card, { gap: 12, padding: 16 }]}>
              {lastRoute.length >= 2 && <RouteTrace coords={lastRoute} times={lastTimes} height={130} />}
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20, letterSpacing: -0.3 }}>
                    {formatDistance(lastRun.distance_m)}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {new Date(lastRun.started_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 18 }}>
                  <MiniStat label="Time" value={formatDuration(lastRun.duration_s)} />
                  <MiniStat label="Pace" value={formatPace(lastRun.avg_pace_s_per_km)} />
                </View>
              </View>
            </Tap>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : (
          <>
            {/* Next run */}
            <View style={{ gap: 10 }}>
              <SectionHeader title="Next run" action={{ label: "Schedule", onPress: () => router.push("/clubs") }} />
              {nextRun ? (
                <Tap onPress={() => router.push(`/run/${nextRun.id}`)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="calendar" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{nextRun.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{nextRun.chapter_name} · {formatRunWhen(nextRun.scheduled_at, nextRun.has_time)}</Text>
                  </View>
                  {nextRun.checked_in && <Ionicons name="checkmark-circle" size={22} color={colors.success} />}
                </Tap>
              ) : (
                <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                  <Ionicons name="calendar-outline" size={28} color={colors.subtle} />
                  <Text style={{ color: colors.muted, marginTop: 8 }}>No upcoming runs.</Text>
                </View>
              )}
            </View>

            {/* Your challenges */}
            <View style={{ gap: 10 }}>
              <SectionHeader title="Your challenges" action={{ label: "All", onPress: () => router.push("/challenges") }} />
              {activeChallenges.length === 0 ? (
                <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                  <Ionicons name="trophy-outline" size={28} color={colors.subtle} />
                  <Text style={{ color: colors.muted, marginTop: 8 }}>You haven&apos;t joined a challenge yet.</Text>
                </View>
              ) : (
                activeChallenges.map((c) => (
                  <Tap key={c.id} onPress={() => router.push(`/challenge/${c.id}`)} style={[styles.card, { gap: 8 }]}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{c.title}</Text>
                    <ProgressBar fraction={challengeFraction(c)} />
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {challengeProgress(c)} / {challengeTarget(c)} {challengeUnit(c)} ({Math.round(challengeFraction(c) * 100)}%)
                    </Text>
                  </Tap>
                ))
              )}
            </View>

            {/* Upcoming marathons — a swipeable teaser into the full calendar */}
            <View style={{ gap: 10 }}>
              <SectionHeader
                title="Upcoming marathons"
                action={upcomingRaces.length > 0 ? { label: "See all", onPress: () => router.push("/races" as Href) } : undefined}
              />
              {upcomingRaces.length > 0 ? (
                <RaceCarousel
                  races={upcomingRaces}
                  onPressRace={(r) => (r.url ? Linking.openURL(r.url).catch(() => {}) : router.push("/races" as Href))}
                />
              ) : (
                <Tap onPress={() => router.push("/races" as Href)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="flag" size={22} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Race calendar</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Find your next start line</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.subtle} />
                </Tap>
              )}
            </View>

            {/* Popular clubs in your city you haven't joined yet */}
            {user.city && discoverClubs.length > 0 && (
              <View style={{ gap: 10 }}>
                <SectionHeader title={`Popular clubs in ${user.city}`} action={{ label: "Explore", onPress: () => router.push("/explore") }} />
                <ClubCarousel clubs={discoverClubs} joiningId={joiningId} onJoin={joinClub} />
              </View>
            )}
          </>
        )}
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}
