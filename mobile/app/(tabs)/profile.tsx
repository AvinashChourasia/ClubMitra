// Profile tab: a hero header with your photo + key info, a details card, the
// clubs you belong to, and account actions.

import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myChapters, isChapterAdmin, type MyChapter } from "../../lib/clubs";
import { myRuns, type MyRun } from "../../lib/attendance";
import { getTrustScore, TIER_META, type TrustSnapshot } from "../../lib/trust";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { runningLevelLabel } from "../../lib/profile";
import { formatRunWhen, isPast } from "../../lib/format";
import { Avatar } from "../../components/Avatar";

// tierColor maps a trust tier to its accent colour (basic → muted, trusted →
// brand accent, verified → success green).
function tierColor(tier: "basic" | "trusted" | "verified"): string {
  return tier === "verified" ? colors.success : tier === "trusted" ? colors.accent : colors.muted;
}

function Pill({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
      <Ionicons name={icon} size={13} color="#fff" />
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value?: string | number | null; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </Text>
    </View>
  );
}

export default function Profile() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe so a theme toggle re-themes this screen instantly
  const [clubs, setClubs] = useState<MyChapter[] | null>(null);
  const [runs, setRuns] = useState<MyRun[]>([]);
  const [trust, setTrust] = useState<TrustSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        const [c, r] = await Promise.all([myChapters(token), myRuns(token)]);
        setClubs(c);
        setRuns(r);
        // Trust score is non-critical — never let it fail the whole screen.
        getTrustScore(token).then(setTrust).catch(() => {});
      }
    } catch {
      setClubs([]);
    }
  }, [getAccessToken]);

  // The next few upcoming runs across all clubs.
  const upcoming = runs.filter((r) => !isPast(r.scheduled_at)).slice(0, 3);

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

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Hero */}
        <LinearGradient
          colors={gradients.red}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 24, padding: 24, alignItems: "center", gap: 10, shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 6 }}
        >
          <Pressable onPress={() => router.push("/settings")} hitSlop={10} style={{ position: "absolute", top: 16, right: 16 }}>
            <Ionicons name="settings-outline" size={22} color="#fff" />
          </Pressable>
          <View style={{ borderWidth: 3, borderColor: "rgba(255,255,255,0.55)", borderRadius: 50 }}>
            <Avatar name={user.name} uri={user.profile_photo} size={88} bg="rgba(255,255,255,0.18)" />
          </View>
          <Text style={{ color: "#fff", fontSize: 23, fontWeight: "800", letterSpacing: -0.3 }}>{user.name}</Text>
          <Text style={{ color: "rgba(255,255,255,0.88)", fontSize: 13 }}>{user.email}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2, flexWrap: "wrap", justifyContent: "center" }}>
            <Pill icon="flash" text={runningLevelLabel(user.running_level)} />
            {user.city ? <Pill icon="location" text={user.city} /> : null}
          </View>
        </LinearGradient>

        {/* Details */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
            <Text style={styles.sectionTitle}>Your details</Text>
            <Pressable onPress={() => router.push("/profile/edit")} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>Edit</Text>
            </Pressable>
          </View>
          <DetailRow label="Phone" value={user.phone} />
          <DetailRow label="Age" value={user.age} />
          <DetailRow label="City" value={user.city} />
          <DetailRow label="Running level" value={runningLevelLabel(user.running_level)} />
          <DetailRow label="T-shirt size" value={user.tshirt_size} last />
        </View>

        {/* Trust score */}
        {trust && (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Text style={styles.sectionTitle}>Trust score</Text>
              <View style={{ backgroundColor: tierColor(trust.trust_tier) + "22", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ color: tierColor(trust.trust_tier), fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {TIER_META[trust.trust_tier].label}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
              <Text style={{ color: colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1 }}>{Math.round(trust.trust_score)}</Text>
              <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>/ 100</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.bgSecondary, overflow: "hidden", marginTop: 6 }}>
              <View style={{ width: `${Math.max(0, Math.min(100, trust.trust_score))}%`, height: "100%", backgroundColor: tierColor(trust.trust_tier) }} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>{TIER_META[trust.trust_tier].explain}</Text>
          </View>
        )}

        {/* Clubs (shown before schedule) */}
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
                  <Avatar name={c.name} size={40} bg={colors.accent} />
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

        {/* Schedule */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={styles.sectionTitle}>Your schedule</Text>
            <Pressable onPress={() => router.push("/schedule")} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>View all</Text>
            </Pressable>
          </View>
          {upcoming.length === 0 ? (
            <Text style={{ color: colors.muted }}>No upcoming runs.</Text>
          ) : (
            <View style={{ gap: 4 }}>
              {upcoming.map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/run/${r.id}`)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 10,
                    borderBottomWidth: i === upcoming.length - 1 ? 0 : 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{r.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {r.chapter_name} · {formatRunWhen(r.scheduled_at, r.has_time)}
                    </Text>
                  </View>
                  {r.checked_in && (
                    <View style={{ backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✓ In</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
