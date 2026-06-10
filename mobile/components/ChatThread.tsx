// ChatThread: the reusable conversation UI (header + messages + composer),
// shared by the club group chat and 1:1 direct chats. WhatsApp-grade:
// - realtime: new messages arrive instantly over the websocket (poll = fallback),
//   and a typing indicator shows in the header while the other side types
// - long-press a message → action sheet: react (one emoji per person), reply,
//   copy, delete-for-everyone (own messages)
// - reply-quoting with a composer bar + in-bubble quote block
// - attachments: photo library, camera, or document (pdf/doc), with a caption
// - optimistic send: your message shows instantly with a clock, then a tick
// - read receipts: single (sent) → green double (read) for DMs
// - date separators, consecutive-sender grouping, fullscreen image viewer
// - scroll-aware: polling never yanks you off history; a jump FAB counts new

import { useCallback, useRef, useState } from "react";
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
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError } from "../lib/api";
import { type Message, type OutMsg } from "../lib/messaging";
import { ensureConnected, subscribe, sendTyping, isLive, type RTEvent } from "../lib/realtime";
import { Avatar } from "./Avatar";
import { colors, styles } from "../lib/theme";

type Staged = { uri: string; kind: "image" | "file"; name?: string; mime?: string };
type Pending = { tempId: string; body?: string; localUri?: string; kind?: "image" | "file"; name?: string; failed?: boolean };

const REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "🎉"];

function timeOf(d: string): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
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
  isGroup?: boolean;
  isDirect?: boolean;
  otherLastReadAt?: string | null;
  load: () => Promise<Message[]>;
  send: (msg: OutMsg) => Promise<void>;
  uploadImage?: (localUri: string) => Promise<string>;
  uploadFile?: (localUri: string, name: string, mime: string) => Promise<string>;
  deleteMessage?: (id: string) => Promise<void>;
  react?: (id: string, emoji: string) => Promise<void>;
  edit?: (id: string, body: string) => Promise<void>;
  canAnnounce?: boolean;
  announce?: (body: string) => Promise<void>;
  onSenderPress?: (senderId: string, senderName: string) => void;
  /** Realtime scope for this conversation (instant delivery + typing). */
  realtime?: { scope: "chapter" | "dm"; id: string };
  getToken?: () => Promise<string | null>;
};

export function ChatThread({
  title, subtitle, avatarName, avatarUri, meId, isGroup, isDirect, otherLastReadAt,
  load, send, uploadImage, uploadFile, deleteMessage, react, edit, canAnnounce, announce, onSenderPress,
  realtime, getToken,
}: Props) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const countRef = useRef(0);
  const seq = useRef(0);
  const nearBottom = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef<Record<string, Swipeable | null>>({});
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [announceMode, setAnnounceMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [typingName, setTypingName] = useState<string | null>(null);

  const scrollEnd = (animated: boolean) => setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 50);

  // Reading history is never yanked to the bottom: new messages autoscroll only
  // when already near it — otherwise the jump FAB counts what's waiting.
  const reload = useCallback(
    async (forceScroll: boolean) => {
      const msgs = await load();
      const grewBy = Math.max(0, msgs.length - countRef.current);
      countRef.current = msgs.length;
      setMessages(msgs);
      if (forceScroll || (grewBy > 0 && nearBottom.current)) {
        scrollEnd(forceScroll);
      } else if (grewBy > 0) {
        setNewBelow((n) => n + grewBy);
      }
    },
    [load]
  );

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

      // Realtime: instant delivery + typing for THIS conversation.
      let unsub: (() => void) | undefined;
      if (realtime && getToken) {
        ensureConnected(getToken);
        unsub = subscribe((e: RTEvent) => {
          if (!active || e.scope !== realtime.scope || e.id !== realtime.id) return;
          if (e.type === "message" || e.type === "update") {
            if (e.user_id !== meId) setTypingName(null);
            reload(false).catch(() => {});
          } else if (e.type === "typing" && e.user_id !== meId) {
            setTypingName(e.name ?? "Someone");
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setTypingName(null), 3500);
          }
        });
      }

      // Poll fallback: slow when the socket is live, snappy when it isn't.
      const timer = setInterval(() => {
        if (!active) return;
        reload(false).catch(() => {});
      }, realtime && isLive() ? 20000 : 4000);

      return () => {
        active = false;
        clearInterval(timer);
        unsub?.();
        if (typingTimer.current) clearTimeout(typingTimer.current);
      };
    }, [reload, realtime, getToken, meId])
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

  // --- attachments ---
  async function pickLibrary() {
    setAttachMenu(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return permAlert(perm.canAskAgain, "photos");
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!r.canceled) setStaged({ uri: r.assets[0].uri, kind: "image" });
  }
  async function pickCamera() {
    setAttachMenu(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return permAlert(perm.canAskAgain, "camera");
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) setStaged({ uri: r.assets[0].uri, kind: "image" });
  }
  async function pickDocument() {
    setAttachMenu(false);
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setStaged({ uri: a.uri, kind: "file", name: a.name, mime: a.mimeType ?? "application/octet-stream" });
    }
  }
  function permAlert(canAskAgain: boolean, what: string) {
    Alert.alert(
      `${what === "camera" ? "Camera" : "Photo"} access needed`,
      canAskAgain ? `ClubMitra needs ${what} access to attach this.` : `Enable ${what} access for ClubMitra in Settings.`,
      canAskAgain ? [{ text: "OK" }] : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
    );
  }

  // --- send (optimistic) ---
  async function onSend() {
    const body = text.trim();
    if (!body && !staged) return;

    // Edit mode: apply the rewrite in place (no optimistic bubble needed).
    if (editing && edit) {
      const target = editing;
      setEditing(null);
      setText("");
      try {
        await edit(target.id, body);
        await reload(false);
      } catch (e) {
        Alert.alert("Couldn't edit", e instanceof ApiError ? e.message : "Something went wrong");
      }
      return;
    }
    const cap = staged;
    const quote = replyTo;
    const isAnnounce = announceMode && !!announce && !cap;
    const tempId = `tmp-${seq.current++}`;

    setPending((p) => [...p, { tempId, body: body || undefined, localUri: cap?.uri, kind: cap?.kind, name: cap?.name }]);
    setText("");
    setStaged(null);
    setReplyTo(null);
    setAnnounceMode(false);
    scrollEnd(true);

    try {
      if (isAnnounce) {
        await announce!(body);
      } else {
        let mediaUrl: string | undefined;
        let mediaType: string | undefined;
        if (cap?.kind === "image" && uploadImage) {
          mediaUrl = await uploadImage(cap.uri);
          mediaType = "image";
        } else if (cap?.kind === "file" && uploadFile) {
          mediaUrl = await uploadFile(cap.uri, cap.name ?? "document", cap.mime ?? "application/octet-stream");
          mediaType = "file";
        }
        await send({ body: body || undefined, media_url: mediaUrl, media_type: mediaType, reply_to_id: quote?.id });
      }
      const msgs = await load();
      countRef.current = msgs.length;
      setMessages(msgs);
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      scrollEnd(true);
    } catch (e) {
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  function onTextChange(v: string) {
    setText(v);
    if (realtime && v.length > 0) sendTyping(realtime.scope, realtime.id);
  }

  // --- message actions ---
  async function toggleReaction(m: Message, emoji: string) {
    setActionFor(null);
    if (!react) return;
    const mine = m.reactions?.find((r) => r.mine);
    try {
      await react(m.id, mine?.emoji === emoji ? "" : emoji);
      await reload(false);
    } catch (e) {
      Alert.alert("Couldn't react", e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  function doCopy(m: Message) {
    setActionFor(null);
    if (m.body) void Clipboard.setStringAsync(m.body);
  }

  function startEdit(m: Message) {
    setActionFor(null);
    setReplyTo(null);
    setStaged(null);
    setEditing(m);
    setText(m.body ?? "");
  }

  function openActions(m: Message) {
    Haptics.selectionAsync().catch(() => {});
    setActionFor(m);
  }

  function doDelete(m: Message) {
    setActionFor(null);
    deleteMessage?.(m.id)
      .then(() => reload(false))
      .catch((e) => Alert.alert("Couldn't delete", e instanceof ApiError ? e.message : "Something went wrong"));
  }

  // bubble: a WhatsApp-style message bubble shared by real + pending messages.
  function bubble(
    mine: boolean,
    opts: {
      body?: string | null;
      mediaUrl?: string | null;
      localUri?: string;
      mediaType?: string | null;
      kind?: string;
      name?: string;
      replyTo?: { sender_name: string; preview: string } | null;
      edited?: boolean;
    },
    time: string,
    status?: "sent" | "read" | "sending" | "failed"
  ) {
    const imgUri = opts.mediaUrl ?? opts.localUri;
    const isImage = !!((opts.mediaType === "image" || opts.kind === "image") && imgUri);
    const isFile = opts.mediaType === "file" || opts.kind === "file";
    const fg = mine ? colors.bubbleMineText : colors.text;
    const footFg = mine ? colors.bubbleMineText + "B3" : colors.muted; // ~70% alpha
    const icon: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
      read: { name: "checkmark-done", color: colors.success },
      sent: { name: "checkmark", color: footFg },
      sending: { name: "time-outline", color: footFg },
      failed: { name: "alert-circle", color: colors.danger },
    };
    return (
      <View
        style={{
          backgroundColor: mine ? colors.bubbleMine : colors.bg,
          borderRadius: 18,
          borderTopRightRadius: mine ? 5 : 18,
          borderTopLeftRadius: mine ? 18 : 5,
          padding: 3,
          borderWidth: mine ? 0 : 1,
          borderColor: colors.border,
          shadowColor: "#0B1220",
          shadowOpacity: 0.05,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        {/* Quoted message (reply) */}
        {opts.replyTo && (
          <View
            style={{
              borderLeftWidth: 3,
              borderLeftColor: mine ? colors.bubbleMineText + "99" : colors.primary,
              backgroundColor: mine ? colors.bubbleMineText + "1A" : colors.bgSecondary,
              borderRadius: 10,
              paddingHorizontal: 9,
              paddingVertical: 6,
              margin: 4,
              marginBottom: 2,
            }}
          >
            <Text style={{ color: mine ? colors.bubbleMineText : colors.primary, fontWeight: "800", fontSize: 11 }} numberOfLines={1}>
              {opts.replyTo.sender_name}
            </Text>
            <Text style={{ color: footFg, fontSize: 12 }} numberOfLines={1}>{opts.replyTo.preview}</Text>
          </View>
        )}
        {isImage ? (
          <Pressable onPress={() => opts.mediaUrl && setViewer(opts.mediaUrl)}>
            <Image source={{ uri: imgUri! }} style={{ width: 216, height: 216, borderRadius: 15 }} resizeMode="cover" />
          </Pressable>
        ) : null}
        {isFile ? (
          <Pressable
            onPress={() => opts.mediaUrl && Linking.openURL(opts.mediaUrl)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: mine ? colors.bubbleMineText + "26" : colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="document-text" size={20} color={mine ? colors.bubbleMineText : colors.primary} />
            </View>
            <Text style={{ color: fg, fontWeight: "600", maxWidth: 150 }} numberOfLines={1}>{opts.name ?? "Document"}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-end", paddingHorizontal: 9, paddingTop: isImage || isFile ? 2 : 6, paddingBottom: 5 }}>
          {opts.body ? <Text style={{ color: fg, fontSize: 15, flexShrink: 1, marginRight: 8 }}>{opts.body}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto" }}>
            {opts.edited ? <Text style={{ color: footFg, fontSize: 10, fontStyle: "italic" }}>edited · </Text> : null}
            <Text style={{ color: footFg, fontSize: 10 }}>{time}</Text>
            {status ? <Ionicons name={icon[status].name} size={13} color={icon[status].color} /> : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        {/* Header — subtitle becomes the live typing line when someone types */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
          <Avatar name={avatarName} uri={avatarUri} size={38} bg={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{title}</Text>
            {typingName ? (
              <Text style={{ color: colors.success, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                {isGroup ? `${typingName} is typing…` : "typing…"}
              </Text>
            ) : subtitle ? (
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
            ) : null}
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
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              const fromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
              const near = fromBottom < 140;
              nearBottom.current = near;
              setShowJump(!near);
              if (near) setNewBelow(0);
            }}
            scrollEventThrottle={100}
          >
            {messages.length === 0 && pending.length === 0 ? (
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
                const hasReactions = !!m.reactions?.length;
                return (
                  <View key={m.id}>
                    {showDate && (
                      <View style={{ alignItems: "center", marginVertical: 10 }}>
                        <Text style={{ backgroundColor: colors.bg, color: colors.muted, fontSize: 11, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>{dayLabel(m.created_at)}</Text>
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
                      <Swipeable
                        friction={2}
                        leftThreshold={42}
                        overshootLeft={false}
                        renderLeftActions={() => (
                          <View style={{ justifyContent: "center", paddingHorizontal: 14 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
                              <Ionicons name="arrow-undo" size={16} color={colors.muted} />
                            </View>
                          </View>
                        )}
                        onSwipeableWillOpen={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setReplyTo(m);
                          setTimeout(() => swipeRefs.current[m.id]?.close(), 120);
                        }}
                        ref={(ref) => {
                          if (ref) swipeRefs.current[m.id] = ref;
                        }}
                      >
                      <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", marginTop: showName ? 8 : 2, marginBottom: hasReactions ? 12 : 0 }}>
                        {showName && (
                          <Pressable onPress={() => onSenderPress?.(m.sender_id, m.sender_name)} disabled={!onSenderPress}>
                            <Text style={{ color: colors.accent, fontSize: 12, marginLeft: 10, marginBottom: 2, fontWeight: "700" }}>{m.sender_name}</Text>
                          </Pressable>
                        )}
                        <Pressable onLongPress={() => openActions(m)} delayLongPress={250}>
                          {bubble(
                            mine,
                            { body: m.body, mediaUrl: m.media_url, mediaType: m.media_type, replyTo: m.reply_to, edited: !!m.edited_at },
                            timeOf(m.created_at),
                            mine ? (read ? "read" : "sent") : undefined
                          )}
                        </Pressable>
                        {/* Reaction chips — overlap the bubble's bottom edge */}
                        {hasReactions && (
                          <View style={{ flexDirection: "row", gap: 4, position: "absolute", bottom: -11, [mine ? "right" : "left"]: 8 }}>
                            {m.reactions!.map((r) => (
                              <Pressable
                                key={r.emoji}
                                onPress={() => toggleReaction(m, r.emoji)}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 3,
                                  backgroundColor: colors.bg,
                                  borderWidth: 1,
                                  borderColor: r.mine ? colors.accent : colors.border,
                                  borderRadius: 11,
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                }}
                              >
                                <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
                                {r.count > 1 && <Text style={{ fontSize: 10, fontWeight: "800", color: colors.muted }}>{r.count}</Text>}
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                      </Swipeable>
                    )}
                  </View>
                );
              })
            )}

            {/* Optimistic (pending) messages — always mine, shown at the bottom. */}
            {pending.map((p) => (
              <View key={p.tempId} style={{ alignSelf: "flex-end", maxWidth: "80%", marginTop: 2, opacity: p.failed ? 0.9 : 0.75 }}>
                {bubble(true, { body: p.body, localUri: p.localUri, kind: p.kind, name: p.name, replyTo: replyTo ? { sender_name: replyTo.sender_name, preview: replyTo.body ?? "…" } : null }, "", p.failed ? "failed" : "sending")}
              </View>
            ))}
          </ScrollView>
        )}

        {/* Jump to latest — appears when scrolled up; counts what arrived. */}
        {showJump && messages !== null && (
          <Pressable
            onPress={() => {
              setNewBelow(0);
              scrollEnd(true);
            }}
            style={{
              position: "absolute",
              right: 14,
              bottom: 92,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.bg,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#0B1220",
              shadowOpacity: 0.15,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 4,
            }}
            hitSlop={8}
          >
            <Ionicons name="chevron-down" size={22} color={colors.text} />
            {newBelow > 0 && (
              <View style={{ position: "absolute", top: -6, right: -6, backgroundColor: colors.success, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{newBelow > 99 ? "99+" : newBelow}</Text>
              </View>
            )}
          </Pressable>
        )}

        {/* Edit bar — rewriting one of your messages */}
        {editing && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
            <Ionicons name="pencil" size={16} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.accent, fontWeight: "800", fontSize: 12 }}>Editing message</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{editing.body}</Text>
            </View>
            <Pressable onPress={() => { setEditing(null); setText(""); }} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          </View>
        )}

        {/* Reply bar — what you're quoting, with a clear X */}
        {replyTo && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
            <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: colors.primary }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12 }}>
                Replying to {replyTo.sender_id === meId ? "yourself" : replyTo.sender_name}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {replyTo.body ?? (replyTo.media_type === "image" ? "📷 Photo" : "📎 File")}
              </Text>
            </View>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          </View>
        )}

        {/* Staged attachment preview */}
        {staged && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            {staged.kind === "image" ? (
              <Image source={{ uri: staged.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} />
            ) : (
              <Ionicons name="document-text" size={32} color={colors.primary} />
            )}
            <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{staged.kind === "image" ? "Photo" : staged.name ?? "Document"}</Text>
            <Pressable onPress={() => setStaged(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          </View>
        )}

        {/* Composer — pill input, circular attach + send */}
        <View style={{ padding: 10, borderTopWidth: staged || replyTo ? 0 : 1, borderTopColor: colors.border, gap: 8 }}>
          {canAnnounce && announce && !staged && (
            <Pressable onPress={() => setAnnounceMode((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 4 }}>
              <Ionicons name={announceMode ? "megaphone" : "megaphone-outline"} size={16} color={announceMode ? colors.primary : colors.muted} />
              <Text style={{ color: announceMode ? colors.primary : colors.muted, fontSize: 12, fontWeight: "700" }}>{announceMode ? "Announcing (pushes to all members)" : "Send as announcement"}</Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            {(uploadImage || uploadFile) && !announceMode && !staged && !editing && (
              <Pressable onPress={() => setAttachMenu(true)} hitSlop={6} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="add" size={24} color={colors.text} />
              </Pressable>
            )}
            <TextInput
              style={[styles.input, { flex: 1, maxHeight: 110, borderRadius: 22 }]}
              placeholder={editing ? "Edit message…" : announceMode ? "Announcement…" : staged ? "Add a caption…" : "Message"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={onTextChange}
              multiline
            />
            <Pressable onPress={onSend} disabled={!text.trim() && !staged} style={{ backgroundColor: text.trim() || staged ? colors.primary : colors.bgSecondary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={editing ? "checkmark" : "send"} size={18} color={text.trim() || staged ? "#fff" : colors.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Message action sheet — react / reply / copy / delete */}
      {actionFor && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setActionFor(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 34, gap: 4 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 }} />
            {/* What you're acting on */}
            <View style={{ backgroundColor: colors.bgSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800" }}>{actionFor.sender_id === meId ? "You" : actionFor.sender_name}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={2}>
                {actionFor.body ?? (actionFor.media_type === "image" ? "📷 Photo" : "📎 File")}
              </Text>
            </View>
            {/* Quick reactions */}
            {react && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6, paddingBottom: 12 }}>
                {REACTIONS.map((e) => {
                  const minePicked = actionFor.reactions?.some((r) => r.mine && r.emoji === e);
                  return (
                    <Pressable
                      key={e}
                      onPress={() => toggleReaction(actionFor, e)}
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 23,
                        backgroundColor: colors.bgSecondary,
                        borderWidth: minePicked ? 1.5 : 0,
                        borderColor: colors.accent,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <SheetRow icon="arrow-undo" label="Reply" onPress={() => { setReplyTo(actionFor); setActionFor(null); }} />
            {actionFor.sender_id === meId && actionFor.body && edit ? (
              <SheetRow icon="pencil" label="Edit" onPress={() => startEdit(actionFor)} />
            ) : null}
            {actionFor.body ? <SheetRow icon="copy" label="Copy" onPress={() => doCopy(actionFor)} /> : null}
            {actionFor.sender_id === meId && deleteMessage ? (
              <SheetRow icon="trash" label="Delete for everyone" danger onPress={() => doDelete(actionFor)} />
            ) : null}
          </View>
        </View>
      )}

      {/* Attachment menu — inline overlay (NOT a Modal): launching the native
          picker from inside a dismissing Modal crashes on iOS. */}
      {attachMenu && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setAttachMenu(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 34 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-evenly" }}>
              {[
                { icon: "image" as const, label: "Photos", tint: "#22C55E", onPress: pickLibrary, show: !!uploadImage },
                { icon: "camera" as const, label: "Camera", tint: "#3B82F6", onPress: pickCamera, show: !!uploadImage },
                { icon: "document" as const, label: "Document", tint: "#F59E0B", onPress: pickDocument, show: !!uploadFile },
              ].filter((o) => o.show).map((o) => (
                <Pressable key={o.label} onPress={o.onPress} style={{ alignItems: "center", gap: 8 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: o.tint + "22", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={o.icon} size={24} color={o.tint} />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}

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

// SheetRow: one action in the long-press sheet.
function SheetRow({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: danger ? "#FEE2E2" : colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={danger ? colors.danger : colors.text} />
      </View>
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
