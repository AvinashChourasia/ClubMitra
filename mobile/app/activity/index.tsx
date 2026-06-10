// Your runs — history of recorded GPS activities, newest first, with all-time
// stats. Tap a run to open its detail (route map + breakdown). Reached from the
// Profile tab.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { listActivities, getStats, type Activity, type Stats } from "../../lib/activities";
import { formatDistance, formatDuration, formatPace } from "../../lib/format";
import { Tap } from "../../components/Tap";
import { colors, styles } from "../../lib/theme";

function runDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export default function RunHistory() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [runs, setRuns] = useState<Activity[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const [a, s] = await Promise.all([listActivities(token), getStats(token).catch(() => null)]);
    setRuns(a);
    setStats(s);
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load();
        } catch {
          if (active) setRuns([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tap
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            hitSlop={12}
            haptic={false}
            style={{ marginLeft: -8, padding: 6 }}
          >
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Tap>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Your runs</Text>
        </View>

        {/* All-time stats */}
        {stats && stats.total_runs > 0 && (
          <View style={[styles.card, { flexDirection: "row" }]}>
            <Stat label="Runs" value={String(stats.total_runs)} />
            <Stat label="Distance" value={formatDistance(stats.total_distance_m)} />
            <Stat label="Time" value={formatDuration(stats.total_duration_s)} />
            <Stat label="Streak" value={`${stats.current_streak_days}d`} />
          </View>
        )}

        {runs === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : runs.length === 0 ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="walk" size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>No runs yet</Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>Record your first run from Home.</Text>
          </View>
        ) : (
          runs.map((r) => (
            <Tap key={r.id} onPress={() => router.push(`/activity/${r.id}`)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="map" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{formatDistance(r.distance_m)}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {runDate(r.started_at)} · {formatDuration(r.duration_s)} · {formatPace(r.avg_pace_s_per_km)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.subtle} />
            </Tap>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 }}>{label}</Text>
    </View>
  );
}
