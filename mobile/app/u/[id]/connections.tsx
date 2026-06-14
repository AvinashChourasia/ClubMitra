// Followers / Following — the two sides of a runner's social graph, behind a
// segmented toggle. Each row taps through to that runner's profile and carries
// its own Follow button so you can build your graph without leaving the list.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { listFollowers, listFollowing, followRunner, unfollowRunner, type RunnerCard } from "../../../lib/social";
import { Avatar } from "../../../components/Avatar";
import { Tap } from "../../../components/Tap";
import { colors, useThemeMode } from "../../../lib/theme";

type Tab = "followers" | "following";

export default function ConnectionsScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [active, setActive] = useState<Tab>(tab === "following" ? "following" : "followers");
  const [cards, setCards] = useState<RunnerCard[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (which: Tab) => {
      try {
        const token = await getAccessToken();
        if (!token || !id) return;
        setCards(await (which === "followers" ? listFollowers(token, id) : listFollowing(token, id)));
      } catch {
        setCards((prev) => prev ?? []);
      }
    },
    [getAccessToken, id]
  );

  useFocusEffect(
    useCallback(() => {
      void load(active);
    }, [load, active])
  );

  function switchTab(t: Tab) {
    if (t === active) return;
    setActive(t);
    setCards(null);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load(active);
    setRefreshing(false);
  }

  async function toggleFollow(card: RunnerCard) {
    if (busyId) return;
    setBusyId(card.id);
    const was = card.is_following;
    setCards((cs) => (cs ?? []).map((c) => (c.id === card.id ? { ...c, is_following: !was } : c)));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no token");
      const res = was ? await unfollowRunner(token, card.id) : await followRunner(token, card.id);
      setCards((cs) => (cs ?? []).map((c) => (c.id === card.id ? { ...c, is_following: res.following } : c)));
    } catch {
      setCards((cs) => (cs ?? []).map((c) => (c.id === card.id ? { ...c, is_following: was } : c)));
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} hitSlop={12} haptic={false} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Tap>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Connections</Text>
      </View>

      {/* Segmented toggle */}
      <View style={{ flexDirection: "row", marginHorizontal: 16, marginBottom: 6, backgroundColor: colors.bg, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.border }}>
        {(["followers", "following"] as Tab[]).map((t) => (
          <Tap
            key={t}
            haptic={false}
            onPress={() => switchTab(t)}
            style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999, backgroundColor: active === t ? colors.primary : "transparent" }}
          >
            <Text style={{ color: active === t ? "#fff" : colors.muted, fontWeight: "800", fontSize: 13.5 }}>
              {t === "followers" ? "Followers" : "Following"}
            </Text>
          </Tap>
        ))}
      </View>

      {cards === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 4, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {cards.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <Ionicons name="people-outline" size={36} color={colors.subtle} />
              <Text style={{ color: colors.muted, marginTop: 10, textAlign: "center" }}>
                {active === "followers" ? "No followers yet." : "Not following anyone yet."}
              </Text>
            </View>
          ) : (
            cards.map((c) => (
              <Tap
                key={c.id}
                haptic={false}
                onPress={() => router.push(`/u/${c.id}` as Href)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}
              >
                <Avatar name={c.name} uri={c.profile_photo} size={46} bg={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{c.name}</Text>
                  {c.city ? <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>{c.city}</Text> : null}
                </View>
                {c.id !== user.id && (
                  <Tap
                    haptic={false}
                    onPress={() => void toggleFollow(c)}
                    disabled={busyId === c.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      borderRadius: 999,
                      backgroundColor: c.is_following ? colors.bg : colors.primary,
                      borderWidth: 1,
                      borderColor: c.is_following ? colors.border : colors.primary,
                      opacity: busyId === c.id ? 0.6 : 1,
                    }}
                  >
                    <Ionicons name={c.is_following ? "checkmark" : "person-add"} size={13} color={c.is_following ? colors.text : "#fff"} />
                    <Text style={{ color: c.is_following ? colors.text : "#fff", fontWeight: "800", fontSize: 12.5 }}>
                      {c.is_following ? "Following" : "Follow"}
                    </Text>
                  </Tap>
                )}
              </Tap>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
