// MessageToast — the interactive in-app message banner (iMessage/WhatsApp
// style). While the app is open, any new chat message arriving over the
// realtime socket slides a banner down from the top: sender avatar, name,
// preview, a Group/Direct tag. Tap → jump straight into that thread; swipe up
// or wait and it glides away. The thread currently on screen never banners
// (lib/messageToast.activeThread), and your own messages never do.
//
// Mounted once at the root layout, for logged-in users only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useAuth } from "../lib/auth";
import { ensureConnected, subscribe, type RTEvent } from "../lib/realtime";
import { getActiveThread } from "../lib/messageToast";
import { refreshUnread } from "../lib/unread";
import { Avatar } from "./Avatar";
import { colors } from "../lib/theme";

type Toast = {
  key: string; // thread key — also the navigation target
  scope: "chapter" | "dm";
  id: string;
  sender: string;
  preview: string;
};

const SHOW_MS = 4500;

function previewOf(e: RTEvent): string {
  const m = e.payload;
  if (!m) return "New message";
  if (m.body) return m.body;
  if (m.media_type === "image") return "📷 Photo";
  if (m.media_type === "audio") return "🎤 Voice note";
  if (m.media_type) return "📎 File";
  return "New message";
}

export function MessageToast() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const slide = useRef(new Animated.Value(-140)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<Toast | null>(null);
  toastRef.current = toast;

  const dismiss = useCallback(
    (animated = true) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (!animated) {
        slide.setValue(-140);
        setToast(null);
        return;
      }
      Animated.timing(slide, { toValue: -140, duration: 180, useNativeDriver: true }).start(() => setToast(null));
    },
    [slide]
  );

  // Swipe up to dismiss.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -6,
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -12) dismiss();
      },
    })
  ).current;

  useEffect(() => {
    if (!user) return;
    ensureConnected(getAccessToken);
    const unsub = subscribe((e: RTEvent) => {
      if (e.type !== "message" || !e.payload) return;
      if (e.payload.sender_id === user.id) return; // own messages
      const key = `${e.scope}:${e.id}`;
      if (getActiveThread() === key) return; // already reading this thread

      refreshUnread(getAccessToken).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setToast({ key, scope: e.scope, id: e.id, sender: e.payload.sender_name, preview: previewOf(e) });
      slide.setValue(-140);
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 7 }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => dismiss(), SHOW_MS);
    });
    return () => {
      unsub();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [user, getAccessToken, slide, dismiss]);

  if (!user || !toast) return null;

  function open() {
    const t = toastRef.current;
    dismiss(false);
    if (!t) return;
    try {
      if (t.scope === "chapter") router.push(`/thread/club/${t.id}`);
      else router.push(`/thread/dm/${t.id}`);
    } catch {
      /* never crash over a banner tap */
    }
  }

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        position: "absolute",
        top: 54,
        left: 12,
        right: 12,
        zIndex: 1000,
        transform: [{ translateY: slide }],
      }}
    >
      <Pressable
        onPress={open}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: colors.bg,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: "#0B1220",
          shadowOpacity: 0.22,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        <Avatar name={toast.sender} size={42} bg={toast.scope === "chapter" ? colors.primary : colors.accent} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
              {toast.sender}
            </Text>
            <View style={{ backgroundColor: colors.bgSecondary, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800" }}>
                {toast.scope === "chapter" ? "CLUB" : "DIRECT"}
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
            {toast.preview}
          </Text>
        </View>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="arrow-undo" size={16} color={colors.primary} />
        </View>
      </Pressable>
    </Animated.View>
  );
}
