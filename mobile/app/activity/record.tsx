// The live run screen: a HUD showing distance (hero) plus time, pace and speed
// while recording GPS, with Start / Finish controls. On finish it saves the
// track (offline-queue-first) and shows the server-computed result.
//
// This screen is deliberately thin: useRunRecorder owns the GPS/timer engine,
// lib/runQueue owns persistence+upload, lib/format owns the display strings, and
// StatCard owns the tile look. The screen just wires them together.

import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { useRunRecorder } from "../../lib/useRunRecorder";
import { enqueue, flush } from "../../lib/runQueue";
import { formatDistance, formatDuration, formatPace, formatSpeed } from "../../lib/format";
import { StatCard, StatRow } from "../../components/StatCard";
import { colors } from "../../lib/theme";

export default function RecordRun() {
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const { status, elapsedS, distanceM, livePaceSPerKm, start, stop } = useRunRecorder();
  const [uploading, setUploading] = useState(false);
  // Whether this run should count toward joined challenges. Default yes; the
  // user can flip it off for a warm-up / test run before finishing.
  const [countToward, setCountToward] = useState(true);

  async function onFinish() {
    const points = await stop();
    if (points.length < 2) {
      Alert.alert("Run too short", "We didn't capture enough GPS points. Try moving around a bit.");
      return;
    }
    setUploading(true);
    try {
      // 1. Persist locally FIRST — from here the run can never be lost, even if
      //    the upload fails or the app is killed.
      await enqueue(points, countToward);

      // 2. Try to upload now (plus any previously queued runs).
      const { uploaded, remaining } = await flush(getAccessToken);
      const justSaved = uploaded[uploaded.length - 1];

      if (remaining === 0 && justSaved) {
        Alert.alert(
          "Run saved! 🎉",
          `Distance: ${formatDistance(justSaved.distance_m)}\n` +
            `Time: ${formatDuration(justSaved.duration_s)}\n` +
            `Pace: ${formatPace(justSaved.avg_pace_s_per_km)}`,
          [{ text: "Done", onPress: () => router.replace("/home") }]
        );
      } else {
        Alert.alert(
          "Run saved offline 📶",
          `You're offline, so your run is saved on your phone (${remaining} waiting). ` +
            `It'll upload automatically once you're back online.`,
          [{ text: "OK", onPress: () => router.replace("/home") }]
        );
      }
    } finally {
      setUploading(false);
    }
  }

  const recording = status === "recording";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 24, justifyContent: "space-between" }}>
        {/* Status pill */}
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: recording ? "#FEE2E2" : colors.bgSecondary,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 999,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: recording ? colors.primary : colors.muted,
              }}
            />
            <Text style={{ color: recording ? colors.primaryDark : colors.muted, fontWeight: "600" }}>
              {recording ? "Recording" : "Ready to run"}
            </Text>
          </View>
        </View>

        {/* Hero: distance */}
        <View style={{ alignItems: "center", gap: 2 }}>
          <Text style={{ fontSize: 52, fontWeight: "800", color: colors.text, letterSpacing: -1 }}>
            {(distanceM / 1000).toFixed(2)}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 1 }}>
            KILOMETERS
          </Text>
        </View>

        {/* Secondary stats */}
        <StatRow>
          <StatCard label="Time" value={formatDuration(elapsedS)} />
          <StatCard label="Pace" value={formatPace(livePaceSPerKm)} />
          <StatCard label="Speed" value={formatSpeed(distanceM, elapsedS)} />
        </StatRow>

        {/* Controls */}
        <View style={{ gap: 12 }}>
          {status === "denied" && (
            <Text style={{ color: colors.danger, fontSize: 14, textAlign: "center" }}>
              Location permission denied. Enable it in Settings to record runs.
            </Text>
          )}

          {!recording && !uploading && (
            <Pressable
              style={{ backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: "center" }}
              onPress={start}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                {status === "requesting" ? "Starting…" : "Start run"}
              </Text>
            </Pressable>
          )}

          {recording && (
            <>
              {/* Opt-out: exclude this run from challenge progress. */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: colors.bgSecondary,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                  Count toward challenges
                </Text>
                <Switch
                  value={countToward}
                  onValueChange={setCountToward}
                  trackColor={{ true: colors.primary }}
                />
              </View>

              <Pressable
                style={{ backgroundColor: colors.text, borderRadius: 999, paddingVertical: 14, alignItems: "center" }}
                onPress={onFinish}
              >
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Finish & save</Text>
              </Pressable>
            </>
          )}

          {uploading && <ActivityIndicator size="large" color={colors.primary} />}

          {!recording && !uploading && (
            <Pressable onPress={() => router.replace("/home")}>
              <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600", textAlign: "center" }}>
                Back home
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
