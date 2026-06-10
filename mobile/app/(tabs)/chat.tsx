// Chat tab — the WhatsApp-grade inbox. Club group chats are PINNED on top
// (they're the product's heart), direct chats follow by recency. Every row:
// avatar, title, smart timestamp (time → Yesterday → weekday → date), a
// one-line preview ("You: " for your own last message, media labels from the
// server), and a green unread badge. Search filters conversations by name.

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { inbox, type InboxItem } from "../../lib/messaging";
import { setUnreadTotal, sumUnread } from "../../lib/unread";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { colors, useThemeMode } from "../../lib/theme";
import { GuestChat } from "../../components/GuestScreens";

// Smart, WhatsApp-style timestamp: time today, "Yesterday", weekday within the
// last week, else a short date.
function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const ageDays = (now.getTime() - d.getTime()) / 86400000;
  if (ageDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// recency sorts newest-first; rows with no messages sink.
function recency(a: InboxItem, b: InboxItem): number {
  if (!!a.last_at !== !!b.last_at) return a.last_at ? -1 : 1;
  if (!a.last_at || !b.last_at) return 0;
  return new Date(b.last_at).getTime() - new Date(a.last_at).getTime();
}

export default function Chat() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const list = await inbox(token);
    setItems(list);
    setUnreadTotal(sumUnread(list)); // keep the tab badge honest
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load();
        } catch {
          if (active) setItems([]);
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

  function open(it: InboxItem) {
    if (it.kind === "club" && it.chapter_id) router.push(`/thread/club/${it.chapter_id}`);
    else if (it.kind === "direct" && it.user_id) router.push(`/thread/dm/${it.user_id}`);
  }

  // Pinned clubs on top (each group by recency), then DMs by recency; search
  // filters across both by title.
  const sections = useMemo(() => {
    const all = items ?? [];
    const q = search.trim().toLowerCase();
    const match = (it: InboxItem) => !q || it.title.toLowerCase().includes(q);
    return {
      clubs: all.filter((it) => it.kind === "club" && match(it)).sort(recency),
      directs: all.filter((it) => it.kind === "direct" && match(it)).sort(recency),
    };
  }, [items, search]);

  if (!user) return <GuestChat />;

  const rows = [...sections.clubs, ...sections.directs];
  const pinnedCount = sections.clubs.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>Chats</Text>
        <Tap onPress={() => router.push("/thread/new")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Tap>
      </View>

      {/* Search */}
      <View style={{ marginHorizontal: 16, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingHorizontal: 12 }}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          style={{ flex: 1, paddingVertical: 10, color: colors.text, fontSize: 15 }}
          placeholder="Search chats"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
        {search !== "" && (
          <Tap haptic={false} onPress={() => setSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={colors.muted} />
          </Tap>
        )}
      </View>

      {items === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {rows.length === 0 ? (
            search ? (
              <View style={{ alignItems: "center", paddingVertical: 60 }}>
                <Text style={{ color: colors.muted }}>No chats match “{search.trim()}”.</Text>
              </View>
            ) : (
              // Empty inbox = no clubs and no DMs yet → route them to the fix.
              <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 }}>
                <View style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chatbubbles" size={34} color={colors.primary} />
                  </View>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>Your club chat lives here</Text>
                  <Text style={{ color: colors.muted, textAlign: "center", fontSize: 14 }}>
                    Join a club and its group chat appears automatically — schedules, banter, race-day plans.
                  </Text>
                </View>
                <Button label="Discover clubs" icon="compass" onPress={() => router.push("/explore")} />
                <Button label="Message someone" icon="create-outline" variant="secondary" onPress={() => router.push("/thread/new")} />
              </View>
            )
          ) : (
            rows.map((it, i) => {
              // Thick soft divider between the pinned club block and the DMs.
              const sectionBreak = i === pinnedCount - 1 && pinnedCount < rows.length;
              const unread = it.unread > 0;
              const mineLast = !!it.last_sender_id && it.last_sender_id === user.id;
              const preview = it.last_message
                ? `${mineLast ? "You: " : ""}${it.last_message}`
                : it.kind === "club"
                  ? "Club group chat"
                  : "No messages yet";
              return (
                <Tap
                  key={`${it.kind}-${it.chapter_id ?? it.user_id ?? i}`}
                  onPress={() => open(it)}
                  haptic={false}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: i === rows.length - 1 ? 0 : sectionBreak ? 6 : 1,
                    borderBottomColor: sectionBreak ? colors.bgSecondary : colors.border,
                  }}
                >
                  <View>
                    <Avatar name={it.title} uri={it.photo_url} size={52} bg={it.kind === "club" ? colors.primary : colors.accent} />
                    {it.kind === "club" && (
                      <View style={{ position: "absolute", right: -2, bottom: -2, backgroundColor: colors.bg, borderRadius: 9, padding: 1 }}>
                        <Ionicons name="people-circle" size={16} color={colors.primary} />
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: colors.text, fontWeight: unread ? "800" : "700", fontSize: 16, flex: 1 }} numberOfLines={1}>
                        {it.title}
                      </Text>
                      <Text style={{ color: unread ? colors.success : colors.muted, fontSize: 11, marginLeft: 8, fontWeight: unread ? "700" : "400" }}>
                        {when(it.last_at)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                      <Text
                        style={{ color: unread ? colors.text : colors.muted, fontSize: 13, fontWeight: unread ? "600" : "400", flex: 1 }}
                        numberOfLines={1}
                      >
                        {preview}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8 }}>
                        {it.kind === "club" && <Ionicons name="pin" size={13} color={colors.subtle} style={{ transform: [{ rotate: "45deg" }] }} />}
                        {unread && (
                          <View style={{ backgroundColor: colors.success, borderRadius: 11, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{it.unread > 99 ? "99+" : it.unread}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </Tap>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
