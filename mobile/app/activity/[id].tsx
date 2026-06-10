// Activity detail screen. The route segment "[id]" makes this a dynamic route:
// navigating to /activity/<uuid> lands here, and useLocalSearchParams gives us
// the id. We fetch the run + its route GeoJSON, draw the route as an SVG trace
// (no map tiles / API key), and show the full stat breakdown.

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { useAuth } from "../../lib/auth";
import {
  getActivity,
  getRoute,
  offsetsToTimes,
  geoJSONToLatLng,
  elevationSeries,
  type Activity,
  type LatLng,
} from "../../lib/activities";
import { RouteTrace } from "../../components/RouteTrace";
import { ElevationChart } from "../../components/ElevationChart";

// react-native-maps is a native module absent from Expo Go, so we only pull it
// in (and render the interactive map) in a dev/standalone build. Expo Go gets
// the SVG RouteTrace fallback — which still draws the pace-coloured route.
const isExpoGo = Constants.appOwnership === "expo";
const RunMap:
  | React.ComponentType<{
      coords: LatLng[];
      times?: number[];
      height?: number;
      selectedKm?: number | null;
      onSelectKm?: (km: number | null) => void;
    }>
  | null = isExpoGo ? null : require("../../components/RunMap").RunMap;
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
  const { getAccessToken } = useAuth();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [times, setTimes] = useState<number[] | undefined>(undefined);
  const [elevation, setElevation] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKm, setSelectedKm] = useState<number | null>(null);

  const splits = useMemo(() => computeSplits(route, times), [route, times]);

  // duration_s is MOVING time (server already subtracted auto-pauses); elapsed is
  // wall-clock from start to finish. Their difference is time spent paused.
  const elapsedS = activity ? Math.max(0, Math.round((Date.parse(activity.ended_at) - Date.parse(activity.started_at)) / 1000)) : 0;
  const pausedS = activity ? Math.max(0, elapsedS - activity.duration_s) : 0;

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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
      {/* A native header with a back button, titled "Run". */}
      <Stack.Screen options={{ headerShown: true, title: "Run", headerBackTitle: "Back" }} />

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

          {/* Stat tiles — moving vs elapsed up top (they match for a run with no
              auto-pauses; elapsed is longer when you stopped along the way). */}
          <StatRow>
            <StatCard label="Moving" value={formatDuration(activity.duration_s)} />
            <StatCard label="Elapsed" value={formatDuration(elapsedS)} valueColor={pausedS >= 1 ? colors.muted : undefined} />
          </StatRow>
          <StatRow>
            <StatCard label="Pace" value={formatPace(activity.avg_pace_s_per_km)} />
            <StatCard label="Speed" value={formatSpeed(activity.distance_m, activity.duration_s)} />
          </StatRow>
          <StatRow>
            <StatCard
              label="Elev gain"
              value={formatElevation(activity.elevation_gain_m)}
              valueColor={colors.success}
            />
            {pausedS >= 1 && <StatCard label="Paused" value={formatDuration(pausedS)} valueColor={colors.muted} />}
          </StatRow>

          {/* Per-km splits — tapping a row flies the map to that kilometre */}
          <Splits splits={splits} selectedKm={selectedKm} onSelect={setSelectedKm} />

          {/* Elevation profile */}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>Elevation</Text>
            <ElevationChart series={elevation} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
