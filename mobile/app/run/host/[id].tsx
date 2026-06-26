// Admin check-in host: the organiser opens check-in for a run and shows this
// screen at the start line. It displays a QR that rotates every ~30s (plus the
// same 6-digit code in big text, for anyone who'd rather type it) and a live
// "N here" counter. Members scan/enter the live code to mark themselves present;
// a rotating code means a forwarded screenshot is dead within seconds.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { getRun, openCheckin, closeCheckin, getCheckinCode, listAttendees, checkIn, type Run, type Attendee } from "../../../lib/attendance";
import { Tap } from "../../../components/Tap";
import { Avatar } from "../../../components/Avatar";
import { colors, styles } from "../../../lib/theme";

export default function CheckinHost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();

  const [run, setRun] = useState<Run | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = run?.checkin_open ?? false;

  const refreshRoster = useCallback(async () => {
    const token = await getAccessToken();
    if (token) setAttendees(await listAttendees(token, id));
  }, [getAccessToken, id]);

  // Pull the current rotating code, then schedule the next pull right as it
  // rotates (expires_in_s), so the QR is always live with minimal polling.
  const pollCode = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await getCheckinCode(token, id);
      setCode(res.code);
      if (codeTimer.current) clearTimeout(codeTimer.current);
      codeTimer.current = setTimeout(() => void pollCode(), Math.max(1, res.expires_in_s) * 1000);
    } catch {
      /* transient — the next roster poll re-arms via the open effect */
    }
  }, [getAccessToken, id]);

  // Load the run on focus.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;
          const r = await getRun(token, id);
          if (active) setRun(r);
        } catch (e) {
          if (active) setError(e instanceof ApiError ? e.message : "Couldn't load this run");
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken, id])
  );

  // While open: keep the code rotating and the roster fresh (every 4s). Pause
  // when the app is backgrounded; resume on return.
  useEffect(() => {
    if (!open) {
      if (codeTimer.current) clearTimeout(codeTimer.current);
      setCode(null);
      return;
    }
    void pollCode();
    void refreshRoster();
    const roster = setInterval(() => void refreshRoster(), 4000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void pollCode();
    });
    return () => {
      clearInterval(roster);
      sub.remove();
      if (codeTimer.current) clearTimeout(codeTimer.current);
    };
  }, [open, pollCode, refreshRoster]);

  // If the organiser leaves the screen with check-in still open, close it
  // server-side so the window doesn't linger with no host present. Refs (not deps)
  // so an unrelated re-render can't trigger a spurious close — only a real unmount.
  const openRef = useRef(open);
  openRef.current = open;
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  useEffect(() => {
    return () => {
      if (openRef.current) {
        tokenRef.current()
          .then((t) => (t ? closeCheckin(t, id) : null))
          .catch(() => {});
      }
    };
  }, [id]);

  if (!user) return <Redirect href="/login" />;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) return;
      setRun(next ? await openCheckin(token, id) : await closeCheckin(token, id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch", gap: 8 }}>
          <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} hitSlop={12} haptic={false} style={{ marginLeft: -8, padding: 6 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Tap>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }} numberOfLines={1}>{run?.title ?? "Check-in"}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Show this at the start line</Text>
          </View>
        </View>

        {error ? <Text style={{ color: colors.danger, alignSelf: "stretch" }}>{error}</Text> : null}

        {!open ? (
          <View style={[styles.card, { alignSelf: "stretch", alignItems: "center", paddingVertical: 32, gap: 14 }]}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="qr-code" size={34} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17, textAlign: "center" }}>Start check-in</Text>
            <Text style={{ color: colors.muted, textAlign: "center", fontSize: 13.5, paddingHorizontal: 12 }}>
              Members scan the rotating QR (or type the code) to mark themselves present. It can&apos;t be faked from a screenshot — the code changes every 30 seconds.
            </Text>
            <Tap onPress={() => void toggle(true)} disabled={busy} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 32, paddingVertical: 14, opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Open check-in</Text>}
            </Tap>
          </View>
        ) : (
          <>
            {/* The live QR */}
            <View style={[styles.card, { alignItems: "center", paddingVertical: 24, gap: 16, alignSelf: "stretch" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
                <Text style={{ color: colors.success, fontWeight: "800", fontSize: 12, letterSpacing: 0.6 }}>CHECK-IN OPEN</Text>
              </View>
              <View style={{ backgroundColor: "#fff", padding: 16, borderRadius: 16 }}>
                {code ? <QRCode value={`clubmitra:checkin:${id}:${code}`} size={232} /> : <View style={{ width: 232, height: 232, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View>}
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>OR ENTER CODE</Text>
                <Text style={{ color: colors.text, fontSize: 40, fontWeight: "900", letterSpacing: 8, marginTop: 2 }}>{code ?? "······"}</Text>
              </View>
            </View>

            {/* Live roster */}
            <View style={[styles.card, { alignSelf: "stretch", gap: 4 }]}>
              <Text style={styles.sectionTitle}>Here now ({attendees.length})</Text>
              {attendees.length === 0 ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>Waiting for the first scan…</Text>
              ) : (
                attendees.map((a, i) => (
                  <View key={a.user_id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: i === attendees.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                    <Avatar name={a.name} size={32} bg={colors.accent} />
                    <Text style={{ color: colors.text, fontWeight: "600", flex: 1 }}>{a.name}</Text>
                    {!a.self_check_in && <Text style={{ color: colors.muted, fontSize: 11 }}>by admin</Text>}
                  </View>
                ))
              )}
            </View>

            {/* The hosting admin can't scan their own QR — mark themselves with
                the live code so they're counted too. */}
            {!attendees.some((a) => a.user_id === user.id) && (
              <Tap
                onPress={async () => {
                  if (!code) return;
                  try {
                    const token = await getAccessToken();
                    if (token) {
                      await checkIn(token, id, { code });
                      await refreshRoster();
                    }
                  } catch {
                    /* ignore — they can retry */
                  }
                }}
                style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, backgroundColor: colors.success, borderRadius: 14, paddingVertical: 13 }}
              >
                <Ionicons name="checkmark-circle" size={17} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800" }}>Mark me here too</Text>
              </Tap>
            )}

            <Tap onPress={() => void toggle(false)} disabled={busy} style={{ alignSelf: "stretch", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
              {busy ? <ActivityIndicator color={colors.danger} /> : <Text style={{ color: colors.danger, fontWeight: "800" }}>Close check-in</Text>}
            </Tap>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
