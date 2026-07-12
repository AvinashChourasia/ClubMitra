// Home: the daily front door. Leads with the run you can start right now (the
// GPS track card), then your personal slice — next run, challenges in flight,
// upcoming marathons to chase — and fresh clubs in your city to discover.

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myRuns, type MyRun } from "../../lib/attendance";
import { listChallenges, challengeFraction, challengeProgress, challengeTarget, challengeUnit, type Challenge } from "../../lib/challenges";
import { myChapters, type MyChapter } from "../../lib/clubs";
import { publicClubs, type DiscoverClub } from "../../lib/discover";
import { listActivities, getRoute, getStats, geoJSONToLatLng, offsetsToTimes, type Activity, type LatLng, type Stats } from "../../lib/activities";
import { listRaces, cityMatch, type Race } from "../../lib/races";
import { useJoinGate, ClubCarousel, TrackRunCard } from "../../components/discovery";
import { RaceCarousel } from "../../components/RaceCarousel";
import { ProgressBar } from "../../components/ProgressBar";
import { RouteTrace } from "../../components/RouteTrace";
import { Tap } from "../../components/Tap";
import { GradientCard } from "../../components/GradientCard";
import { ErrorState } from "../../components/ErrorState";
import { colors, styles, useThemeMode } from "../../lib/theme";
import { formatDistance, formatDuration, formatPace, formatRunWhen, isPast } from "../../lib/format";
import { GuestHome } from "../../components/GuestScreens";
import { activeStats, liveElapsedS } from "../../lib/locationTask";

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
  const [stats, setStats] = useState<Stats | null>(null); // week pulse (best-effort)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // A hard load failure (vs. a transient refresh that we silently ride out on
  // the last-good state). Only surfaced as a retry card when we have nothing
  // to show — see `loadFailed && !hasData` below.
  const [loadFailed, setLoadFailed] = useState(false);
  const { joinClub, joiningId } = useJoinGate();

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        const [r, c, ch, pc, acts, rc, st] = await Promise.all([
          myRuns(token),
          listChallenges(token, true),
          myChapters(token),
          // Discovery strip: public clubs in the member's own city.
          user?.city ? publicClubs(user.city).catch(() => []) : Promise.resolve([]),
          listActivities(token).catch(() => [] as Activity[]),
          // Upcoming marathons teaser — fetch all, prioritise the member's city.
          listRaces(token).catch(() => [] as Race[]),
          // Week pulse for the momentum strip (best-effort).
          getStats(token).catch(() => null),
        ]);
        setRuns(r);
        setChallenges(c);
        setClubs(ch);
        setCityClubs(pc);
        setRaces(rc);
        setStats(st);
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
        setLoadFailed(false);
      }
    } catch {
      // A core fetch failed. We keep any last-good state (a refresh that blips
      // shouldn't wipe the screen); the flag only drives the retry card when
      // there's genuinely nothing to show.
      setLoadFailed(true);
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

  // Retry from the error card: show the inline spinner while we re-fetch.
  async function retry() {
    setLoading(true);
    await load();
    setLoading(false);
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
  // Did we manage to load anything? If a load failed but we still have content
  // (e.g. a refresh blipped), ride it out silently; only show the retry card
  // when there's truly nothing on screen.
  const hasData = runs.length > 0 || challenges.length > 0 || clubs.length > 0 || races.length > 0 || lastRun !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Greeting — time-aware, with the date; the three counters double as
            shortcuts into their screens. */}
        <GradientCard glowColor={colors.primary} style={{ padding: 22, gap: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13.5, fontWeight: "600" }}>
                {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
              </Text>
              <Text style={{ color: "#fff", fontSize: 27, fontWeight: "800", letterSpacing: -0.4 }}>Hi, {firstName} 👋</Text>
            </View>
            <Ionicons name="walk" size={30} color="rgba(255,255,255,0.9)" />
          </View>
          <View style={{ flexDirection: "row", gap: 24 }}>
            <HeroStat value={clubs.length} label={clubs.length === 1 ? "club" : "clubs"} onPress={() => router.push("/clubs")} />
            <HeroStat value={challenges.length} label="challenges" onPress={() => router.push("/challenges")} />
            <HeroStat
              value={runs.filter((r) => !isPast(r.scheduled_at)).length}
              label="upcoming"
              onPress={() => router.push("/schedule" as Href)}
            />
          </View>
        </GradientCard>

        {/* Record entry point — resume banner while a run records in the
            background, otherwise the "start a run" track card. Lives in its
            own component so its 1s tick never re-renders this whole screen. */}
        <ActiveRunBanner onPress={() => router.push("/activity/record")} />

        {/* Week pulse — your momentum at a glance; taps into the stats hub. */}
        {stats && stats.total_runs > 0 && (
          <Tap onPress={() => router.push("/activity")} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: "800", letterSpacing: 1 }}>THIS WEEK</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                <Text style={{ color: colors.text, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 }}>
                  {(stats.week_distance_m / 1000).toFixed(1)} km
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: "600" }}>
                  {stats.week_runs} run{stats.week_runs === 1 ? "" : "s"}
                </Text>
                {stats.prev_week_distance_m > 0 && (
                  <Ionicons
                    name={stats.week_distance_m >= stats.prev_week_distance_m ? "trending-up" : "trending-down"}
                    size={15}
                    color={stats.week_distance_m >= stats.prev_week_distance_m ? colors.success : colors.warning}
                  />
                )}
              </View>
            </View>
            {stats.current_streak_days > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.14)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 }}>
                <Text style={{ fontSize: 13 }}>🔥</Text>
                <Text style={{ color: colors.warning, fontWeight: "800", fontSize: 13.5 }}>{stats.current_streak_days}d</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
          </Tap>
        )}

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
        ) : loadFailed && !hasData ? (
          <ErrorState message="We couldn't load your home feed. Check your connection and try again." onRetry={retry} />
        ) : (
          <>
            {/* Next run */}
            <View style={{ gap: 10 }}>
              <SectionHeader title="Next run" action={{ label: "Schedule", onPress: () => router.push("/schedule" as Href) }} />
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
                <Tap onPress={() => router.push("/schedule" as Href)} style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                  <Ionicons name="calendar-outline" size={28} color={colors.subtle} />
                  <Text style={{ color: colors.text, fontWeight: "700", marginTop: 8 }}>No upcoming runs</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Check the schedule — or rally your club for one.</Text>
                </Tap>
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
                activeChallenges.map((c) => {
                  // Ending-soon urgency: the nudge that gets the run recorded today.
                  const daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
                  const urgent = daysLeft >= 0 && daysLeft <= 7;
                  return (
                  <Tap key={c.id} onPress={() => router.push(`/challenge/${c.id}`)} style={[styles.card, { gap: 8 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, flex: 1 }} numberOfLines={1}>{c.title}</Text>
                      {urgent && (
                        <View style={{ backgroundColor: daysLeft <= 3 ? "rgba(245,158,11,0.16)" : colors.bgSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: daysLeft <= 3 ? colors.warning : colors.muted, fontSize: 11, fontWeight: "800" }}>
                            {daysLeft === 0 ? "ends today" : `${daysLeft}d left`}
                          </Text>
                        </View>
                      )}
                    </View>
                    <ProgressBar fraction={challengeFraction(c)} />
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {challengeProgress(c).toFixed(challengeUnit(c) === "km" ? 1 : 0)} / {challengeTarget(c)} {challengeUnit(c)} ({Math.round(challengeFraction(c) * 100)}%)
                    </Text>
                  </Tap>
                  );
                })
              )}
            </View>

            {/* Upcoming marathons — a swipeable teaser into the Events tab */}
            <View style={{ gap: 10 }}>
              <SectionHeader
                title="Upcoming marathons"
                action={upcomingRaces.length > 0 ? { label: "See all", onPress: () => router.push("/events" as Href) } : undefined}
              />
              {upcomingRaces.length > 0 ? (
                <RaceCarousel
                  races={upcomingRaces}
                  onPressRace={(r) => (r.url ? Linking.openURL(r.url).catch(() => {}) : router.push("/events" as Href))}
                />
              ) : (
                <Tap onPress={() => router.push("/events" as Href)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="flag" size={22} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Event calendar</Text>
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

// ActiveRunBanner: the "run in progress" resume banner, or the start-a-run
// track card when nothing is recording. The 1s activeStats() tick lives HERE
// so a minimised run only re-renders these few views every second — never the
// whole Home ScrollView (hero, RouteTrace SVG, carousels, challenge cards).
function ActiveRunBanner({ onPress }: { onPress: () => void }) {
  // A run recording in the background (started then minimised) — surfaced as a
  // "resume" banner so it's never silently lost behind the home screen.
  const [activeRun, setActiveRun] = useState<{ distanceM: number; elapsedS: number } | null>(null);

  // Keep the banner live while Home is focused — a run minimised here is still
  // recording, so its distance/time should keep ticking.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const tick = async () => {
        const s = await activeStats();
        if (!active) return;
        if (!s) {
          setActiveRun((prev) => (prev === null ? prev : null));
          return;
        }
        const distanceM = s.distanceM;
        const elapsedS = liveElapsedS(s, Date.now());
        // Bail with the same object when nothing changed (e.g. auto-paused) so
        // identical seconds don't re-render even this small tree.
        setActiveRun((prev) => (prev && prev.distanceM === distanceM && prev.elapsedS === elapsedS ? prev : { distanceM, elapsedS }));
      };
      void tick();
      const id = setInterval(() => void tick(), 1000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [])
  );

  // A run is recording in the background — resume it instead of offering to
  // start a new one (which would discard the one in progress).
  if (activeRun) {
    return (
      <Tap
        onPress={onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          backgroundColor: colors.primarySoft,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.primary,
          padding: 16,
        }}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="pulse" size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 16 }}>Run in progress · tap to resume</Text>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>
            {formatDistance(activeRun.distanceM)} · {formatDuration(activeRun.elapsedS)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </Tap>
    );
  }

  /* Start a run — the GPS track card IS the record button. */
  return <TrackRunCard onPress={onPress} title="Record your run" subtitle="Every km counts for your clubs & challenges." />;
}

function HeroStat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={`${value} ${label}`}>
      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
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
