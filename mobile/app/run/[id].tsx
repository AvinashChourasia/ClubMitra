// Run detail: when/where, who's checked in, and a one-tap self check-in.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { getRun, listAttendees, checkOut, type Run, type Attendee } from "../../lib/attendance";
import { myChapters, isChapterAdmin } from "../../lib/clubs";
import { colors, styles } from "../../lib/theme";
import { formatRunWhen } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { ErrorState } from "../../components/ErrorState";

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();

  const [run, setRun] = useState<Run | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    const [r, a, mine] = await Promise.all([getRun(token!, id), listAttendees(token!, id), myChapters(token!)]);
    setRun(r);
    setAttendees(a);
    setIsAdmin(isChapterAdmin(mine.find((c) => c.id === r.chapter_id)?.role));
  }, [getAccessToken, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch (e) {
          if (active) setError(e instanceof ApiError ? e.message : "Something went wrong");
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  async function retry() {
    setError(null);
    setLoading(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <Redirect href="/login" />;

  const alreadyIn = attendees.some((a) => a.user_id === user.id);

  async function doCheckOut() {
    setChecking(true);
    try {
      const token = await getAccessToken();
      await checkOut(token!, id, reason.trim() || undefined);
      setShowCheckout(false);
      setReason("");
      await load();
    } catch (e) {
      // A failed check-out shouldn't wipe the run detail — alert and stay put.
      setShowCheckout(false);
      Alert.alert("Couldn't check out", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : error && !run ? (
          <ErrorState message={error} onRetry={retry} retrying={loading} />
        ) : run ? (
          <>
            <View style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, flex: 1 }}>{run.title}</Text>
                {isAdmin && (
                  <Pressable onPress={() => router.push(`/run/edit/${id}`)} hitSlop={8}>
                    <Text style={{ color: colors.accent, fontWeight: "700" }}>Edit</Text>
                  </Pressable>
                )}
              </View>
              <Text style={{ color: colors.primary, fontWeight: "700", marginTop: 4 }}>{formatRunWhen(run.scheduled_at, run.has_time)}</Text>
              {run.location ? <Text style={{ color: colors.muted, marginTop: 6 }}>📍 {run.location}</Text> : null}
              {run.distance_target ? <Text style={{ color: colors.muted, marginTop: 2 }}>🎯 {run.distance_target} km target</Text> : null}
              {run.notes ? <Text style={{ color: colors.text, marginTop: 8 }}>{run.notes}</Text> : null}
              {run.checkin_open && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
                  <Text style={{ color: colors.success, fontWeight: "800", fontSize: 12.5 }}>Check-in is open now</Text>
                </View>
              )}
            </View>

            {/* Admin: host the QR check-in (open/close, rotating code, roster). */}
            {isAdmin && (
              <Pressable
                onPress={() => router.push(`/run/host/${id}`)}
                style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: colors.text, borderRadius: 14, paddingVertical: 15 }}
              >
                <Ionicons name="qr-code" size={18} color={colors.bg} />
                <Text style={{ color: colors.bg, fontWeight: "800", fontSize: 15 }}>{run.checkin_open ? "Manage check-in" : "Open check-in (QR)"}</Text>
              </Pressable>
            )}

            {/* Member check-in / out */}
            {alreadyIn ? (
              <View style={{ gap: 8 }}>
                <View style={{ backgroundColor: colors.success, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>✓ You&apos;re checked in</Text>
                </View>
                <Pressable
                  onPress={() => setShowCheckout(true)}
                  disabled={checking}
                  style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 13, alignItems: "center" }}
                >
                  <Text style={{ color: colors.danger, fontWeight: "700" }}>Check out</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => router.push(`/run/scan/${id}`)}
                style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center", gap: 2 }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Scan to check in</Text>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>
                  {run.checkin_open ? "Scan the organiser's QR or enter the code" : "Opens when the organiser starts check-in"}
                </Text>
              </Pressable>
            )}

            {/* Attendees */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Checked in ({attendees.length})</Text>
              {attendees.length === 0 ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>No one has checked in yet.</Text>
              ) : (
                attendees.map((a, i) => (
                  <View
                    key={a.user_id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 10,
                      borderBottomWidth: i === attendees.length - 1 ? 0 : 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Avatar name={a.name} size={36} bg={colors.accent} />
                    <Text style={{ color: colors.text, fontWeight: "600", flex: 1 }}>{a.name}</Text>
                    {!a.self_check_in && <Text style={{ color: colors.muted, fontSize: 11 }}>marked by admin</Text>}
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Check-out reason modal (reason is optional) */}
      <Modal visible={showCheckout} animationType="fade" transparent onRequestClose={() => setShowCheckout(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}
        >
          <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 20, gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Check out of this run?</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Optionally let the organiser know why.</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: "top" }]}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.muted}
              multiline
              value={reason}
              onChangeText={setReason}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => {
                  setShowCheckout(false);
                  setReason("");
                }}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                <Text style={{ color: colors.text, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={doCheckOut}
                disabled={checking}
                style={{ flex: 1, backgroundColor: colors.danger, opacity: checking ? 0.7 : 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                {checking ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Check out</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
