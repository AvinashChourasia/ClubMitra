// The live run screen — an immersive dark HUD (Strava/Nike style). A 3-2-1
// countdown opens the run, the distance owns the screen, a live pace-coloured
// trace draws underneath, every finished kilometre buzzes with its split, and
// finishing is HOLD-to-finish so a stray tap can't end a run. On finish the
// track is saved offline-first and uploaded.
//
// The screen stays deliberately thin: useRunRecorder owns the GPS/timer engine,
// lib/runQueue owns persistence+upload, lib/pace computes splits.

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Platform, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";

import { useAuth } from "../../lib/auth";
import { useRunRecorder } from "../../lib/useRunRecorder";
import { enqueue, flush } from "../../lib/runQueue";
import { computeSplits } from "../../lib/pace";
import { formatDistance, formatDuration, formatPace, formatSpeed } from "../../lib/format";
import { RouteTrace } from "../../components/RouteTrace";
import type { LatLng } from "../../lib/activities";

// Immersive dark palette — independent of the app theme so the HUD always
// reads like a night dashboard.
const BG = "#0B1220";
const CARD = "rgba(255,255,255,0.07)";
const TEXT = "#FFFFFF";
const MUTED = "#94A3B8";
const ACCENT = "#F43F5E";

// Native map only on iOS builds (Apple Maps — free, no key); Expo Go and
// Android use the SVG trace (Google Maps would need an API key + billing).
const isExpoGo = Constants.appOwnership === "expo";
const nativeMapAvailable = !isExpoGo && Platform.OS === "ios";
const RunMap: React.ComponentType<{ coords: LatLng[]; times?: number[]; height?: number; live?: boolean }> | null =
  nativeMapAvailable ? require("../../components/RunMap").RunMap : null;

export default function RecordRun() {
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const { status, elapsedS, distanceM, livePaceSPerKm, route, times, paused, start, stop } = useRunRecorder();
  const [uploading, setUploading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countScale = useRef(new Animated.Value(1)).current;
  // Whether this run should count toward joined challenges. Default yes; the
  // user can flip it off for a warm-up / test run before finishing.
  const [countToward, setCountToward] = useState(true);

  const recording = status === "recording";
  const km = Math.floor(distanceM / 1000);

  // Live splits — the last completed kilometre's pace, for the ticker line.
  const splits = useMemo(() => computeSplits(route, times), [route, times]);
  const lastSplit = splits.length > 0 ? splits[splits.length - 1] : null;

  // Buzz every time a kilometre completes.
  useEffect(() => {
    if (km > 0 && recording) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [km, recording]);

  // 3-2-1 countdown, then the engine starts. Each tick pulses + clicks.
  function onStartPress() {
    if (countdown !== null) return;
    let n = 3;
    setCountdown(n);
    pulse();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const timer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(timer);
        setCountdown(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void start();
        return;
      }
      setCountdown(n);
      pulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }, 1000);
  }

  function pulse() {
    countScale.setValue(1.6);
    Animated.spring(countScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
  }

  async function onFinish() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const { points, pausedS } = await stop();
    if (points.length < 2) {
      Alert.alert("Run too short", "We didn't capture enough GPS points. Try moving around a bit.");
      return;
    }
    setUploading(true);
    try {
      // 1. Persist locally FIRST — from here the run can never be lost, even if
      //    the upload fails or the app is killed.
      await enqueue(points, countToward, pausedS);

      // 2. Try to upload now (plus any previously queued runs).
      const { uploaded, remaining } = await flush(getAccessToken);
      const justSaved = uploaded[uploaded.length - 1];

      if (remaining === 0 && justSaved) {
        Alert.alert(
          "Run saved! 🎉",
          `Distance: ${formatDistance(justSaved.distance_m)}\n` +
            `Time: ${formatDuration(justSaved.duration_s)}\n` +
            `Pace: ${formatPace(justSaved.avg_pace_s_per_km)}`,
          [
            { text: "View run", onPress: () => router.replace(`/activity/${justSaved.id}`) },
            { text: "Done", onPress: () => router.replace("/home") },
          ]
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 18, justifyContent: "space-between" }}>
        {/* Top bar: close + status pill */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {!recording && !uploading ? (
            <Pressable onPress={() => router.replace("/home")} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={20} color={TEXT} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: paused ? "rgba(245,158,11,0.18)" : recording ? "rgba(244,63,94,0.18)" : CARD,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: paused ? "#F59E0B" : recording ? ACCENT : MUTED }} />
            <Text style={{ color: paused ? "#FCD34D" : recording ? "#FDA4AF" : MUTED, fontWeight: "700", fontSize: 13 }}>
              {paused ? "Auto-paused" : recording ? "Recording" : "Ready to run"}
            </Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Hero: distance + live split ticker */}
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 76, fontWeight: "800", color: TEXT, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>
            {(distanceM / 1000).toFixed(2)}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: "800", color: MUTED, letterSpacing: 2 }}>KILOMETERS</Text>
          {recording && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: CARD, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Ionicons name="flag" size={12} color={MUTED} />
              <Text style={{ color: MUTED, fontSize: 13, fontWeight: "700" }}>
                {lastSplit ? `Km ${km + 1} · last km ${formatPace(lastSplit.paceSPerKm)}` : `Km ${km + 1} · first split coming up`}
              </Text>
            </View>
          )}
        </View>

        {/* Secondary stats */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <DarkStat label="TIME" value={formatDuration(elapsedS)} />
          <DarkStat label="PACE" value={formatPace(livePaceSPerKm)} />
          <DarkStat label="SPEED" value={formatSpeed(distanceM, elapsedS)} />
        </View>

        {/* Live route — follow-me map in an iOS build, SVG trace elsewhere */}
        {recording &&
          (RunMap ? (
            <RunMap coords={route} times={times} height={190} live />
          ) : (
            <RouteTrace coords={route} times={times} height={170} live />
          ))}

        {/* Controls */}
        <View style={{ gap: 12 }}>
          {status === "denied" && (
            <Text style={{ color: "#FDA4AF", fontSize: 14, textAlign: "center" }}>
              Location permission denied. Enable it in Settings to record runs.
            </Text>
          )}

          {!recording && !uploading && (
            <Pressable
              onPress={onStartPress}
              style={{ backgroundColor: ACCENT, borderRadius: 999, paddingVertical: 18, alignItems: "center", shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}
            >
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 1 }}>
                {status === "requesting" ? "STARTING…" : "START RUN"}
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
                  backgroundColor: CARD,
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: TEXT, fontSize: 14, flex: 1 }}>Count toward challenges</Text>
                <Switch value={countToward} onValueChange={setCountToward} trackColor={{ true: ACCENT }} />
              </View>

              <Pressable
                onLongPress={onFinish}
                delayLongPress={700}
                style={{ backgroundColor: TEXT, borderRadius: 999, paddingVertical: 18, alignItems: "center" }}
              >
                <Text style={{ color: BG, fontSize: 17, fontWeight: "800", letterSpacing: 1 }}>HOLD TO FINISH</Text>
              </Pressable>
              <Text style={{ color: MUTED, fontSize: 12, textAlign: "center", marginTop: -4 }}>
                press and hold so a stray tap can't end your run
              </Text>
            </>
          )}

          {uploading && <ActivityIndicator size="large" color={ACCENT} />}
        </View>
      </View>

      {/* 3-2-1 countdown overlay */}
      {countdown !== null && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Text style={{ color: MUTED, fontSize: 15, fontWeight: "800", letterSpacing: 3 }}>GET READY</Text>
          <Animated.Text
            style={{
              color: TEXT,
              fontSize: 140,
              fontWeight: "800",
              letterSpacing: -4,
              transform: [{ scale: countScale }],
            }}
          >
            {countdown}
          </Animated.Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: CARD, borderRadius: 16, paddingVertical: 14, alignItems: "center", gap: 3 }}>
      <Text style={{ color: TEXT, fontSize: 19, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={{ color: MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }}>{label}</Text>
    </View>
  );
}
