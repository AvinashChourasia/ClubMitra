// Chat tab — the WhatsApp-grade inbox. Club group chats are PINNED on top,
// direct chats follow by recency. Swipe a row left for Mute / Archive; archived
// chats collapse into a section at the bottom; muted chats show a slashed bell
// and stop counting toward badges. Realtime: rows flip to "typing…" live and
// the list refreshes the moment a message lands anywhere.

import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { inbox, setChatPrefs, type InboxItem } from "../../lib/messaging";
import { ensureConnected, subscribe, type RTEvent } from "../../lib/realtime";
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

function recency(a: InboxItem, b: InboxItem): number {
  if (!!a.last_at !== !!b.last_at) return a.last_at ? -1 : 1;
  if (!a.last_at || !b.last_at) return 0;
  return new Date(b.last_at).getTime() - new Date(a.last_at).getTime();
}

function rowKey(it: InboxItem): string {
  return it.kind === "club" ? `chapter:${it.chapter_id}` : `dm:${it.user_id}`;
}

export default function Chat() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({}); // rowKey → name
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowRefs = useRef<Record<string, Swipeable | null>>({}); // one open swipe at a time
  const openKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const list = await inbox(token);
    setItems(list);
    setUnreadTotal(sumUnread(list));
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

      // Realtime: typing flips the row preview; any message refreshes the list.
      ensureConnected(getAccessToken);
      const unsub = subscribe((e: RTEvent) => {
        if (!active) return;
        const key = `${e.scope}:${e.id}`;
        if (e.type === "typing") {
          setTyping((t) => ({ ...t, [key]: e.name ?? "Someone" }));
          if (typingTimers.current[key]) clearTimeout(typingTimers.current[key]);
          typingTimers.current[key] = setTimeout(() => {
            setTyping((t) => {
              const { [key]: _gone, ...rest } = t;
              return rest;
            });
          }, 3500);
        } else {
          setTyping((t) => {
            const { [key]: _gone, ...rest } = t;
            return rest;
          });
          load().catch(() => {});
        }
      });

      return () => {
        active = false;
        unsub();
        Object.values(typingTimers.current).forEach(clearTimeout);
        typingTimers.current = {};
      };
    }, [load, getAccessToken])
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

  async function setPref(it: InboxItem, prefs: { muted?: boolean; archived?: boolean }) {
    rowRefs.current[rowKey(it)]?.close();
    try {
      const token = await getAccessToken();
      if (!token) return;
      const kind = it.kind === "club" ? "club" : "direct";
      const id = it.kind === "club" ? it.chapter_id! : it.user_id!;
      await setChatPrefs(token, kind, id, prefs);
      await load();
    } catch {
      /* row stays as-is */
    }
  }

  // Active: pinned clubs then DMs. Archived: collapsed at the bottom.
  const sections = useMemo(() => {
    const all = items ?? [];
    const q = search.trim().toLowerCase();
    const match = (it: InboxItem) => !q || it.title.toLowerCase().includes(q);
    const active = all.filter((it) => !it.archived && match(it));
    return {
      clubs: active.filter((it) => it.kind === "club").sort(recency),
      directs: active.filter((it) => it.kind === "direct").sort(recency),
      archived: all.filter((it) => it.archived && match(it)).sort(recency),
    };
  }, [items, search]);

  if (!user) return <GuestChat />;

  const rows = [...sections.clubs, ...sections.directs];
  const pinnedCount = sections.clubs.length;

  function renderRow(it: InboxItem, i: number, total: number, sectionBreakAt: number) {
    const unread = it.unread > 0;
    const mineLast = !!it.last_sender_id && it.last_sender_id === user!.id;
    const typingName = typing[rowKey(it)];
    const preview = typingName
      ? it.kind === "club"
        ? `${typingName} is typing…`
        : "typing…"
      : it.last_message
        ? `${mineLast ? "You: " : ""}${it.last_message}`
        : it.kind === "club"
          ? "Club group chat"
          : "No messages yet";
    const sectionBreak = i === sectionBreakAt;

    const key = rowKey(it);
    return (
      <Swipeable
        key={key}
        overshootRight={false}
        ref={(ref) => {
          rowRefs.current[key] = ref;
        }}
        onSwipeableWillOpen={() => {
          if (openKey.current && openKey.current !== key) rowRefs.current[openKey.current]?.close();
          openKey.current = key;
        }}
        renderRightActions={() => (
          <View style={{ flexDirection: "row" }}>
            <Pressable
              onPress={() => void setPref(it, { muted: !it.muted })}
              style={{ width: 78, backgroundColor: "#64748B", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <Ionicons name={it.muted ? "notifications" : "notifications-off"} size={20} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{it.muted ? "Unmute" : "Mute"}</Text>
            </Pressable>
            <Pressable
              onPress={() => void setPref(it, { archived: !it.archived })}
              style={{ width: 78, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <Ionicons name={it.archived ? "arrow-up-circle" : "archive"} size={20} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{it.archived ? "Unarchive" : "Archive"}</Text>
            </Pressable>
          </View>
        )}
      >
        <Tap
          onPress={() => open(it)}
          haptic={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: colors.bg,
            borderBottomWidth: i === total - 1 ? 0 : sectionBreak ? 6 : 1,
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
              <Text style={{ color: unread && !it.muted ? colors.success : colors.muted, fontSize: 11, marginLeft: 8, fontWeight: unread ? "700" : "400" }}>
                {when(it.last_at)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
              <Text
                style={{
                  color: typingName ? colors.success : unread ? colors.text : colors.muted,
                  fontSize: 13,
                  fontWeight: typingName || unread ? "600" : "400",
                  fontStyle: typingName ? "italic" : "normal",
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {preview}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8 }}>
                {it.muted && <Ionicons name="notifications-off" size={13} color={colors.subtle} />}
                {it.kind === "club" && !it.archived && <Ionicons name="pin" size={13} color={colors.subtle} style={{ transform: [{ rotate: "45deg" }] }} />}
                {unread && (
                  <View style={{ backgroundColor: it.muted ? colors.bgSecondary : colors.success, borderRadius: 11, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: it.muted ? colors.muted : "#fff", fontSize: 11, fontWeight: "800" }}>{it.unread > 99 ? "99+" : it.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </Tap>
      </Swipeable>
    );
  }

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
          {rows.length === 0 && sections.archived.length === 0 ? (
            search ? (
              <View style={{ alignItems: "center", paddingVertical: 60 }}>
                <Text style={{ color: colors.muted }}>No chats match “{search.trim()}”.</Text>
              </View>
            ) : (
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
            <>
              {rows.map((it, i) => renderRow(it, i, rows.length, pinnedCount < rows.length ? pinnedCount - 1 : -1))}

              {/* Archived — collapsed at the bottom, WhatsApp style */}
              {sections.archived.length > 0 && (
                <>
                  <Tap
                    haptic={false}
                    onPress={() => setShowArchived((v) => !v)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: rows.length > 0 ? 6 : 0, borderTopColor: colors.bgSecondary }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="archive" size={18} color={colors.muted} />
                    </View>
                    <Text style={{ flex: 1, color: colors.text, fontWeight: "700", fontSize: 15 }}>Archived</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>{sections.archived.length}</Text>
                    <Ionicons name={showArchived ? "chevron-up" : "chevron-down"} size={16} color={colors.subtle} />
                  </Tap>
                  {showArchived && sections.archived.map((it, i) => renderRow(it, i, sections.archived.length, -1))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
