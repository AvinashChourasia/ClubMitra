// Activity detail screen. The route segment "[id]" makes this a dynamic route:
// navigating to /activity/<uuid> lands here, and useLocalSearchParams gives us
// the id. We fetch the run + its route GeoJSON, draw the route as an SVG trace
// (no map tiles / API key), and show the full stat breakdown.

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

import { useAuth } from "../../lib/auth";
import {
  getActivity,
  getRoute,
  getStats,
  offsetsToTimes,
  geoJSONToLatLng,
  elevationSeries,
  type Activity,
  type LatLng,
} from "../../lib/activities";
import { RouteTrace } from "../../components/RouteTrace";
import { RunShareCard } from "../../components/RunShareCard";
import { ElevationChart } from "../../components/ElevationChart";
import { Tap } from "../../components/Tap";

// react-native-maps is a native module absent from Expo Go, so we only pull it
// in (and render the interactive map) in a standalone build. Expo Go gets the
// SVG RouteTrace fallback — which still draws the pace-coloured route.
// Both platforms now: Apple Maps on iOS (no key), Google Maps on Android (the
// API key ships in the manifest via app.json → android.config.googleMaps).
const isExpoGo = Constants.appOwnership === "expo";
const nativeMapAvailable = !isExpoGo;
const RunMap:
  | React.ComponentType<{
      coords: LatLng[];
      times?: number[];
      height?: number;
      selectedKm?: number | null;
      onSelectKm?: (km: number | null) => void;
    }>
  | null = nativeMapAvailable ? require("../../components/RunMap").RunMap : null;
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatElevation,
} from "../../lib/format";
import { StatCard, StatRow } from "../../components/StatCard";
import { Splits } from "../../components/Splits";
import { computeSplits } from "../../lib/pace";
import { colors } from "../../lib/theme";

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [times, setTimes] = useState<number[] | undefined>(undefined);
  const [elevation, setElevation] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKm, setSelectedKm] = useState<number | null>(null);
  // Personal records THIS run holds (all-time stats include this run, so a
  // match within tolerance means this run set/ties the record). The rewarding
  // "🏆 Longest run ever" moment right after a save.
  const [prs, setPrs] = useState<string[]>([]);

  const splits = useMemo(() => computeSplits(route, times), [route, times]);

  // duration_s is MOVING time (server already subtracted auto-pauses); elapsed is
  // wall-clock from start to finish. Their difference is time spent paused.
  const elapsedS = activity ? Math.max(0, Math.round((Date.parse(activity.ended_at) - Date.parse(activity.started_at)) / 1000)) : 0;
  const pausedS = activity ? Math.max(0, elapsedS - activity.duration_s) : 0;
  const bestSplit = splits.length > 0 ? Math.min(...splits.map((s) => s.paceSPerKm)) : null;

  // Pacing strategy: compare the halves' average paces (equal-size halves; the
  // middle km of an odd count is excluded). Negative split — finishing faster
  // than you started — is the one runners brag about. Needs 4+ full km to be a
  // meaningful call.
  const pacing = useMemo(() => {
    if (splits.length < 4) return null;
    const half = Math.floor(splits.length / 2);
    const avg = (arr: typeof splits) => arr.reduce((sum, x) => sum + x.paceSPerKm, 0) / arr.length;
    const d = avg(splits.slice(splits.length - half)) - avg(splits.slice(0, half));
    const perKm = Math.abs(Math.round(d));
    if (Math.abs(d) <= 3) return { tone: "even" as const, label: "Even pacing", detail: "halves within 3 s/km" };
    if (d < 0) return { tone: "good" as const, label: "Negative split 🔥", detail: `2nd half ${perKm} s/km faster` };
    return { tone: "faded" as const, label: "Positive split", detail: `2nd half ${perKm} s/km slower` };
  }, [splits]);

  // Sharing: the share button opens a preview of the run as a picture (dark
  // stat card with the route as the hero). "Share card" captures that view to
  // a PNG and hands it to the OS share sheet; "Text" keeps the brag line.
  const [showShare, setShowShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  // Text fallback. Pace and best-km only appear on runs of 1 km+ — pace on a
  // short test loop is noise, not a brag.
  async function shareText() {
    if (!activity) return;
    const when = new Date(activity.started_at).toLocaleDateString([], { day: "numeric", month: "short" });
    const fullKm = activity.distance_m >= 1000;
    const headline = fullKm
      ? `🏃 ${formatDistance(activity.distance_m)} in ${formatDuration(activity.duration_s)} — ${formatPace(activity.avg_pace_s_per_km)}`
      : `🏃 ${formatDistance(activity.distance_m)} in ${formatDuration(activity.duration_s)}`;
    const lines = [
      headline,
      fullKm && bestSplit ? `⚡ Best km ${formatPace(bestSplit)}` : null,
      `📍 ${when} · tracked on ClubMitra`,
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      /* user dismissed */
    }
  }

  // Capture the card → PNG → OS share sheet. The snapshot target is the
  // HIDDEN off-screen copy in the main view hierarchy (capturing inside a
  // Modal hangs/fails on Android). The modal stays OPEN until the share
  // sheet is done — closing it first races the dismissal animation against
  // the share intent and the sheet gets swallowed. A timeout turns silent
  // native failures into a visible fallback; builds without the capture
  // modules land there too (next APK lights them up).
  async function shareCard() {
    setSharing(true);
    try {
      const { captureRef } = require("react-native-view-shot") as typeof import("react-native-view-shot");
      const Sharing = require("expo-sharing") as typeof import("expo-sharing");
      const uri = await Promise.race([
        captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("capture timed out")), 6000)),
      ]);
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable on this device");
      await Sharing.shareAsync(uri.startsWith("file://") ? uri : `file://${uri}`, {
        mimeType: "image/png",
        dialogTitle: "Share run",
      });
      setShowShare(false); // only after the sheet has done its job
    } catch (e) {
      Alert.alert(
        "Couldn't share the image",
        e instanceof Error ? e.message : "Something went wrong.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Share as text",
            onPress: () => {
              setShowShare(false);
              void shareText();
            },
          },
        ]
      );
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not logged in");
        // Fetch the run and its route in parallel — they're independent.
        const [act, routeRes] = await Promise.all([
          getActivity(token, id),
          getRoute(token, id),
        ]);
        if (!active) return;
        setActivity(act);
        setRoute(geoJSONToLatLng(routeRes.geometry));
        setTimes(offsetsToTimes(routeRes.offsets_s));
        setElevation(elevationSeries(routeRes.geometry));
        // PR check (best-effort; never blocks the screen). Skipped for a
        // runner's very first run — everything is trivially a record then.
        void getStats(token)
          .then((s) => {
            if (!active || s.total_runs < 2) return;
            const out: string[] = [];
            const pace = act.avg_pace_s_per_km;
            if (act.distance_m >= s.longest_run_m - 1) out.push("🏆 Longest run ever");
            if (pace != null && s.best_pace_s_per_km != null && act.distance_m >= 1000 && pace <= s.best_pace_s_per_km + 0.5)
              out.push("⚡ Best pace ever");
            else if (pace != null && s.best_pace_10k_s_per_km != null && act.distance_m >= 10000 && pace <= s.best_pace_10k_s_per_km + 0.5)
              out.push("🚀 Fastest 10K+ run");
            else if (pace != null && s.best_pace_5k_s_per_km != null && act.distance_m >= 5000 && pace <= s.best_pace_5k_s_per_km + 0.5)
              out.push("💨 Fastest 5K+ run");
            setPrs(out);
          })
          .catch(() => {});
      } catch {
        if (active) setError("Couldn't load this run.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, getAccessToken]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "bottom"]}>
      {/* Floating back button — no native header bar, it floats over the map. */}
      <Tap
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/activity"))}
        hitSlop={10}
        haptic={false}
        accessibilityLabel="Back"
        style={{
          position: "absolute",
          top: 58,
          left: 24,
          zIndex: 10,
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: "rgba(15,23,42,0.55)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Tap>
      {activity && (
        <Tap
          onPress={() => setShowShare(true)}
          hitSlop={10}
          haptic={false}
          accessibilityLabel="Share run"
          style={{
            position: "absolute",
            top: 58,
            right: 24,
            zIndex: 10,
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: "rgba(15,23,42,0.55)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="share-outline" size={19} color="#fff" />
        </Tap>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error || !activity ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: colors.muted }}>{error ?? "Run not found."}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
          {/* Interactive native map in a dev build; SVG trace fallback in Expo Go */}
          {RunMap ? (
            <RunMap coords={route} times={times} height={260} selectedKm={selectedKm} onSelectKm={setSelectedKm} />
          ) : (
            <RouteTrace coords={route} times={times} height={260} />
          )}

          {/* Date + headline distance */}
          <View>
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
              {formatDistance(activity.distance_m)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {new Date(activity.started_at).toLocaleString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>

          {/* Records this run set — the post-run reward moment */}
          {prs.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {prs.map((p) => (
                <View
                  key={p}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(250,204,21,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(250,204,21,0.55)",
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800" }}>{p}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Stat tiles — moving vs elapsed up top (they match for a run with no
              auto-pauses; elapsed is longer when you stopped along the way). */}
          {/* The essentials lead: pace, moving time, climb. Second row carries
              the rest; paused time appears only when it exists. */}
          <StatRow>
            <StatCard label="Pace" value={formatPace(activity.avg_pace_s_per_km)} />
            <StatCard label="Moving" value={formatDuration(activity.duration_s)} />
            <StatCard label="Elev gain" value={formatElevation(activity.elevation_gain_m)} valueColor={colors.success} />
          </StatRow>
          <StatRow>
            <StatCard label="Speed" value={formatSpeed(activity.distance_m, activity.duration_s)} />
            {bestSplit !== null && <StatCard label="Best km" value={formatPace(bestSplit)} valueColor={colors.primary} />}
            <StatCard label="Elapsed" value={formatDuration(elapsedS)} valueColor={pausedS >= 1 ? colors.muted : undefined} />
          </StatRow>
          {pausedS >= 1 && (
            <StatRow>
              <StatCard label="Paused (auto)" value={formatDuration(pausedS)} valueColor={colors.muted} />
            </StatRow>
          )}

          {/* Pacing strategy — how the run was raced, from the halves' paces. */}
          {pacing && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: pacing.tone === "good" ? "rgba(52,211,153,0.12)" : colors.bg,
                borderWidth: 1,
                borderColor: pacing.tone === "good" ? "rgba(52,211,153,0.45)" : colors.border,
                borderRadius: 12,
                paddingHorizontal: 13,
                paddingVertical: 10,
              }}
            >
              <Ionicons
                name={pacing.tone === "good" ? "trending-down" : pacing.tone === "even" ? "remove" : "trending-up"}
                size={16}
                color={pacing.tone === "good" ? colors.success : colors.muted}
              />
              <Text style={{ flex: 1, color: colors.text, fontSize: 13.5, fontWeight: "700" }}>{pacing.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>{pacing.detail}</Text>
            </View>
          )}

          {/* Per-km splits — tapping a row flies the map to that kilometre */}
          <Splits splits={splits} selectedKm={selectedKm} onSelect={setSelectedKm} />

          {/* Elevation profile, annotated with the climb + peak */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>Elevation</Text>
              {elevation.length >= 2 && (
                <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: "600" }}>
                  ↑ {formatElevation(activity.elevation_gain_m)} · peak {Math.round(Math.max(...elevation))} m
                </Text>
              )}
            </View>
            <ElevationChart series={elevation} />
          </View>
        </ScrollView>
      )}

      {/* Hidden snapshot target — lives in the MAIN window (not the Modal),
          parked off-screen. Android can only capture views in this hierarchy. */}
      {activity && showShare && (
        <View ref={cardRef} collapsable={false} style={{ position: "absolute", left: -2000, top: 0 }}>
          <RunShareCard
            runnerName={user?.name ?? "ClubMitra runner"}
            startedAt={activity.started_at}
            distanceM={activity.distance_m}
            durationS={activity.duration_s}
            avgPaceSPerKm={activity.avg_pace_s_per_km}
            bestSplitSPerKm={bestSplit}
            coords={route}
            times={times}
          />
        </View>
      )}

      {/* Share sheet: live preview of the picture card + the two ways out */}
      {activity && showShare && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowShare(false)}>
          <Pressable
            onPress={() => setShowShare(false)}
            style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.78)", alignItems: "center", justifyContent: "center", padding: 20 }}
          >
            <Pressable onPress={() => {}}>
              <RunShareCard
                runnerName={user?.name ?? "ClubMitra runner"}
                startedAt={activity.started_at}
                distanceM={activity.distance_m}
                durationS={activity.duration_s}
                avgPaceSPerKm={activity.avg_pace_s_per_km}
                bestSplitSPerKm={bestSplit}
                coords={route}
                times={times}
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <Pressable
                  onPress={() => void shareCard()}
                  disabled={sharing}
                  style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, backgroundColor: colors.primary, opacity: sharing ? 0.7 : 1, borderRadius: 999, paddingVertical: 13 }}
                >
                  {sharing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="image" size={16} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Share card</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setShowShare(false);
                    void shareText();
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 13 }}
                >
                  <Ionicons name="text" size={15} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Text</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}
