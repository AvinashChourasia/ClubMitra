// Your runs — history of recorded GPS activities, newest first, with all-time
// stats. Tap a run to open its detail (route map + breakdown). Reached from the
// Profile tab.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
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
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text, flex: 1 }}>Your runs</Text>
          <Tap onPress={() => router.push("/activity/import")} hitSlop={8} haptic={false} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Import</Text>
          </Tap>
        </View>

        {/* Stats: this week leads (the number runners actually chase), then
            month/all-time/streak, and personal records. */}
        {stats && stats.total_runs > 0 && (
          <>
            {/* This week — hero with a Δ-vs-last-week chip */}
            <View style={[styles.card, { gap: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 }}>THIS WEEK</Text>
                <WeekDelta weekM={stats.week_distance_m} prevM={stats.prev_week_distance_m} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 }}>
                <Text style={{ color: colors.text, fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 44 }}>
                  {(stats.week_distance_m / 1000).toFixed(1)}
                  <Text style={{ fontSize: 17, color: colors.muted, fontWeight: "700" }}> km</Text>
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13.5, fontWeight: "600", paddingBottom: 6 }}>
                  {stats.week_runs} run{stats.week_runs === 1 ? "" : "s"} · {formatDuration(stats.week_duration_s)}
                </Text>
              </View>
            </View>

            {/* Month + all-time + streak */}
            <View style={[styles.card, { flexDirection: "row" }]}>
              <Stat label="This month" value={formatDistance(stats.month_distance_m)} />
              <Stat label="All-time" value={formatDistance(stats.total_distance_m)} />
              <Stat label="Runs" value={String(stats.total_runs)} />
              <Stat
                label={stats.best_streak_days > 1 ? `Streak · best ${stats.best_streak_days}d` : "Streak"}
                value={`${stats.current_streak_days > 0 ? "🔥" : ""}${stats.current_streak_days}d`}
              />
            </View>

            {/* Personal records — what people screenshot */}
            <View style={[styles.card, { gap: 10 }]}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 }}>PERSONAL RECORDS</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <PRChip icon="resize" label="Longest" value={formatDistance(stats.longest_run_m)} />
                {stats.best_pace_s_per_km != null && <PRChip icon="speedometer" label="Best pace" value={formatPace(stats.best_pace_s_per_km)} />}
                {stats.best_pace_5k_s_per_km != null && <PRChip icon="flash" label="5K+ pace" value={formatPace(stats.best_pace_5k_s_per_km)} />}
                {stats.best_pace_10k_s_per_km != null && <PRChip icon="rocket" label="10K+ pace" value={formatPace(stats.best_pace_10k_s_per_km)} />}
              </View>
            </View>
          </>
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
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// WeekDelta — this week vs last, as an up/down chip. Silent until there's a
// last week to compare against (first-week runners just see their number).
function WeekDelta({ weekM, prevM }: { weekM: number; prevM: number }) {
  if (prevM <= 0) return null;
  const dKm = (weekM - prevM) / 1000;
  const up = dKm >= 0;
  const color = up ? colors.success : colors.warning;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.bgSecondary, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Ionicons name={up ? "trending-up" : "trending-down"} size={13} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: "800" }}>
        {up ? "+" : ""}{dKm.toFixed(1)} km vs last week
      </Text>
    </View>
  );
}

// PRChip — one personal record as a compact medal chip.
function PRChip({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 }}>
      <Ionicons name={icon} size={14} color={colors.primary} />
      <View>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 13.5 }}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: "700" }}>{label}</Text>
      </View>
    </View>
  );
}
