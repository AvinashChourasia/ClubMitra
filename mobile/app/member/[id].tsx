// Member attendance record within a club: "attended 8 of 12 · 67%" plus the
// runs they made. Reached two ways — an admin taps a member in the club roster,
// or a member opens their own "My attendance". The backend allows the member
// themselves or an admin of the chapter; anyone else gets 403.
//
// Params: id = the member's user id; ?chapter = chapter id; ?name = display name.

import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { memberChapterAttendance, type ChapterAttendance } from "../../lib/attendance";
import { ProgressRing } from "../../components/ProgressRing";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { colors, styles } from "../../lib/theme";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function MemberAttendance() {
  const { id, chapter, name } = useLocalSearchParams<{ id: string; chapter?: string; name?: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ChapterAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (!token || !chapter) return;
          const d = await memberChapterAttendance(token, chapter, id);
          if (active) setData(d);
        } catch (e) {
          if (active) setError(e instanceof ApiError ? e.message : "Couldn't load attendance");
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken, chapter, id])
  );

  if (!user) return <Redirect href="/login" />;

  const isMe = id === user.id;
  const displayName = name || (isMe ? user.name : "Member");
  const rate = data && data.total_runs > 0 ? data.attended / data.total_runs : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} hitSlop={12} haptic={false} style={{ marginLeft: -8, padding: 6 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Tap>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{isMe ? "My attendance" : "Attendance"}</Text>
        </View>

        {error ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 28, gap: 6 }]}>
            <Ionicons name="lock-closed-outline" size={28} color={colors.subtle} />
            <Text style={{ color: colors.muted, textAlign: "center" }}>{error}</Text>
          </View>
        ) : data === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* Header: who + the rate ring */}
            <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 16 }]}>
              <ProgressRing size={92} stroke={9} fraction={rate} colors={["#34D399", "#12B76A"]}>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 20 }}>{Math.round(rate * 100)}%</Text>
              </ProgressRing>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Avatar name={displayName} size={36} bg={colors.accent} />
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17, flex: 1 }} numberOfLines={1}>{displayName}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 14 }}>
                  Attended <Text style={{ color: colors.text, fontWeight: "800" }}>{data.attended}</Text> of{" "}
                  <Text style={{ color: colors.text, fontWeight: "800" }}>{data.total_runs}</Text> club run{data.total_runs === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {/* The runs they showed up to */}
            <View style={[styles.card, { gap: 2 }]}>
              <Text style={styles.sectionTitle}>Runs attended</Text>
              {data.history.length === 0 ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>
                  {isMe ? "No check-ins yet — scan in at your next club run." : "No check-ins yet."}
                </Text>
              ) : (
                data.history.map((h, i) => (
                  <View key={h.run_id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: i === data.history.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(18,183,106,0.12)", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={16} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "700" }} numberOfLines={1}>{h.title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(h.scheduled_at)}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
