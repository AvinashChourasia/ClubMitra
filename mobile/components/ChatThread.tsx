// ChatThread: the reusable conversation UI (header + message list + composer),
// shared by the club group chat and 1:1 direct chats. WhatsApp-style: image
// attachments, sent/read ticks, date separators, consecutive-sender grouping,
// a fullscreen image viewer, and light polling so it feels live.
//
// The screen supplies the data via load()/send(); for DMs it also passes the
// other person's last-read time so own messages can show a blue double-tick.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError } from "../lib/api";
import { type Message, type OutMsg } from "../lib/messaging";
import { Avatar } from "./Avatar";
import { colors, styles } from "../lib/theme";

const READ_BLUE = "#34B7F1";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// dayLabel for the date separators: Today / Yesterday / a date.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

type Props = {
  title: string;
  subtitle?: string;
  avatarName: string;
  avatarUri?: string | null;
  meId: string;
  isGroup?: boolean; // show sender names + grouping
  isDirect?: boolean; // enables read receipts
  otherLastReadAt?: string | null;
  load: () => Promise<Message[]>;
  send: (msg: OutMsg) => Promise<void>;
  uploadImage?: (localUri: string) => Promise<string>; // enables the attach button
  canAnnounce?: boolean;
  announce?: (body: string) => Promise<void>;
  onSenderPress?: (senderId: string, senderName: string) => void;
};

export function ChatThread({
  title, subtitle, avatarName, avatarUri, meId, isGroup, isDirect, otherLastReadAt,
  load, send, uploadImage, canAnnounce, announce, onSenderPress,
}: Props) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const countRef = useRef(0);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [announceMode, setAnnounceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  // applyMessages updates state and scrolls to the bottom only when new messages
  // arrived (so a background poll doesn't yank a user reading older messages).
  const applyMessages = useCallback((msgs: Message[], forceScroll: boolean) => {
    const grew = msgs.length > countRef.current;
    countRef.current = msgs.length;
    setMessages(msgs);
    if (forceScroll || grew) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: forceScroll }), 50);
  }, []);

  const reload = useCallback(
    async (forceScroll: boolean) => {
      const msgs = await load();
      applyMessages(msgs, forceScroll);
    },
    [load, applyMessages]
  );

  // Load on focus, then poll every 4s while the screen is focused (pull-on-open
  // delivery — keeps incoming messages + read ticks feeling live).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      countRef.current = 0;
      (async () => {
        try {
          await reload(true);
        } catch {
          if (active) setMessages([]);
        }
      })();
      const timer = setInterval(() => {
        if (active) reload(false).catch(() => {});
      }, 4000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [reload])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await reload(false);
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
      else await send({ body });
      setText("");
      setAnnounceMode(false);
      await reload(true);
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  async function onAttach() {
    if (!uploadImage) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access needed",
        perm.canAskAgain ? "ClubMitra needs access to your photos to attach an image." : "Enable photo access in Settings to attach images.",
        perm.canAskAgain ? [{ text: "OK" }] : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 }); // images (the default)
    if (result.canceled) return;
    setUploading(true);
    try {
      const url = await uploadImage(result.assets[0].uri);
      await send({ media_url: url, media_type: "image" });
      await reload(true);
    } catch (e) {
      Alert.alert("Couldn't send image", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setUploading(false);
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
          <Avatar name={avatarName} uri={avatarUri} size={38} bg={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>

        {messages === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 12, gap: 2 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 44 }}>
                <Ionicons name="chatbubbles-outline" size={32} color={colors.subtle} />
                <Text style={{ color: colors.muted, marginTop: 8 }}>No messages yet. Say hello 👋</Text>
              </View>
            ) : (
              messages.map((m, i) => {
                const prev = i > 0 ? messages[i - 1] : null;
                const showDate = !prev || !sameDay(prev.created_at, m.created_at);
                const mine = m.sender_id === meId;
                const showName = !!isGroup && !mine && (showDate || !prev || prev.sender_id !== m.sender_id);
                const read = isDirect && mine && !!otherLastReadAt && new Date(m.created_at).getTime() <= new Date(otherLastReadAt).getTime();

                return (
                  <View key={m.id}>
                    {showDate && (
                      <View style={{ alignItems: "center", marginVertical: 10 }}>
                        <Text style={{ backgroundColor: colors.bg, color: colors.muted, fontSize: 11, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                          {dayLabel(m.created_at)}
                        </Text>
                      </View>
                    )}

                    {m.is_announcement ? (
                      <View style={{ backgroundColor: colors.primarySoft, borderRadius: 14, padding: 12, marginVertical: 4, borderLeftWidth: 3, borderLeftColor: colors.primary }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <Ionicons name="megaphone" size={14} color={colors.primary} />
                          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12 }}>Announcement · {m.sender_name}</Text>
                        </View>
                        {m.body ? <Text style={{ color: colors.text, fontSize: 14 }}>{m.body}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>{timeOf(m.created_at)}</Text>
                      </View>
                    ) : (
                      <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", marginTop: showName ? 6 : 1.5 }}>
                        {showName && (
                          <Pressable onPress={() => onSenderPress?.(m.sender_id, m.sender_name)} disabled={!onSenderPress}>
                            <Text style={{ color: colors.accent, fontSize: 11, marginLeft: 10, marginBottom: 2, fontWeight: "700" }}>{m.sender_name}</Text>
                          </Pressable>
                        )}
                        <View style={{ backgroundColor: mine ? colors.primary : colors.bg, borderRadius: 16, padding: m.media_url ? 4 : 0, paddingHorizontal: m.media_url ? 4 : 14, paddingVertical: m.media_url ? 4 : 8, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
                          {m.media_url ? (
                            <Pressable onPress={() => setViewer(m.media_url!)}>
                              <Image source={{ uri: m.media_url }} style={{ width: 210, height: 210, borderRadius: 12 }} resizeMode="cover" />
                            </Pressable>
                          ) : null}
                          {m.body ? <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 14, paddingHorizontal: m.media_url ? 8 : 0, paddingTop: m.media_url ? 6 : 0, paddingBottom: m.media_url ? 2 : 0 }}>{m.body}</Text> : null}
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: mine ? "flex-end" : "flex-start", marginTop: 2, marginHorizontal: 6 }}>
                          <Text style={{ color: colors.muted, fontSize: 10 }}>{timeOf(m.created_at)}</Text>
                          {mine && <Ionicons name={read ? "checkmark-done" : "checkmark"} size={14} color={read ? READ_BLUE : colors.muted} />}
                        </View>
                      </View>
                    )}
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
            {uploadImage && !announceMode && (
              <Pressable onPress={onAttach} disabled={uploading} hitSlop={6} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="image-outline" size={24} color={colors.muted} />}
              </Pressable>
            )}
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

      {/* Fullscreen image viewer */}
      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable onPress={() => setViewer(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" }}>
          {viewer && <Image source={{ uri: viewer }} style={{ width: Dimensions.get("window").width, height: Dimensions.get("window").height * 0.8 }} resizeMode="contain" />}
          <Pressable onPress={() => setViewer(null)} hitSlop={12} style={{ position: "absolute", top: 50, right: 20 }}>
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
