// RunMap — the interactive geospatial map for a run, on react-native-maps (Apple
// Maps on iOS, no API key). Dark styled. The route is a pace-coloured polyline
// (green = fast → red = slow); per-km split markers sit along it and are
// tappable; a recenter control reframes the whole route. In live mode the camera
// follows the runner and the head is a pulsing "current position" dot.
//
// Native map module, so this is only mounted in a dev / standalone build — Expo
// Go falls back to the SVG RouteTrace.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

import type { LatLng } from "../lib/activities";
import { computeSplits, paceColorRamp } from "../lib/pace";
import { colors } from "../lib/theme";

type Props = {
  coords: LatLng[];
  times?: number[];
  height?: number;
  /** Live mode: camera follows the runner; head is a pulsing current-position dot. */
  live?: boolean;
  /** Which km split is highlighted (driven by the splits list); camera flies to it. */
  selectedKm?: number | null;
  onSelectKm?: (km: number | null) => void;
  style?: ViewStyle;
};

const EDGE = { top: 48, right: 48, bottom: 48, left: 48 };

export function RunMap({ coords, times, height = 260, live = false, selectedKm = null, onSelectKm, style }: Props) {
  const mapRef = useRef<MapView>(null);
  const region = useMemo(() => regionFor(coords), [coords]);
  const ramp = useMemo(() => (times ? paceColorRamp(coords, times) : null), [coords, times]);
  const splits = useMemo(() => (live ? [] : computeSplits(coords, times)), [coords, times, live]);
  const [ready, setReady] = useState(false);

  const head = coords[coords.length - 1];

  // Frame the whole route once the map is ready (and when the route changes, for
  // the static detail view). Live mode skips this — the follow effect owns the camera.
  useEffect(() => {
    if (!ready || live || coords.length < 2) return;
    mapRef.current?.fitToCoordinates(coords, { edgePadding: EDGE, animated: false });
  }, [ready, live, coords]);

  // Live: keep the camera centred on the runner as new fixes arrive.
  useEffect(() => {
    if (!ready || !live || !head) return;
    mapRef.current?.animateCamera({ center: head }, { duration: 600 });
  }, [ready, live, head]);

  // Selecting a split (from the list) flies the camera to that kilometre.
  // animateToRegion (with tight deltas) zooms reliably on Apple Maps, where the
  // camera's `zoom` field is ignored.
  useEffect(() => {
    if (!ready || selectedKm == null) return;
    const s = splits.find((x) => x.km === selectedKm);
    if (s) {
      mapRef.current?.animateToRegion(
        { latitude: s.coord.latitude, longitude: s.coord.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 },
        500
      );
    }
  }, [ready, selectedKm, splits]);

  if (!region || coords.length < 2) {
    return <View style={[{ height: 160, borderRadius: 16, backgroundColor: "#0B1220" }, style]} />;
  }

  return (
    <View style={[{ height, borderRadius: 16, overflow: "hidden", backgroundColor: "#0B1220" }, style]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={region}
        userInterfaceStyle="dark"
        onMapReady={() => setReady(true)}
        scrollEnabled
        zoomEnabled
        pitchEnabled={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <Polyline coordinates={coords} strokeColor={colors.primary} strokeColors={ramp ?? undefined} strokeWidth={5} />

        {/* Start dot */}
        <Marker coordinate={coords[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <Dot color={colors.success} ring />
        </Marker>

        {/* Per-km split markers (tappable). Selected one is enlarged + accented. */}
        {splits.map((s) => {
          const sel = s.km === selectedKm;
          return (
            <Marker
              key={s.km}
              coordinate={s.coord}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={sel}
              onPress={() => onSelectKm?.(sel ? null : s.km)}
            >
              <View
                style={{
                  minWidth: sel ? 26 : 20,
                  height: sel ? 26 : 20,
                  paddingHorizontal: 4,
                  borderRadius: 13,
                  backgroundColor: sel ? colors.primary : "rgba(15,23,42,0.85)",
                  borderWidth: 1.5,
                  borderColor: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: sel ? 12 : 10, fontWeight: "800" }}>{s.km}</Text>
              </View>
            </Marker>
          );
        })}

        {/* Head: pulsing current position when live, red finish flag when done. */}
        <Marker coordinate={head} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={live}>
          <Dot color={live ? colors.primary : colors.danger} ring pulse={live} />
        </Marker>
      </MapView>

      {/* Recenter control */}
      <Pressable
        onPress={() => mapRef.current?.fitToCoordinates(coords, { edgePadding: EDGE, animated: true })}
        style={{ position: "absolute", top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(15,23,42,0.85)", alignItems: "center", justifyContent: "center" }}
        hitSlop={8}
      >
        <Ionicons name="scan-outline" size={18} color="#fff" />
      </Pressable>

      {/* Pace legend */}
      {ramp && (
        <View style={{ position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(15,23,42,0.85)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#4ADE80" }}>fast</Text>
          <View style={{ width: 34, height: 5, borderRadius: 3, backgroundColor: "#F59E0B" }} />
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#F87171" }}>slow</Text>
        </View>
      )}
    </View>
  );
}

// Dot is a small marker disc with a white ring; the live head also gets a soft halo.
function Dot({ color, ring, pulse }: { color: string; ring?: boolean; pulse?: boolean }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", width: 26, height: 26 }}>
      {pulse && <View style={{ position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: color, opacity: 0.25 }} />}
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          borderWidth: ring ? 2.5 : 0,
          borderColor: "#fff",
        }}
      />
    </View>
  );
}

// regionFor frames the whole route with 40% padding (and a floor so a tiny run
// isn't absurdly zoomed). Used only as the initial region — fitToCoordinates
// refines it once the map is ready.
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
