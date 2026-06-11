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
  Animated,
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
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError } from "../lib/api";
import { inbox, postChapter, postDirect, getMessageInfo, type InboxItem, type Message, type MessageInfo, type OutMsg } from "../lib/messaging";
import { ensureConnected, subscribe, sendTyping, isLive, type RTEvent } from "../lib/realtime";
import { setActiveThread, type ThreadKey } from "../lib/messageToast";
import { Avatar } from "./Avatar";
import { colors, styles } from "../lib/theme";

type Staged = { uri: string; kind: "image" | "file"; name?: string; mime?: string };
type Pending = { tempId: string; body?: string; localUri?: string; kind?: "image" | "file" | "audio"; name?: string; failed?: boolean };

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
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [forwardTargets, setForwardTargets] = useState<InboxItem[] | null>(null);
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  const [infoData, setInfoData] = useState<MessageInfo | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const rowYs = useRef<Record<string, number>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

      // Mark this thread active: the in-app banner + foreground push skip it.
      if (realtime) setActiveThread(`${realtime.scope}:${realtime.id}` as ThreadKey);

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
        setActiveThread(null);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActionFor(m);
    overlayAnim.setValue(0);
    Animated.spring(overlayAnim, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 7 }).start();
  }

  // jumpToMessage scrolls to a quoted original and flashes it (tap the quote).
  function jumpToMessage(id: string) {
    const y = rowYs.current[id];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1300);
  }

  // openForward: pick a conversation to forward this message to.
  async function openForward(m: Message) {
    setActionFor(null);
    setForwardFor(m);
    setForwardTargets(null);
    try {
      const token = getToken ? await getToken() : null;
      if (!token) return;
      setForwardTargets((await inbox(token)).filter((c) => !c.archived));
    } catch {
      setForwardTargets([]);
    }
  }

  async function doForward(target: InboxItem) {
    const m = forwardFor;
    setForwardFor(null);
    if (!m || !getToken) return;
    try {
      const token = await getToken();
      if (!token) return;
      const out: OutMsg = {
        body: m.body ?? undefined,
        media_url: m.media_url ?? undefined,
        media_type: m.media_type ?? undefined,
      };
      if (target.kind === "club" && target.chapter_id) await postChapter(token, target.chapter_id, out);
      else if (target.kind === "direct" && target.user_id) await postDirect(token, target.user_id, out);
      Alert.alert("Forwarded ✓", `Sent to ${target.title}.`);
    } catch (e) {
      Alert.alert("Couldn't forward", e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  function doDelete(m: Message) {
    setActionFor(null);
    deleteMessage?.(m.id)
      .then(() => reload(false))
      .catch((e) => Alert.alert("Couldn't delete", e instanceof ApiError ? e.message : "Something went wrong"));
  }

  // --- voice notes ---
  async function startVoice() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Microphone needed", "Enable microphone access for ClubMitra to record voice notes.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRecordingVoice(true);
  }

  async function cancelVoice() {
    setRecordingVoice(false);
    try {
      await recorder.stop();
    } catch {
      /* never recorded */
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  }

  async function sendVoice() {
    setRecordingVoice(false);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!uri || !uploadFile) return;

    const tempId = `tmp-${seq.current++}`;
    setPending((p) => [...p, { tempId, localUri: uri!, kind: "audio" }]);
    scrollEnd(true);
    try {
      const mediaUrl = await uploadFile(uri, `voice-${Date.now()}.m4a`, "audio/m4a");
      await send({ media_url: mediaUrl, media_type: "audio" });
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

  // --- per-message info (read receipts) ---
  async function openInfo(m: Message) {
    setActionFor(null);
    setInfoFor(m);
    setInfoData(null);
    try {
      const token = getToken ? await getToken() : null;
      if (!token) return;
      setInfoData(await getMessageInfo(token, m.id));
    } catch {
      /* sheet shows a spinner-less fallback */
    }
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
      replyTo?: { id?: string; sender_name: string; preview: string } | null;
      edited?: boolean;
      onQuotePress?: () => void;
    },
    time: string,
    status?: "sent" | "read" | "sending" | "failed"
  ) {
    const imgUri = opts.mediaUrl ?? opts.localUri;
    const isImage = !!((opts.mediaType === "image" || opts.kind === "image") && imgUri);
    const isAudio = opts.mediaType === "audio" || opts.kind === "audio";
    const isFile = !isAudio && (opts.mediaType === "file" || opts.kind === "file");
    const fg = mine ? colors.bubbleMineText : colors.text;
    const footFg = mine ? colors.bubbleMineText + "B3" : colors.muted; // ~70% alpha
    const icon: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
      read: { name: "checkmark-done", color: "#38BDF8" },
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
        {/* Quoted message (reply) — tap to jump to the original */}
        {opts.replyTo && (
          <Pressable
            onPress={opts.onQuotePress}
            disabled={!opts.onQuotePress}
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
          </Pressable>
        )}
        {isImage ? (
          <Pressable onPress={() => opts.mediaUrl && setViewer(opts.mediaUrl)}>
            <Image source={{ uri: imgUri! }} style={{ width: 216, height: 216, borderRadius: 15 }} resizeMode="cover" />
          </Pressable>
        ) : null}
        {isAudio ? (
          <VoiceBubble uri={(opts.mediaUrl ?? opts.localUri)!} mine={mine} />
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
        <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-end", paddingHorizontal: 9, paddingTop: isImage || isFile || isAudio ? 2 : 6, paddingBottom: 5 }}>
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
          <View style={{ flex: 1, backgroundColor: colors.chatBg }}>
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ backgroundColor: colors.chatBg }}
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
                  <View
                    key={m.id}
                    onLayout={(e) => {
                      rowYs.current[m.id] = e.nativeEvent.layout.y;
                    }}
                    style={highlightId === m.id ? { backgroundColor: colors.accent + "26", borderRadius: 14 } : undefined}
                  >
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
                            {
                              body: m.body,
                              mediaUrl: m.media_url,
                              mediaType: m.media_type,
                              replyTo: m.reply_to,
                              edited: !!m.edited_at,
                              onQuotePress: m.reply_to ? () => jumpToMessage(m.reply_to!.id) : undefined,
                            },
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
          {recordingVoice ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={() => void cancelVoice()} hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="trash" size={19} color={colors.danger} />
              </Pressable>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.bgSecondary, borderRadius: 22, paddingHorizontal: 16, height: 44 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15, fontVariant: ["tabular-nums"] }}>
                  {fmtClock(recorderState.durationMillis ?? 0)}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Recording…</Text>
              </View>
              <Pressable onPress={() => void sendVoice()} style={{ backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="send" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : (
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
            {text.trim() || staged || editing ? (
              <Pressable onPress={onSend} style={{ backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={editing ? "checkmark" : "send"} size={18} color="#fff" />
              </Pressable>
            ) : uploadFile && !announceMode ? (
              <Pressable onPress={() => void startVoice()} style={{ backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="mic" size={19} color="#fff" />
              </Pressable>
            ) : (
              <Pressable disabled style={{ backgroundColor: colors.bgSecondary, borderRadius: 22, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="send" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Long-press overlay — WhatsApp style: dim the room, float the emoji bar
          above the focused message, and hang the action menu below it. */}
      {actionFor && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 20 }}>
          <Pressable onPress={() => setActionFor(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,12,20,0.6)" }} />
          <Animated.View
            style={{
              alignItems: actionFor.sender_id === meId ? "flex-end" : "flex-start",
              gap: 10,
              opacity: overlayAnim,
              transform: [{ scale: overlayAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
            }}
          >
            {/* Emoji pill */}
            {react && (
              <View
                style={{
                  flexDirection: "row",
                  gap: 4,
                  backgroundColor: colors.bg,
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  shadowColor: "#000",
                  shadowOpacity: 0.25,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 8,
                }}
              >
                {REACTIONS.map((e) => {
                  const minePicked = actionFor.reactions?.some((r) => r.mine && r.emoji === e);
                  return (
                    <Pressable
                      key={e}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        void toggleReaction(actionFor, e);
                      }}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: minePicked ? colors.bgSecondary : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* The focused message */}
            <View pointerEvents="none" style={{ maxWidth: "82%" }}>
              {bubble(
                actionFor.sender_id === meId,
                {
                  body: actionFor.body,
                  mediaUrl: actionFor.media_url,
                  mediaType: actionFor.media_type,
                  replyTo: actionFor.reply_to,
                  edited: !!actionFor.edited_at,
                },
                timeOf(actionFor.created_at)
              )}
            </View>

            {/* Action menu — labels left, icons right (the WhatsApp menu) */}
            <View
              style={{
                backgroundColor: colors.bg,
                borderRadius: 16,
                width: 232,
                paddingVertical: 4,
                shadowColor: "#000",
                shadowOpacity: 0.25,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
                elevation: 8,
              }}
            >
              <MenuRow label="Reply" icon="arrow-undo" onPress={() => { setReplyTo(actionFor); setActionFor(null); }} />
              {getToken ? <MenuRow label="Forward" icon="arrow-redo" onPress={() => void openForward(actionFor)} /> : null}
              {actionFor.body ? <MenuRow label="Copy" icon="copy-outline" onPress={() => doCopy(actionFor)} /> : null}
              {actionFor.sender_id === meId && actionFor.body && edit ? (
                <MenuRow label="Edit" icon="pencil" onPress={() => startEdit(actionFor)} />
              ) : null}
              {actionFor.sender_id === meId && getToken ? (
                <MenuRow label="Info" icon="information-circle-outline" onPress={() => void openInfo(actionFor)} />
              ) : null}
              {actionFor.sender_id === meId && deleteMessage ? (
                <MenuRow label="Delete" icon="trash-outline" danger last onPress={() => doDelete(actionFor)} />
              ) : null}
            </View>
          </Animated.View>
        </View>
      )}

      {/* Forward picker — choose a conversation */}
      {forwardFor && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setForwardFor(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: 420 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 }} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17, marginBottom: 10 }}>Forward to…</Text>
            {forwardTargets === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
            ) : forwardTargets.length === 0 ? (
              <Text style={{ color: colors.muted, paddingVertical: 16 }}>No conversations yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {forwardTargets.map((t) => (
                  <Pressable
                    key={`${t.kind}-${t.chapter_id ?? t.user_id}`}
                    onPress={() => void doForward(t)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }}
                  >
                    <Avatar name={t.title} uri={t.photo_url} size={42} bg={t.kind === "club" ? colors.primary : colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{t.title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{t.kind === "club" ? "Club group" : "Direct message"}</Text>
                    </View>
                    <Ionicons name="send" size={17} color={colors.primary} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* Message info — who's read it (sender-only) */}
      {infoFor && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" }}>
          <Pressable onPress={() => setInfoFor(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: 440 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 }} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>Message info</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
              Sent {new Date(infoFor.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </Text>
            {infoData === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} />
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
                  <Ionicons name="checkmark-done" size={18} color="#38BDF8" />
                  <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
                    Read by {infoData.readers.length}{isGroup ? ` of ${infoData.recipients}` : ""}
                  </Text>
                </View>
                {infoData.readers.length === 0 ? (
                  <Text style={{ color: colors.muted, paddingVertical: 8 }}>Not read yet.</Text>
                ) : (
                  <ScrollView style={{ maxHeight: 280 }}>
                    {infoData.readers.map((rd) => (
                      <View key={rd.user_id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 }}>
                        <Avatar name={rd.name} uri={rd.profile_photo} size={38} bg={colors.accent} />
                        <Text style={{ flex: 1, color: colors.text, fontWeight: "600", fontSize: 14 }} numberOfLines={1}>{rd.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {new Date(rd.read_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </>
            )}
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

// fmtClock renders milliseconds as m:ss.
function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// VoiceBubble: play/pause + progress + duration for a voice note. One player
// per bubble (expo-audio hook), streams local or remote m4a.
function VoiceBubble({ uri, mine }: { uri: string; mine: boolean }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const fg = mine ? colors.bubbleMineText : colors.text;
  const sub = mine ? colors.bubbleMineText + "B3" : colors.muted;

  const playing = status.playing;
  const duration = status.duration ?? 0;
  const current = status.currentTime ?? 0;
  const frac = duration > 0 ? Math.min(1, current / duration) : 0;

  function toggle() {
    if (playing) {
      player.pause();
    } else {
      if (status.didJustFinish || (duration > 0 && current >= duration - 0.05)) player.seekTo(0);
      player.play();
    }
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 9, width: 210 }}>
      <Pressable onPress={toggle} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: mine ? colors.bubbleMineText + "26" : colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={playing ? "pause" : "play"} size={18} color={mine ? colors.bubbleMineText : colors.primary} />
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: mine ? colors.bubbleMineText + "33" : colors.border, overflow: "hidden" }}>
          <View style={{ width: `${frac * 100}%`, height: "100%", backgroundColor: fg, borderRadius: 2 }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="mic" size={11} color={sub} />
          <Text style={{ color: sub, fontSize: 11, fontVariant: ["tabular-nums"] }}>
            {fmtClock((playing || current > 0 ? current : duration) * 1000)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// MenuRow: one row of the WhatsApp-style action menu — label left, icon right.
function MenuRow({ icon, label, onPress, danger, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.muted} />
    </Pressable>
  );
}
