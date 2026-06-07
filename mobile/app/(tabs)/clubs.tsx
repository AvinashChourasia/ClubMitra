// Clubs tab: the chapters you belong to or run. Open a club, join one with an
// invite code, or create your own.

import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { myChapters, isChapterAdmin, type MyChapter } from "../../lib/clubs";
import { colors, styles, useThemeMode } from "../../lib/theme";
import { Avatar } from "../../components/Avatar";

function CountPill({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 }}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: "admin" | "member" }) {
  const bg = tone === "admin" ? colors.primary : colors.bgSecondary;
  const fg = tone === "admin" ? "#fff" : colors.muted;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>{text}</Text>
    </View>
  );
}

export default function Clubs() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates
  const [clubs, setClubs] = useState<MyChapter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) setClubs(await myChapters(token));
    } catch {
      setClubs([]);
    }
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Your clubs</Text>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => router.push("/club/join")}
            style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
          >
            <Ionicons name="enter-outline" size={18} color={colors.text} />
            <Text style={{ color: colors.text, fontWeight: "700" }}>Join</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/club/new")}
            style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 7, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700" }}>Create club</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : clubs && clubs.length > 0 ? (
          clubs.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/club/${c.id}`)} style={[styles.card, { gap: 12, padding: 16 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <Avatar name={c.name} size={52} bg={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 17, fontWeight: "800", color: colors.text }}>{c.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>📍 {c.city}</Text>
                </View>
                {isChapterAdmin(c.role) ? (
                  <Badge text={(c.role ?? "").replace("_", " ")} tone="admin" />
                ) : c.status ? (
                  <Badge text={c.status} tone="member" />
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <CountPill icon="people" value={c.member_count} label={c.member_count === 1 ? "member" : "members"} />
                <CountPill icon="trophy" value={c.active_challenge_count} label={c.active_challenge_count === 1 ? "challenge" : "challenges"} />
              </View>
            </Pressable>
          ))
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
