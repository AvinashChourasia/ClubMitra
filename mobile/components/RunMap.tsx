// RunMap — the interactive geospatial map for a saved run, on react-native-maps
// (Apple Maps on iOS, no API key). The route is drawn as a polyline coloured by
// pace (green = fast → red = slow) when per-vertex times are available, with
// start/finish markers. Native map module, so this is only mounted in a dev /
// standalone build — Expo Go falls back to the SVG RouteTrace.

import { useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "react-native-maps";

import type { LatLng } from "../lib/activities";
import { paceColorRamp } from "../lib/pace";
import { colors } from "../lib/theme";

type Props = {
  coords: LatLng[];
  times?: number[];
  height?: number;
  style?: ViewStyle;
};

export function RunMap({ coords, times, height = 260, style }: Props) {
  const region = useMemo(() => regionFor(coords), [coords]);
  const ramp = useMemo(() => (times ? paceColorRamp(coords, times) : null), [coords, times]);

  if (!region || coords.length < 2) {
    return (
      <View style={[{ height: 160, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: "center", justifyContent: "center" }, style]} />
    );
  }

  return (
    <MapView
      provider={PROVIDER_DEFAULT}
      style={[{ height, borderRadius: 16 }, style]}
      initialRegion={region}
      scrollEnabled
      zoomEnabled
      pitchEnabled={false}
    >
      <Polyline
        coordinates={coords}
        strokeColor={colors.primary}
        // strokeColors gives a per-vertex pace gradient on iOS; falls back to the
        // solid strokeColor where unsupported or when no timing data exists.
        strokeColors={ramp ?? undefined}
        strokeWidth={5}
      />
      <Marker coordinate={coords[0]} title="Start" pinColor="green" />
      <Marker coordinate={coords[coords.length - 1]} title="Finish" pinColor="red" />
    </MapView>
  );
}

// regionFor frames the whole route: centre on its midpoint, with deltas padded
// out 40% so the line isn't flush against the edges (and a floor so a tiny run
// isn't absurdly zoomed in).
function regionFor(coords: LatLng[]): Region | null {
  if (coords.length < 2) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.003),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.003),
  };
}
