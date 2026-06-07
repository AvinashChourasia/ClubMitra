// Activity detail screen. The route segment "[id]" makes this a dynamic route:
// navigating to /activity/<uuid> lands here, and useLocalSearchParams gives us
// the id. We fetch the run + its route GeoJSON, draw the route on a map, and
// show the full stat breakdown.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from "react-native-maps";

import { useAuth } from "../../lib/auth";
import {
  getActivity,
  getRouteGeoJSON,
  geoJSONToLatLng,
  elevationSeries,
  type Activity,
  type LatLng,
} from "../../lib/activities";
import { regionForRoute } from "../../lib/mapRegion";
import { ElevationChart } from "../../components/ElevationChart";
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatElevation,
} from "../../lib/format";
import { StatCard, StatRow } from "../../components/StatCard";
import { colors } from "../../lib/theme";

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [elevation, setElevation] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not logged in");
        // Fetch the run and its route in parallel — they're independent.
        const [act, geo] = await Promise.all([
          getActivity(token, id),
          getRouteGeoJSON(token, id),
        ]);
        if (!active) return;
        setActivity(act);
        setRoute(geoJSONToLatLng(geo));
        setElevation(elevationSeries(geo));
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

  const region = regionForRoute(route);

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
          {/* Map with the route polyline + start/end markers */}
          {region && route.length >= 2 ? (
            <MapView
              provider={PROVIDER_DEFAULT}
              style={{ height: 260, borderRadius: 16 }}
              initialRegion={region}
              scrollEnabled
              zoomEnabled
            >
              <Polyline coordinates={route} strokeColor={colors.primary} strokeWidth={4} />
              <Marker coordinate={route[0]} title="Start" pinColor="green" />
              <Marker coordinate={route[route.length - 1]} title="Finish" pinColor="red" />
            </MapView>
          ) : (
            <View
              style={{
                height: 160,
                borderRadius: 16,
                backgroundColor: colors.bgSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.muted }}>No route to display</Text>
            </View>
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

          {/* Stat tiles */}
          <StatRow>
            <StatCard label="Time" value={formatDuration(activity.duration_s)} />
            <StatCard label="Pace" value={formatPace(activity.avg_pace_s_per_km)} />
          </StatRow>
          <StatRow>
            <StatCard label="Speed" value={formatSpeed(activity.distance_m, activity.duration_s)} />
            <StatCard
              label="Elev gain"
              value={formatElevation(activity.elevation_gain_m)}
              valueColor={colors.success}
            />
          </StatRow>

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
