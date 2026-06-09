// ChatThread: the reusable conversation UI (header + message list + composer),
// shared by the club group chat and 1:1 direct chats. The screen supplies the
// data via load()/send(); ChatThread owns the messages, refresh, scroll, and
// (for club admins) the announcement toggle.

import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError } from "../lib/api";
import { type Message } from "../lib/messaging";
import { Avatar } from "./Avatar";
import { colors, styles } from "../lib/theme";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Props = {
  title: string;
  subtitle?: string;
  avatarName: string;
  avatarUri?: string | null;
  meId: string;
  load: () => Promise<Message[]>;
  send: (body: string) => Promise<void>;
  canAnnounce?: boolean;
  announce?: (body: string) => Promise<void>;
  onSenderPress?: (senderId: string, senderName: string) => void;
  onAvatarPress?: () => void;
};

export function ChatThread({ title, subtitle, avatarName, avatarUri, meId, load, send, canAnnounce, announce, onSenderPress, onAvatarPress }: Props) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [announceMode, setAnnounceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const msgs = await load();
    setMessages(msgs);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const msgs = await load();
          if (active) {
            setMessages(msgs);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
          }
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
      await refresh();
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  async function onSend() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      if (announceMode && announce) await announce(body);
      else await send(body);
      setText("");
      setAnnounceMode(false);
      await refresh();
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
          <Pressable onPress={onAvatarPress} disabled={!onAvatarPress} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
            <Avatar name={avatarName} uri={avatarUri} size={38} bg={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{title}</Text>
              {subtitle ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
          </Pressable>
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
              <View style={{ alignItems: "center", paddingVertical: 44 }}>
                <Ionicons name="chatbubbles-outline" size={32} color={colors.subtle} />
                <Text style={{ color: colors.muted, marginTop: 8 }}>No messages yet. Say hello 👋</Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === meId;
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
                    {!mine && (
                      <Pressable onPress={() => onSenderPress?.(m.sender_id, m.sender_name)} disabled={!onSenderPress}>
                        <Text style={{ color: colors.accent, fontSize: 11, marginLeft: 10, marginBottom: 2, fontWeight: "600" }}>{m.sender_name}</Text>
                      </Pressable>
                    )}
                    <View style={{ backgroundColor: mine ? colors.primary : colors.bg, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                      {m.media_url ? <Image source={{ uri: m.media_url }} style={{ width: 200, height: 200, borderRadius: 10, marginBottom: m.body ? 6 : 0 }} resizeMode="cover" /> : null}
                      {m.body ? <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 14 }}>{m.body}</Text> : null}
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
          {canAnnounce && announce && (
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
            <Pressable onPress={onSend} disabled={sending || !text.trim()} style={{ backgroundColor: text.trim() ? colors.primary : colors.bgSecondary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color={text.trim() ? "#fff" : colors.muted} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
