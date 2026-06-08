// Club chat (chapter group conversation). Members read + post; admins can flip
// a message into an announcement (which also pushes to everyone). Pull-on-open:
// loads on focus, on pull-to-refresh, and after sending.

import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { chapterMessages, postChapter, announce, type Message } from "../../../lib/messaging";
import { isChapterAdmin, myChapters } from "../../../lib/clubs";
import { colors, styles } from "../../../lib/theme";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ClubChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [text, setText] = useState("");
  const [announceMode, setAnnounceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const [msgs, mine] = await Promise.all([chapterMessages(token, id), myChapters(token)]);
    setMessages(msgs);
    setIsAdmin(isChapterAdmin(mine.find((c) => c.id === id)?.role));
  }, [getAccessToken, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load();
          if (active) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
        } catch {
          if (active) setMessages([]);
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

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const token = await getAccessToken();
      if (announceMode) await announce(token!, id, body);
      else await postChapter(token!, id, body);
      setText("");
      setAnnounceMode(false);
      await load();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.accent} />
          </Pressable>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>Club chat</Text>
        </View>

        {messages === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <Ionicons name="chatbubbles-outline" size={32} color={colors.subtle} />
                <Text style={{ color: colors.muted, marginTop: 8 }}>No messages yet. Say hello 👋</Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === user?.id;
                if (m.is_announcement) {
                  return (
                    <View key={m.id} style={{ backgroundColor: colors.primarySoft, borderRadius: 14, padding: 12, borderLeftWidth: 3, borderLeftColor: colors.primary }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Ionicons name="megaphone" size={14} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12 }}>Announcement · {m.sender_name}</Text>
                      </View>
                      <Text style={{ color: colors.text, fontSize: 14 }}>{m.body}</Text>
                      <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>{timeOf(m.created_at)}</Text>
                    </View>
                  );
                }
                return (
                  <View key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                    {!mine && <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 10, marginBottom: 2 }}>{m.sender_name}</Text>}
                    <View style={{ backgroundColor: mine ? colors.primary : colors.bg, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                      <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 14 }}>{m.body}</Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2, alignSelf: mine ? "flex-end" : "flex-start", marginHorizontal: 8 }}>{timeOf(m.created_at)}</Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* Composer */}
        <View style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 }}>
          {isAdmin && (
            <Pressable onPress={() => setAnnounceMode((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 4 }}>
              <Ionicons name={announceMode ? "megaphone" : "megaphone-outline"} size={16} color={announceMode ? colors.primary : colors.muted} />
              <Text style={{ color: announceMode ? colors.primary : colors.muted, fontSize: 12, fontWeight: "700" }}>
                {announceMode ? "Announcing (pushes to all members)" : "Send as announcement"}
              </Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1, maxHeight: 110 }]}
              placeholder={announceMode ? "Announcement…" : "Message"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable onPress={send} disabled={sending || !text.trim()} style={{ backgroundColor: text.trim() ? colors.primary : colors.bgSecondary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color={text.trim() ? "#fff" : colors.muted} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
