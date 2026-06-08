// Home: a club dashboard. A warm gradient greeting, your next run, the
// challenges you're chasing, and a shortcut into your clubs.

import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myRuns, type MyRun } from "../../lib/attendance";
import { listChallenges, challengeFraction, challengeProgress, challengeTarget, challengeUnit, type Challenge } from "../../lib/challenges";
import { myChapters, type MyChapter } from "../../lib/clubs";
import { ProgressBar } from "../../components/ProgressBar";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { formatRunWhen, isPast } from "../../lib/format";

function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>{action.label}</Text>
        </Pressable>
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        const [r, c, ch] = await Promise.all([myRuns(token), listChallenges(token, true), myChapters(token)]);
        setRuns(r);
        setChallenges(c);
        setClubs(ch);
      }
    } catch {
      /* keep last good state */
    }
  }, [getAccessToken]);

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

  if (!user) return <Redirect href="/login" />;

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
        <LinearGradient
          colors={gradients.red}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 24, padding: 22, gap: 14, shadowColor: colors.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 6 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600" }}>Welcome back</Text>
              <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: -0.4 }}>Hi, {firstName} 👋</Text>
            </View>
            <Ionicons name="walk" size={30} color="rgba(255,255,255,0.9)" />
          </View>
          <View style={{ flexDirection: "row", gap: 22 }}>
            <HeroStat value={clubs.length} label={clubs.length === 1 ? "club" : "clubs"} />
            <HeroStat value={challenges.length} label="challenges" />
            <HeroStat value={runs.filter((r) => !isPast(r.scheduled_at)).length} label="upcoming" />
          </View>
        </LinearGradient>

        {/* Log a run — feeds the club leaderboards */}
        <Pressable
          onPress={() => router.push("/runlog/new")}
          style={[styles.button, { flexDirection: "row", justifyContent: "center", gap: 8 }]}
        >
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={styles.buttonText}>Log a run</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : (
          <>
            {/* Next run */}
            <View style={{ gap: 10 }}>
              <SectionHeader title="Next run" action={{ label: "Schedule", onPress: () => router.push("/clubs") }} />
              {nextRun ? (
                <Pressable onPress={() => router.push(`/run/${nextRun.id}`)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="calendar" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{nextRun.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{nextRun.chapter_name} · {formatRunWhen(nextRun.scheduled_at, nextRun.has_time)}</Text>
                  </View>
                  {nextRun.checked_in && <Ionicons name="checkmark-circle" size={22} color={colors.success} />}
                </Pressable>
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
                  <Pressable key={c.id} onPress={() => router.push(`/challenge/${c.id}`)} style={[styles.card, { gap: 8 }]}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{c.title}</Text>
                    <ProgressBar fraction={challengeFraction(c)} />
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {challengeProgress(c)} / {challengeTarget(c)} {challengeUnit(c)} ({Math.round(challengeFraction(c) * 100)}%)
                    </Text>
                  </Pressable>
                ))
              )}
            </View>

            {/* Clubs shortcut */}
            <Pressable onPress={() => router.push("/clubs")} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="people" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{clubs.length > 0 ? "Your clubs" : "Find a club"}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {clubs.length > 0 ? `${clubs.length} ${clubs.length === 1 ? "club" : "clubs"} · tap to manage` : "Join or create a running club"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.subtle} />
            </Pressable>
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
