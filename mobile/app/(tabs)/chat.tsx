// Chat tab: the WhatsApp-style inbox — every club group you're in plus your 1:1
// direct chats, most recent first. The compose button opens people search to
// start a new DM. Tapping a row opens that conversation.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { inbox, type InboxItem } from "../../lib/messaging";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { colors, useThemeMode } from "../../lib/theme";
import { GuestChat } from "../../components/GuestScreens";

// Short, WhatsApp-ish timestamp: time if today, else a day/month.
function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function Chat() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (token) setItems(await inbox(token));
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

  if (!user) return <GuestChat />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>Chats</Text>
        <Tap onPress={() => router.push("/thread/new")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Tap>
      </View>

      {items === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {items.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, paddingHorizontal: 32 }}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.subtle} />
              <Text style={{ color: colors.muted, marginTop: 12, textAlign: "center" }}>
                No chats yet. Join a club for its group chat, or start a direct message with the compose button.
              </Text>
            </View>
          ) : (
            items.map((it, i) => (
              <Tap
                key={`${it.kind}-${it.chapter_id ?? it.user_id ?? i}`}
                onPress={() => open(it)}
                haptic={false}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
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
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16, flex: 1 }} numberOfLines={1}>{it.title}</Text>
                    <Text style={{ color: it.unread > 0 ? colors.success : colors.muted, fontSize: 11, marginLeft: 8, fontWeight: it.unread > 0 ? "700" : "400" }}>{when(it.last_at)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                    <Text style={{ color: it.unread > 0 ? colors.text : colors.muted, fontSize: 13, fontWeight: it.unread > 0 ? "600" : "400", flex: 1 }} numberOfLines={1}>
                      {it.last_message ?? (it.kind === "club" ? "Club group chat" : "No messages yet")}
                    </Text>
                    {it.unread > 0 && (
                      <View style={{ backgroundColor: colors.success, borderRadius: 11, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", marginLeft: 8 }}>
                        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{it.unread > 99 ? "99+" : it.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Tap>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
