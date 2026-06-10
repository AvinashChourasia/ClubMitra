// City leaderboard — every GPS-verified runner in your city ranked by distance
// over a rolling window (this week / month / all-time). Your own row is
// highlighted. Reached from the Your runs screen.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { cityLeaderboard, type CityBoardView, type CityPeriod } from "../../lib/activities";
import { formatDistance } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { colors, styles } from "../../lib/theme";

const PERIODS: { key: CityPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

// Medal accents for the podium; everyone else gets a muted rank number.
function rankColor(rank: number): string {
  return rank === 1 ? "#F59E0B" : rank === 2 ? "#94A3B8" : rank === 3 ? "#B45309" : colors.muted;
}

export default function CityLeaderboard() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<CityPeriod>("week");
  const [board, setBoard] = useState<CityBoardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (p: CityPeriod) => {
      const token = await getAccessToken();
      if (!token) return;
      const view = await cityLeaderboard(token, p, user?.city ?? undefined);
      setBoard(view);
    },
    [getAccessToken, user?.city]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      (async () => {
        try {
          await load(period);
        } catch {
          if (active) setBoard(null);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [load, period])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load(period);
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  if (!user) return <Redirect href="/login" />;

  const cityName = board?.city || user.city || "your city";
  const entries = board?.entries ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
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
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>City ranking</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textTransform: "capitalize" }}>{cityName}</Text>
          </View>
          <Ionicons name="trophy" size={22} color="#F59E0B" />
        </View>

        {/* Period segmented control */}
        <View style={{ flexDirection: "row", backgroundColor: colors.bg, borderRadius: 12, padding: 4, gap: 4 }}>
          {PERIODS.map((p) => {
            const sel = p.key === period;
            return (
              <Tap
                key={p.key}
                haptic={false}
                onPress={() => setPeriod(p.key)}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: 9,
                  backgroundColor: sel ? colors.primary : "transparent",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: sel ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{p.label}</Text>
              </Tap>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : entries.length === 0 ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="trophy-outline" size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>No runs yet</Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              {user.city ? "Be the first to record a run in your city." : "Set your city in Profile to join the ranking."}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { gap: 2 }]}>
            {entries.map((e, i) => {
              const me = e.user_id === user.id;
              return (
                <View
                  key={e.user_id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                    backgroundColor: me ? colors.primarySoft : "transparent",
                    borderBottomWidth: i === entries.length - 1 ? 0 : 1,
                    borderBottomColor: me ? "transparent" : colors.border,
                  }}
                >
                  <Text style={{ width: 26, textAlign: "center", color: rankColor(e.rank), fontWeight: "800", fontSize: 15 }}>
                    {e.rank}
                  </Text>
                  <Avatar name={e.display_name} uri={e.profile_photo} size={38} bg={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700" }} numberOfLines={1}>
                      {e.display_name}
                      {me ? " (you)" : ""}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {e.runs} {e.runs === 1 ? "run" : "runs"}
                    </Text>
                  </View>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{formatDistance(e.distance_m)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
