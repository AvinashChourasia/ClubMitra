// Clubs tab: the clubs you belong to or run. Open a club, join one with an
// invite code, or create your own.

import { useCallback, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myChapters, isChapterAdmin, roleLabel, type MyChapter } from "../../lib/clubs";
import { swr } from "../../lib/cache";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { GuestClubs } from "../../components/GuestScreens";

function CountPill({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 }}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export default function Clubs() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates
  const [clubs, setClubs] = useState<MyChapter[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Spinner only while we have NOTHING; revisits show last data instantly and
  // refresh silently in the background (stale-while-revalidate).
  const loading = clubs === null;

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      // Cached clubs paint instantly (even offline / backend asleep), then
      // refresh in the background and persist for next launch.
      await swr(`${user?.id}:clubs`, () => myChapters(token), setClubs);
    } catch {
      // No cache AND the fetch failed — only now land on "empty".
      setClubs((prev) => prev ?? []);
    }
  }, [getAccessToken, user?.id]);

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

  if (!user) return <GuestClubs />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Your clubs</Text>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label="Join" icon="enter-outline" variant="secondary" onPress={() => router.push("/club/join")} style={{ flex: 1 }} />
          <Button label="Create club" icon="add" onPress={() => router.push("/club/new")} style={{ flex: 1 }} />
        </View>

        {/* Discover: browse public clubs by city (the same explore guests see) */}
        <Tap onPress={() => router.push("/explore" as Href)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="compass" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Discover clubs</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Find clubs running in your city</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.subtle} />
        </Tap>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : clubs && clubs.length > 0 ? (
          clubs.map((c) => {
            const badge = isChapterAdmin(c.role) ? roleLabel(c.role) : c.status ? c.status : null;
            return (
              <Tap key={c.id} onPress={() => router.push(`/club/${c.id}`)} style={[styles.card, { padding: 0, gap: 0, overflow: "hidden" }]}>
                {/* Banner hero — the club's image if set, else the brand gradient */}
                <View style={{ height: 120, justifyContent: "flex-end" }}>
                  {c.banner ? (
                    <Image source={{ uri: c.banner }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <LinearGradient colors={gradients.red} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  )}
                  {/* bottom scrim so the name stays legible over any image */}
                  <LinearGradient colors={["transparent", "rgba(2,6,23,0.62)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
                  {/* role / status pill */}
                  {badge && (
                    <View style={{ position: "absolute", top: 10, right: 10, backgroundColor: "rgba(2,6,23,0.55)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", textTransform: "capitalize" }}>{badge}</Text>
                    </View>
                  )}
                  {/* logo + name overlaid bottom-left */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, paddingBottom: 11 }}>
                    <View style={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.85)", borderRadius: 23 }}>
                      <Avatar name={c.name} uri={c.logo} size={42} bg={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17, letterSpacing: -0.2 }} numberOfLines={1}>{c.name}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: "600" }} numberOfLines={1}>📍 {c.city}</Text>
                    </View>
                  </View>
                </View>
                {/* stats */}
                <View style={{ flexDirection: "row", gap: 10, padding: 14 }}>
                  <CountPill icon="people" value={c.member_count} label={c.member_count === 1 ? "member" : "members"} />
                  <CountPill icon="trophy" value={c.active_challenge_count} label={c.active_challenge_count === 1 ? "challenge" : "challenges"} />
                </View>
              </Tap>
            );
          })
        ) : (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32, marginTop: 8 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="people" size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>No clubs yet</Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              Join with an invite code, or create your own club.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
