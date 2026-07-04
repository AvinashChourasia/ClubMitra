// Inactive members (admin-only) — who's gone quiet, so an admin can reach out.
// Reached from the "members have gone quiet" alert on the Manage console. Each
// row taps to the runner's profile; the Message button opens a DM to nudge them.

import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { getInactiveMembers, type InactiveMember } from "../../../lib/analytics";
import { colors, useThemeMode } from "../../../lib/theme";
import { Avatar } from "../../../components/Avatar";

const WINDOWS = [14, 30, 60] as const;

function subtitle(m: InactiveMember): string {
  if (m.days_quiet == null) return "Never logged a run or check-in";
  return `Quiet for ${m.days_quiet} day${m.days_quiet === 1 ? "" : "s"}`;
}

export default function InactiveMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useThemeMode();

  const [days, setDays] = useState<number>(14);
  const [list, setList] = useState<InactiveMember[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      setList(await getInactiveMembers(token, id, days));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [getAccessToken, id, days]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const renderRow = useCallback(
    ({ item }: { item: InactiveMember }) => (
      <Pressable
        onPress={() => router.push(`/u/${item.user_id}` as Href)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }}
      >
        <Avatar name={item.name} uri={item.profile_photo} size={46} bg={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{item.name}</Text>
          <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{subtitle(item)}</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/thread/dm/${item.user_id}` as Href)}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 }}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12.5 }}>Nudge</Text>
        </Pressable>
      </Pressable>
    ),
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <View>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Quiet members</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>No run or check-in recently — reach out</Text>
        </View>
      </View>

      {/* Window filter */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
        {WINDOWS.map((w) => {
          const on = days === w;
          return (
            <Pressable
              key={w}
              onPress={() => setDays(w)}
              style={{ backgroundColor: on ? colors.primary : colors.bg, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}
            >
              <Text style={{ color: on ? "#fff" : colors.muted, fontWeight: "800", fontSize: 13 }}>{w}+ days</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={list ?? []}
        keyExtractor={(m) => m.user_id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 + insets.bottom }}
        ListEmptyComponent={
          list === null && !failed ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 28 }} />
          ) : failed ? (
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 28 }}>Couldn&apos;t load this. Only club admins can see it.</Text>
          ) : (
            <View style={{ alignItems: "center", marginTop: 40, gap: 8 }}>
              <Text style={{ fontSize: 34 }}>🎉</Text>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Everyone&apos;s been active</Text>
              <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center", paddingHorizontal: 32 }}>
                No member has been quiet for {days}+ days. Nice club.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
