// Settings screen: account, appearance (light/dark), and other preferences.
// Reached from the settings icon on the Profile tab (pushed over the tabs, not a
// tab itself). Calling useThemeMode() subscribes it so a theme toggle re-themes
// it instantly.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

import { useAuth } from "../lib/auth";
import { ApiError, request } from "../lib/api";
import { getGamification, setBadgeAnnounce } from "../lib/gamification";
import { stravaStatus, stravaSync, stravaDisconnect, connectStrava, type StravaStatus } from "../lib/integrations";
import { colors, styles, useThemeMode, type ThemeMode } from "../lib/theme";
import { runningLevelLabel } from "../lib/profile";
import { Avatar } from "../components/Avatar";

// Where tester feedback is sent. Change to a support address when you have one.
const FEEDBACK_EMAIL = "chourasiaavinash80@gmail.com";

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, opacity: disabled ? 0.5 : 1 }}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.muted} />
      <Text style={{ flex: 1, color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      {value ? <Text style={{ color: colors.muted, fontSize: 13 }}>{value}</Text> : null}
      {onPress && !disabled ? <Ionicons name="chevron-forward" size={18} color={colors.subtle} /> : null}
      {disabled ? <Text style={{ color: colors.subtle, fontSize: 12 }}>Soon</Text> : null}
    </Pressable>
  );
}

const APPEARANCE: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
];

// DetailRow: one read-only profile fact (label left, value right).
function DetailRow({ label, value, last }: { label: string; value?: string | number | null; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </Text>
    </View>
  );
}

// BadgeAnnounceToggle: whether badge unlocks auto-post to your club chats.
// Optimistic flip with revert on failure; state loads lazily from the API.
function BadgeAnnounceToggle() {
  const { getAccessToken } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const p = await getGamification(token);
        if (active) setEnabled(p.announce_badges);
      } catch {
        if (active) setEnabled(true); // default-on; the PUT is the source of truth
      }
    })();
    return () => {
      active = false;
    };
  }, [getAccessToken]);

  async function flip(next: boolean) {
    setEnabled(next);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no token");
      await setBadgeAnnounce(token, next);
    } catch {
      setEnabled(!next); // revert — the server didn't take it
    }
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <Ionicons name="trophy-outline" size={20} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>Share badges in club chat</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Celebrate unlocks with your clubs automatically</Text>
      </View>
      <Switch
        value={enabled ?? true}
        disabled={enabled === null}
        onValueChange={flip}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

// StravaCard — connect Strava so your Strava runs auto-count toward challenges,
// leaderboards and badges. Hidden entirely when the backend isn't configured.
function StravaCard({ getToken }: { getToken: () => Promise<string | null> }) {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (token) setStatus(await stravaStatus(token));
    } catch {
      /* leave as-is */
    }
  }, [getToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onConnect() {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const outcome = await connectStrava(token);
      if (outcome === "connected") {
        const { imported } = await stravaSync(token).catch(() => ({ imported: 0 }));
        await refresh();
        Alert.alert("Strava connected 🟠", imported > 0 ? `Imported ${imported} recent run${imported === 1 ? "" : "s"} — they now count toward your challenges.` : "We'll import your runs automatically from here.");
      } else if (outcome === "failed") {
        Alert.alert("Couldn't connect", "Strava didn't complete the link. Please try again.");
      } else {
        Alert.alert("Cancelled", "No problem — connect Strava whenever you're ready.");
      }
    } catch (e) {
      Alert.alert("Couldn't connect", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onSync() {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const { imported } = await stravaSync(token);
      await refresh();
      Alert.alert("Synced", imported > 0 ? `Imported ${imported} new run${imported === 1 ? "" : "s"}.` : "You're all caught up — no new runs.");
    } catch (e) {
      Alert.alert("Sync failed", e instanceof ApiError ? e.message : "Try again in a moment");
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    Alert.alert("Disconnect Strava?", "New runs will stop importing. Runs already imported stay.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const token = await getToken();
            if (token) await stravaDisconnect(token);
            await refresh();
          } catch (e) {
            Alert.alert("Couldn't disconnect", e instanceof ApiError ? e.message : "Try again in a moment");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  // Dormant on the backend → don't show the feature at all.
  if (!status || !status.configured) return null;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Ionicons name="sync-circle" size={20} color="#FC4C02" />
        <Text style={styles.sectionTitle}>Sync from Strava</Text>
      </View>
      {status.connected ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
            <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>Connected</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {status.last_synced_at ? `synced ${new Date(status.last_synced_at).toLocaleDateString([], { day: "numeric", month: "short" })}` : "not synced yet"}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 8 }}>
            Your Strava runs import automatically and count toward challenges, leaderboards & badges.
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={onSync} disabled={busy} style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, backgroundColor: colors.primary, opacity: busy ? 0.6 : 1, borderRadius: 999, paddingVertical: 11 }}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="refresh" size={15} color="#fff" /><Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Sync now</Text></>}
            </Pressable>
            <Pressable onPress={onDisconnect} disabled={busy} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 }}>
              <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 13 }}>Disconnect</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
            Run with Strava? Connect once and your runs count here automatically — no need to re-record in ClubMitra.
          </Text>
          <Pressable onPress={onConnect} disabled={busy} style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, backgroundColor: "#FC4C02", opacity: busy ? 0.6 : 1, borderRadius: 999, paddingVertical: 13 }}>
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="logo-electron" size={16} color="#fff" /><Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Connect Strava</Text></>}
          </Pressable>
        </>
      )}
    </View>
  );
}

function AppearanceToggle() {
  const { mode, setMode } = useThemeMode();
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 4, gap: 4 }}>
      {APPEARANCE.map((o) => {
        const on = mode === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => setMode(o.key)}
            style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 11, borderRadius: 9, backgroundColor: on ? colors.bg : "transparent" }}
          >
            <Ionicons name={o.icon} size={16} color={on ? colors.primary : colors.muted} />
            <Text style={{ color: on ? colors.text : colors.muted, fontWeight: "700", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const { user, logout, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe so this screen re-themes instantly on toggle
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Version info — helps testers report which app + backend they're on.
  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  const buildTag = Updates.updateId ? Updates.updateId.slice(0, 8) : "base";
  const [backend, setBackend] = useState("…");
  useEffect(() => {
    request<{ version: string; commit: string }>("/version")
      .then((v) => setBackend(`v${v.version} · ${v.commit}`))
      .catch(() => setBackend("unreachable"));
  }, []);

  function sendFeedback() {
    const body = `\n\n\n— — —\nApp: ClubMitra v${appVersion} (${buildTag})\nPlatform: ${Platform.OS}\nBackend: ${backend}\nUser: ${user?.email ?? ""}`;
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("ClubMitra feedback")}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {});
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Settings</Text>
        </View>

        {/* Account — tap to reveal read-only profile details (editing lives on
            the Profile tab's pencil icon, so settings stays one-purpose). */}
        <View style={styles.card}>
          <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>Account</Text>
          <Pressable onPress={() => setDetailsOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar name={user.name} uri={user.profile_photo} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{user.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{user.email}</Text>
            </View>
            <Ionicons name={detailsOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.subtle} />
          </Pressable>
          {detailsOpen && (
            <View style={{ marginTop: 8 }}>
              <DetailRow label="Phone" value={user.phone} />
              <DetailRow label="Age" value={user.age} />
              <DetailRow label="City" value={user.city} />
              <DetailRow label="Running level" value={runningLevelLabel(user.running_level)} />
              <DetailRow label="T-shirt size" value={user.tshirt_size} last />
            </View>
          )}
        </View>

        {/* Connected apps — Strava sync */}
        <StravaCard getToken={getAccessToken} />

        {/* Appearance */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Ionicons name="contrast" size={18} color={colors.text} />
            <Text style={styles.sectionTitle}>Appearance</Text>
          </View>
          <AppearanceToggle />
        </View>

        {/* Preferences */}
        <View style={styles.card}>
          <Text style={[styles.sectionTitle, { marginBottom: 4 }]}>Preferences</Text>
          <BadgeAnnounceToggle />
          <Row icon="notifications-outline" label="Notifications" disabled />
          <Row icon="lock-closed-outline" label="Privacy" disabled />
          <Row icon="chatbubble-ellipses-outline" label="Send feedback" onPress={sendFeedback} />
          <Row icon="information-circle-outline" label="App version" value={`v${appVersion} · ${buildTag}`} />
          <Row icon="server-outline" label="Backend" value={backend} />
        </View>

        {/* Logout */}
        <Pressable
          onPress={logout}
          style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
        >
          <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 15 }}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
