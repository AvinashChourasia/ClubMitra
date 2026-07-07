// The live run screen — an immersive dark HUD (Strava/Nike style). A 3-2-1
// countdown opens the run, the distance owns the screen, a live pace-coloured
// trace draws underneath, every finished kilometre buzzes with its split, and
// finishing is HOLD-to-finish so a stray tap can't end a run. On finish the
// track is saved offline-first and uploaded.
//
// The screen stays deliberately thin: useRunRecorder owns the GPS/timer engine,
// lib/runQueue owns persistence+upload, lib/pace computes splits.

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";

import { useAuth } from "../../lib/auth";
import { useRunRecorder } from "../../lib/useRunRecorder";
import { enqueue, flush } from "../../lib/runQueue";
import { computeSplits } from "../../lib/pace";
import { formatDistance, formatDuration, formatPace, formatSpeed } from "../../lib/format";
import { getGamification, type BadgeStatus } from "../../lib/gamification";
import { RouteTrace } from "../../components/RouteTrace";
import { BadgeUnlockModal } from "../../components/BadgeUnlockModal";
import type { LatLng } from "../../lib/activities";

// Badges already celebrated this app session (a second save inside the
// freshness window must not replay the same unlock).
const celebratedIds = new Set<string>();

// Immersive dark palette — independent of the app theme so the HUD always
// reads like a night dashboard.
const BG = "#0B1220";
const CARD = "rgba(255,255,255,0.07)";
const TEXT = "#FFFFFF";
const MUTED = "#94A3B8";
const ACCENT = "#EF4444";

// Native map in any standalone build: Apple Maps on iOS (no key), Google Maps
// on Android (API key ships in the manifest). Expo Go gets the SVG trace.
const isExpoGo = Constants.appOwnership === "expo";
const nativeMapAvailable = !isExpoGo;
const maps = nativeMapAvailable ? (require("../../components/RunMap") as typeof import("../../components/RunMap")) : null;
const RunMap = maps?.RunMap ?? null;
const PreStartMap = maps?.PreStartMap ?? null;

// --- GPS warm-up ------------------------------------------------------------
// The old flow started GPS only when START was pressed, so the runner stood
// waiting ~10s while the chip acquired satellites (and the 30m accuracy filter
// rightly dropped the coarse first fixes). Now a foreground watch starts the
// moment the screen opens (permission already granted — we never prompt just
// for opening it): any high-accuracy request powers the GNSS receiver and pulls
// AGPS data, so by the time START is pressed the chip is already locked and the
// first recorded fix lands in ~1s. The watch feeds the signal chip + pre-start
// map, is removed once the engine takes over, and never records points itself.

type WarmFix = { coord: LatLng; accuracyM: number | null; atMs: number };
type GpsMeta = { granted: boolean; precise: boolean; servicesOn: boolean };
type GpsLevel = "none" | "off" | "coarse" | "searching" | "weak" | "good" | "locked";

// Thresholds relative to the recorder's 30m accuracy gate: "weak" means fixes
// are still being dropped by the filter; "good" means they're passing.
function gpsLevel(meta: GpsMeta | null, fix: WarmFix | null, nowMs: number): GpsLevel {
  if (!meta || !meta.granted) return "none"; // permission comes with START, as before
  if (!meta.servicesOn) return "off";
  if (!meta.precise) return "coarse";
  if (!fix || fix.atMs === 0 || nowMs - fix.atMs > 5000) return "searching";
  const a = fix.accuracyM ?? 9999;
  if (a > 100) return "searching"; // network-only fix; GPS not locked yet
  if (a > 30) return "weak";
  if (a > 15) return "good";
  return "locked";
}

const GPS_CHIP: Record<Exclude<GpsLevel, "none">, { label: string; dot: string; text: string; bg: string }> = {
  off: { label: "Turn on location services", dot: "#F59E0B", text: "#FCD34D", bg: "rgba(245,158,11,0.18)" },
  coarse: { label: "Precise location is off", dot: "#F59E0B", text: "#FCD34D", bg: "rgba(245,158,11,0.18)" },
  searching: { label: "GPS · searching…", dot: "#94A3B8", text: "#CBD5E1", bg: "rgba(255,255,255,0.07)" },
  weak: { label: "GPS · weak signal", dot: "#F59E0B", text: "#FCD34D", bg: "rgba(245,158,11,0.18)" },
  good: { label: "GPS · good", dot: "#4ADE80", text: "#86EFAC", bg: "rgba(74,222,128,0.14)" },
  locked: { label: "GPS · locked", dot: "#34D399", text: "#6EE7B7", bg: "rgba(52,211,153,0.16)" },
};

export default function RecordRun() {
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const { status, checking, elapsedS, distanceM, livePaceSPerKm, route, times, paused, start, stop, discard, resume, retry } = useRunRecorder();
  const [uploading, setUploading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countScale = useRef(new Animated.Value(1)).current;
  // Whether this run should count toward joined challenges. Default yes; the
  // user can flip it off for a warm-up / test run before finishing.
  const [countToward, setCountToward] = useState(true);
  // Badges this save unlocked — celebration modal, then on to the run detail.
  const [unlocked, setUnlocked] = useState<{ badges: BadgeStatus[]; runId: string } | null>(null);

  const recording = status === "recording";
  const km = Math.floor(distanceM / 1000);

  // Live splits — the last completed kilometre's pace, for the ticker line.
  const splits = useMemo(() => computeSplits(route, times), [route, times]);
  const lastSplit = splits.length > 0 ? splits[splits.length - 1] : null;

  // Fullscreen-map mode while recording (Strava-style): the map owns the screen
  // with a floating stat capsule; the toggle lives on the map card. Reset when
  // the run ends so the next run starts on the stats HUD.
  const [mapMax, setMapMax] = useState(false);
  useEffect(() => {
    if (!recording) setMapMax(false);
  }, [recording]);

  // --- GPS warm-up state (pre-start only) ---
  const [gpsMeta, setGpsMeta] = useState<GpsMeta | null>(null);
  const [warmFix, setWarmFix] = useState<WarmFix | null>(null);
  const [, setWarmTick] = useState(0); // re-render every 2s so the chip can go stale → "searching"
  // Re-arms the warm-up effect when a blocker (services off / no permission)
  // clears while we're sitting on the screen — bumped by the 2s re-check below.
  const [warmNonce, setWarmNonce] = useState(0);
  const warmingRef = useRef(false); // ignore stray fixes after remove()
  // The "turn on high-accuracy mode" system dialog may show at most ONCE per
  // screen visit — declining must not re-nag on every status transition.
  const nudgedRef = useRef(false);
  // Current status for the nudge gate WITHOUT being an effect dependency —
  // depending on `status` tore the warm watch down and relaunched the whole
  // pipeline on START (idle→requesting), exactly the GNSS remove/re-add gap
  // the cleanup comment below defends against.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    // The engine owns GPS while recording; nothing to warm while we're still
    // resolving whether a run is in progress, or while the finished run saves.
    if (checking || recording || uploading) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    // True once this run reached the watchPositionAsync attempt. The 2s tick
    // must only re-arm the effect when it bailed BEFORE the watch (blocker
    // cleared) — re-arming while a watch is pending/failed would relaunch the
    // whole pipeline every 2s indefinitely (battery + churn).
    let watchAttempted = false;
    warmingRef.current = true;
    const tick = setInterval(() => {
      setWarmTick((t) => t + 1);
      // Re-poll the environment (both calls are prompt-free): services/precise
      // toggled in Settings must update the chip, and a cleared blocker must
      // restart the warm-up (the effect early-returned before the watch began).
      void (async () => {
        const p = await Location.getForegroundPermissionsAsync().catch(() => null);
        const s = await Location.hasServicesEnabledAsync().catch(() => true);
        if (cancelled) return;
        const fresh = { granted: !!p?.granted, precise: p?.android ? p.android.accuracy === "fine" : true, servicesOn: s };
        setGpsMeta(fresh);
        if (!sub && !watchAttempted && fresh.granted && fresh.servicesOn) setWarmNonce((n) => n + 1);
      })();
    }, 2000);
    (async () => {
      // Never prompt just for opening the screen — START owns the permission ask.
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      const granted = !!perm?.granted;
      // Android 12+ can grant "approximate" only — every fix is ~km-scale and
      // the 30m filter would starve the run. Surface it instead of "searching".
      const precise = perm?.android ? perm.android.accuracy === "fine" : true;
      const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
      if (cancelled) return;
      setGpsMeta({ granted, precise, servicesOn });
      if (!granted || !servicesOn) return;

      // Instant approximate centre for the pre-start map (never a live fix —
      // atMs 0 keeps the chip honest about it). Accept ANY cached fix: a stale
      // rough centre beats a blank box while the GNSS warms ("map takes a
      // minute to appear"). The live watch replaces it within seconds.
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (cancelled) return;
      if (last) {
        setWarmFix((cur) => cur ?? {
          coord: { latitude: last.coords.latitude, longitude: last.coords.longitude },
          accuracyM: last.coords.accuracy ?? null,
          atMs: 0,
        });
      } else {
        // No cache (fresh boot / services toggled): grab a fast network-level
        // fix so the map appears in ~1-3s instead of waiting on satellites.
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest })
          .then((quick) => {
            if (cancelled) return;
            setWarmFix((cur) => cur ?? {
              coord: { latitude: quick.coords.latitude, longitude: quick.coords.longitude },
              accuracyM: quick.coords.accuracy ?? null,
              atMs: 0,
            });
          })
          .catch(() => {});
      }
      // Nudge Android's high-accuracy mode on. NOT silent when it's off: it
      // shows the system resolution dialog — so at most once per screen visit,
      // and only in the true pre-start state (never mid countdown/start/finish).
      if (!nudgedRef.current && statusRef.current === "idle" && !countdownRef.current) {
        nudgedRef.current = true;
        await Location.enableNetworkProviderAsync().catch(() => {});
      }
      if (cancelled) return;
      try {
        watchAttempted = true;
        sub = await Location.watchPositionAsync(
          // Same accuracy class as recording, so the fused provider never
          // downgrades between warm-up and the run.
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            if (!warmingRef.current) return;
            setWarmFix({
              coord: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              accuracyM: loc.coords.accuracy ?? null,
              atMs: loc.timestamp,
            });
          }
        );
        if (cancelled) {
          sub.remove();
          sub = null;
        }
      } catch {
        /* watch failed — the chip just stays on "searching" */
      }
    })();
    return () => {
      // Cleanup fires when recording flips true — i.e. AFTER the engine's
      // location task registered — so the GNSS receiver never sees a gap.
      cancelled = true;
      warmingRef.current = false;
      clearInterval(tick);
      sub?.remove();
    };
    // `status` is deliberately NOT a dep (read via statusRef): idle→requesting
    // on START must not churn the warm watch — it lives until `recording`.
  }, [checking, recording, uploading, warmNonce]);

  const level = gpsLevel(gpsMeta, warmFix, Date.now());

  // Buzz every time a kilometre completes — only on a genuine +1 increment.
  // Re-entering the screen mid-run jumps km from 0 to N in one poll (attach
  // reconciliation), which must not fire a phantom "km completed" haptic.
  const lastKm = useRef(-1);
  useEffect(() => {
    if (!recording) {
      lastKm.current = -1; // detached/ended — re-baseline on the next attach
      return;
    }
    if (lastKm.current !== -1 && km === lastKm.current + 1) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    lastKm.current = km;
  }, [km, recording]);

  // 3-2-1 countdown, then the engine starts. Each tick pulses + clicks. The
  // timer lives in a ref and is cleared on unmount — backing out mid-countdown
  // must NOT phantom-start a recording from off-screen.
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef(false); // mirrored for the warm-up effect's closure
  useEffect(
    () => () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    },
    []
  );
  function onStartPress() {
    if (countdown !== null) return;
    let n = 3;
    setCountdown(n);
    countdownRef.current = true;
    pulse();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    countdownTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        countdownRef.current = false;
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
    // uploading goes true BEFORE stop() flips status to idle, so the warm-up
    // effect never sees an idle+not-uploading gap mid-finish (it would start a
    // pointless GPS watch — and could pop the high-accuracy dialog).
    setUploading(true);
    const { points, pausedS } = await stop();
    if (points.length < 2) {
      setUploading(false);
      Alert.alert("Run too short", "We didn't capture enough GPS points. Try moving around a bit.");
      return;
    }
    // 1. Persist locally FIRST — from here the run can never be lost. If THIS
    //    fails (e.g. storage full), the run is genuinely not saved, so tell the
    //    truth rather than the comforting "saved on phone" lie below.
    try {
      await enqueue(points, countToward, pausedS);
    } catch {
      setUploading(false);
      Alert.alert(
        "Couldn't save your run",
        "Your phone may be out of storage. Free up some space, then finish again."
      );
      return;
    }
    try {
      // 2. Try to upload now — but NEVER hold the runner hostage to a cold or
      //    slow backend: after 15s we declare "saved on phone" and move on
      //    (the queue uploads it in the background / on next app focus).
      const result = await Promise.race([
        flush(getAccessToken),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
      ]);
      const justSaved = result?.uploaded[result.uploaded.length - 1];

      if (result && result.remaining === 0 && justSaved) {
        // The save already ran the badge pass server-side — anything earned in
        // the last few minutes is THIS run's unlock. Strictly a bonus: 4s
        // budget, then the plain save alert wins.
        let fresh: BadgeStatus[] = [];
        try {
          const token = await getAccessToken();
          if (token) {
            const gp = await Promise.race([
              getGamification(token),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
            ]);
            if (gp) {
              const cutoff = Date.now() - 10 * 60 * 1000;
              fresh = gp.badges.filter(
                (b) => b.earned && b.earned_at && new Date(b.earned_at).getTime() >= cutoff && !celebratedIds.has(b.id)
              );
            }
          }
        } catch {
          /* badge check is a bonus, never blocks the save */
        }
        if (fresh.length > 0) {
          fresh.forEach((b) => celebratedIds.add(b.id));
          setUnlocked({ badges: fresh, runId: justSaved.id });
          return;
        }
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
          "Run saved on your phone 📲",
          "The upload is taking a while (slow network or the server waking up). " +
            "Your run is safe and will sync automatically.",
          [{ text: "OK", onPress: () => router.replace("/home") }]
        );
      }
    } catch {
      // Whatever went wrong, the run is already enqueued — say so and get the
      // runner home. A silent dead-end here is the one unforgivable outcome.
      Alert.alert(
        "Run saved on your phone 📲",
        "Couldn't upload right now — it'll sync automatically once you're online.",
        [{ text: "OK", onPress: () => router.replace("/home") }]
      );
    } finally {
      setUploading(false);
    }
  }

  // Discard the in-progress run — confirm first, since it's unrecoverable.
  function onDiscard() {
    Alert.alert(
      "Discard this run?",
      "Your recorded route and distance will be deleted. This can't be undone.",
      [
        { text: "Keep running", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: async () => {
            await discard();
            router.replace("/home");
          },
        },
      ]
    );
  }

  // While resolving whether a run is already in progress, hold the screen on a
  // spinner so we never flash "START RUN" over a run that's actually recording.
  if (checking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center", gap: 14 }}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={{ color: MUTED, fontSize: 14, fontWeight: "700" }}>Checking for a run in progress…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 18, justifyContent: "space-between" }}>
        {/* Top bar: close + status pill */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {recording ? (
            // Minimize: leave the screen, but the engine keeps recording in the
            // background. The run is resumed automatically when you come back.
            <Pressable onPress={() => router.replace("/home")} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-down" size={22} color={TEXT} />
            </Pressable>
          ) : !uploading ? (
            <Pressable onPress={() => router.replace("/home")} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={20} color={TEXT} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
          {/* When auto-paused, the pill is the manual override: detection can
              get stuck through a bad-GPS stretch, so the runner taps to resume.
              Pre-start it doubles as the live GPS signal indicator (fed by the
              warm-up watch) so the runner starts on a locked chip, not a cold one. */}
          {/* `paused` only outranks while actually recording — a run finished
              mid-auto-pause must not mask the GPS chip on the next pre-start. */}
          <Pressable
            onPress={recording && paused ? () => void resume() : undefined}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor:
                recording && paused
                  ? "rgba(245,158,11,0.18)"
                  : recording
                    ? "rgba(239,68,68,0.18)"
                    : status === "denied"
                      ? "rgba(245,158,11,0.18)"
                      : level !== "none"
                        ? GPS_CHIP[level].bg
                        : CARD,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  recording && paused
                    ? "#F59E0B"
                    : recording
                      ? ACCENT
                      : status === "denied"
                        ? "#F59E0B"
                        : level !== "none"
                          ? GPS_CHIP[level].dot
                          : MUTED,
              }}
            />
            <Text
              style={{
                color:
                  recording && paused
                    ? "#FCD34D"
                    : recording
                      ? "#FCA5A5"
                      : status === "denied"
                        ? "#FCD34D"
                        : level !== "none"
                          ? GPS_CHIP[level].text
                          : MUTED,
                fontWeight: "700",
                fontSize: 13,
              }}
            >
              {recording && paused
                ? "Auto-paused · tap to resume"
                : recording
                  ? "Recording"
                  : status === "denied"
                    ? "Location permission needed"
                    : level !== "none"
                      ? GPS_CHIP[level].label
                      : "Ready to run"}
            </Text>
          </Pressable>
          <View style={{ width: 36 }} />
        </View>

        {/* Hero: distance + live split ticker (hidden in fullscreen-map mode —
            a floating capsule on the map carries the essentials instead) */}
        {!(recording && mapMax) && (
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
        )}

        {/* Secondary stats */}
        {!(recording && mapMax) && (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <DarkStat label="TIME" value={formatDuration(elapsedS)} />
            <DarkStat label="PACE" value={formatPace(livePaceSPerKm)} />
            <DarkStat label="SPEED" value={formatSpeed(distanceM, elapsedS)} />
          </View>
        )}

        {/* Pre-start: the "locking on" map — your position with an accuracy halo
            that shrinks as the GPS locks. Feeds off the warm-up watch. */}
        {!recording && !uploading && status !== "denied" && PreStartMap && warmFix && (
          <PreStartMap coord={warmFix.coord} accuracyM={warmFix.accuracyM} height={170} />
        )}

        {/* Live route — follow-me map (fullscreen-capable), SVG trace in Expo Go */}
        {recording &&
          (RunMap ? (
            <View style={mapMax ? { flex: 1, marginVertical: 4 } : undefined}>
              <RunMap coords={route} times={times} height={mapMax ? undefined : 190} live />
              {/* Floating stat capsule — the essentials while the map owns the screen */}
              {mapMax && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 10,
                    alignSelf: "center",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: "rgba(2,6,23,0.78)",
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] }}>
                    {(distanceM / 1000).toFixed(2)} km
                  </Text>
                  <Text style={{ color: MUTED, fontWeight: "700" }}>·</Text>
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] }}>
                    {formatDuration(elapsedS)}
                  </Text>
                  <Text style={{ color: MUTED, fontWeight: "700" }}>·</Text>
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] }}>
                    {formatPace(livePaceSPerKm)}
                  </Text>
                </View>
              )}
              {/* Expand / collapse toggle */}
              <Pressable
                onPress={() => setMapMax((v) => !v)}
                hitSlop={8}
                accessibilityLabel={mapMax ? "Shrink map" : "Expand map"}
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: "rgba(15,23,42,0.85)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name={mapMax ? "contract" : "expand"} size={18} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <RouteTrace coords={route} times={times} height={170} live />
          ))}

        {/* Controls */}
        <View style={{ gap: 12 }}>
          {status === "denied" && (
            <>
              <Text style={{ color: "#FCA5A5", fontSize: 14, textAlign: "center" }}>
                {distanceM > 0
                  ? "Location is off, so your run is paused. Re-enable it to keep recording."
                  : "Location permission denied. Enable it to record runs."}
              </Text>
              <Pressable
                onPress={() => void retry()}
                style={{ backgroundColor: ACCENT, borderRadius: 999, paddingVertical: 18, alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 1 }}>
                  {distanceM > 0 ? "ENABLE & RESUME" : "ENABLE LOCATION"}
                </Text>
              </Pressable>
              {distanceM > 0 && (
                <Pressable onPress={onDiscard} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 6 }}>
                  <Text style={{ color: MUTED, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" }}>Discard run</Text>
                </Pressable>
              )}
            </>
          )}

          {!recording && !uploading && status !== "denied" && (
            <Pressable
              onPress={onStartPress}
              style={{ backgroundColor: ACCENT, borderRadius: 999, paddingVertical: 18, alignItems: "center", shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}
            >
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 1 }}>
                {status === "requesting" ? "STARTING…" : "START RUN"}
              </Text>
            </Pressable>
          )}

          {/* For the runners who record on Strava/Garmin and won't switch apps.
              Idle-only so it doesn't flash during the start countdown / "STARTING…". */}
          {status === "idle" && (
            <Pressable onPress={() => router.push("/activity/import")} hitSlop={8} style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}>
              <Ionicons name="cloud-upload-outline" size={15} color={MUTED} />
              <Text style={{ color: MUTED, fontSize: 13.5, fontWeight: "700" }}>Ran with Strava or Garmin? Import it</Text>
            </Pressable>
          )}

          {recording && (
            <>
              {/* Opt-out: exclude this run from challenge progress. (Hidden in
                  fullscreen-map mode — it's a set-once toggle; collapse to reach it.) */}
              {!mapMax && (
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
              )}

              <Pressable
                onLongPress={onFinish}
                delayLongPress={700}
                style={{ backgroundColor: TEXT, borderRadius: 999, paddingVertical: 18, alignItems: "center" }}
              >
                <Text style={{ color: BG, fontSize: 17, fontWeight: "800", letterSpacing: 1 }}>HOLD TO FINISH</Text>
              </Pressable>
              {!mapMax && (
                <Text style={{ color: MUTED, fontSize: 12, textAlign: "center", marginTop: -4 }}>
                  press and hold so a stray tap can't end your run
                </Text>
              )}
              <Pressable onPress={onDiscard} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 6 }}>
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" }}>Discard run</Text>
              </Pressable>
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

      {/* Badge unlock — the post-save celebration, then on to the run detail */}
      {unlocked && (
        <BadgeUnlockModal
          badges={unlocked.badges}
          onClose={() => {
            const id = unlocked.runId;
            setUnlocked(null);
            router.replace(`/activity/${id}`);
          }}
        />
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
