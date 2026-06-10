// ChatThread: the reusable conversation UI (header + messages + composer),
// shared by the club group chat and 1:1 direct chats. WhatsApp-style:
// - attachments: photo library, camera, or document (pdf/doc), with a caption
// - optimistic send: your message shows instantly with a clock, then a tick
// - read receipts: single grey (sent) → blue double (read) for DMs
// - date separators, consecutive-sender grouping, fullscreen image viewer
// - long-press a message to copy text or delete your own
// Delivery is pull-on-open: it loads on focus and polls every 4s while focused.

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
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError } from "../lib/api";
import { type Message, type OutMsg } from "../lib/messaging";
import { Avatar } from "./Avatar";
import { colors, styles } from "../lib/theme";

type Staged ={ uri: string; kind: "image" | "file"; name?: string; mime?: string };
type Pending = { tempId: string; body?: string; localUri?: string; kind?: "image" | "file"; name?: string; failed?: boolean };

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
  canAnnounce?: boolean;
  announce?: (body: string) => Promise<void>;
  onSenderPress?: (senderId: string, senderName: string) => void;
};

export function ChatThread({
  title, subtitle, avatarName, avatarUri, meId, isGroup, isDirect, otherLastReadAt,
  load, send, uploadImage, uploadFile, deleteMessage, canAnnounce, announce, onSenderPress,
}: Props) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const countRef = useRef(0);
  const seq = useRef(0);
  const nearBottom = useRef(true); // is the user at (or near) the latest message?
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [announceMode, setAnnounceMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false); // scroll-to-bottom FAB
  const [newBelow, setNewBelow] = useState(0); // messages arrived while scrolled up

  const scrollEnd = (animated: boolean) => setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 50);

  // Reading history shouldn't be yanked to the bottom by the 4s poll: new
  // messages only autoscroll when the user is already near the bottom —
  // otherwise the jump FAB shows how many are waiting (WhatsApp behaviour).
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
      const timer = setInterval(() => active && reload(false).catch(() => {}), 4000);
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
    const cap = staged; // capture
    const isAnnounce = announceMode && !!announce && !cap;
    const tempId = `tmp-${seq.current++}`;

    // Optimistic: show immediately, clear the composer.
    setPending((p) => [...p, { tempId, body: body || undefined, localUri: cap?.uri, kind: cap?.kind, name: cap?.name }]);
    setText("");
    setStaged(null);
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
        await send({ body: body || undefined, media_url: mediaUrl, media_type: mediaType });
      }
      // Reconcile: pull server truth and drop the temp in one render (no flicker).
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

  function onLongPress(m: Message) {
    const mine = m.sender_id === meId;
    const buttons: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [];
    if (m.body) buttons.push({ text: "Copy", onPress: () => Clipboard.setStringAsync(m.body!) });
    if (mine && deleteMessage) {
      buttons.push({
        text: "Delete",
        style: "destructive",
        onPress: () =>
          deleteMessage(m.id)
            .then(() => reload(false))
            .catch((e) => Alert.alert("Couldn't delete", e instanceof ApiError ? e.message : "Something went wrong")),
      });
    }
    if (!buttons.length) return;
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("", "", buttons, { cancelable: true });
  }

  // bubble: a WhatsApp-style message bubble shared by real + pending messages.
  // The time + status (tick / clock) sit INSIDE the bubble, bottom-right.
  function bubble(
    mine: boolean,
    opts: { body?: string | null; mediaUrl?: string | null; localUri?: string; mediaType?: string | null; kind?: string; name?: string },
    time: string,
    status?: "sent" | "read" | "sending" | "failed"
  ) {
    const imgUri = opts.mediaUrl ?? opts.localUri;
    const isImage = !!((opts.mediaType === "image" || opts.kind === "image") && imgUri);
    const isFile = opts.mediaType === "file" || opts.kind === "file";
    const fg = mine ? "#fff" : colors.text;
    const footFg = mine ? "rgba(255,255,255,0.72)" : colors.muted;
    const icon: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
      read: { name: "checkmark-done", color: "#fff" },
      sent: { name: "checkmark", color: footFg },
      sending: { name: "time-outline", color: footFg },
      failed: { name: "alert-circle", color: "#FCA5A5" },
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
          shadowOpacity: mine ? 0 : 0.05,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
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
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: mine ? "rgba(255,255,255,0.2)" : colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="document-text" size={20} color={mine ? "#fff" : colors.primary} />
            </View>
            <Text style={{ color: fg, fontWeight: "600", maxWidth: 150 }} numberOfLines={1}>{opts.name ?? "Document"}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-end", paddingHorizontal: 9, paddingTop: isImage || isFile ? 2 : 6, paddingBottom: 5 }}>
          {opts.body ? <Text style={{ color: fg, fontSize: 15, flexShrink: 1, marginRight: 8 }}>{opts.body}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto" }}>
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
                      <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", marginTop: showName ? 8 : 2 }}>
                        {showName && (
                          <Pressable onPress={() => onSenderPress?.(m.sender_id, m.sender_name)} disabled={!onSenderPress}>
                            <Text style={{ color: colors.accent, fontSize: 12, marginLeft: 10, marginBottom: 2, fontWeight: "700" }}>{m.sender_name}</Text>
                          </Pressable>
                        )}
                        <Pressable onLongPress={() => onLongPress(m)} delayLongPress={300}>
                          {bubble(mine, { body: m.body, mediaUrl: m.media_url, mediaType: m.media_type }, timeOf(m.created_at), mine ? (read ? "read" : "sent") : undefined)}
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            {/* Optimistic (pending) messages — always mine, shown at the bottom. */}
            {pending.map((p) => (
              <View key={p.tempId} style={{ alignSelf: "flex-end", maxWidth: "80%", marginTop: 2, opacity: p.failed ? 0.9 : 0.75 }}>
                {bubble(true, { body: p.body, localUri: p.localUri, kind: p.kind, name: p.name }, "", p.failed ? "failed" : "sending")}
              </View>
            ))}
          </ScrollView>
        )}

        {/* Jump to latest — appears when scrolled up; badges messages that
            arrived in the meantime. */}
        {showJump && messages !== null && (
          <Pressable
            onPress={() => {
              setNewBelow(0);
              scrollEnd(true);
            }}
            style={{
              position: "absolute",
              right: 14,
              bottom: 86,
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

        {/* Composer */}
        <View style={{ padding: 10, borderTopWidth: staged ? 0 : 1, borderTopColor: colors.border, gap: 8 }}>
          {canAnnounce && announce && !staged && (
            <Pressable onPress={() => setAnnounceMode((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 4 }}>
              <Ionicons name={announceMode ? "megaphone" : "megaphone-outline"} size={16} color={announceMode ? colors.primary : colors.muted} />
              <Text style={{ color: announceMode ? colors.primary : colors.muted, fontSize: 12, fontWeight: "700" }}>{announceMode ? "Announcing (pushes to all members)" : "Send as announcement"}</Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            {(uploadImage || uploadFile) && !announceMode && !staged && (
              <Pressable onPress={() => setAttachMenu(true)} hitSlop={6} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="add-circle-outline" size={26} color={colors.muted} />
              </Pressable>
            )}
            <TextInput
              style={[styles.input, { flex: 1, maxHeight: 110 }]}
              placeholder={announceMode ? "Announcement…" : staged ? "Add a caption…" : "Message"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable onPress={onSend} disabled={!text.trim() && !staged} style={{ backgroundColor: text.trim() || staged ? colors.primary : colors.bgSecondary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="send" size={18} color={text.trim() || staged ? "#fff" : colors.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Attachment menu — an inline overlay (NOT a Modal): launching the native
          photo/document picker from inside a dismissing Modal crashes on iOS. */}
      {attachMenu && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setAttachMenu(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 34, gap: 6 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 }} />
            {[
              { icon: "image" as const, label: "Photo library", onPress: pickLibrary, show: !!uploadImage },
              { icon: "camera" as const, label: "Camera", onPress: pickCamera, show: !!uploadImage },
              { icon: "document" as const, label: "Document", onPress: pickDocument, show: !!uploadFile },
            ].filter((o) => o.show).map((o) => (
              <Pressable key={o.label} onPress={o.onPress} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={o.icon} size={20} color={colors.primary} />
                </View>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>{o.label}</Text>
              </Pressable>
            ))}
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
