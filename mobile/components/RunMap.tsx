// RunMap — the interactive geospatial map for a run, on react-native-maps
// (Apple Maps on iOS — no key; Google Maps on Android via the manifest API key).
// Night-styled on both platforms. The route is a pace-coloured line (green =
// fast → red = slow); per-km split markers sit along it and are tappable; a
// recenter control reframes the whole route. In live mode the camera follows
// the runner (until they pan — then a locate button restores follow) and the
// head is a pulsing "current position" dot.
//
// Android notes (react-native-maps 1.20, old arch) — each defended here:
//  • Polyline strokeColors gradients are iOS-MapKit-only → we draw per-segment
//    polylines for the pace ramp instead (same look, works everywhere).
//  • Re-sending a growing coords array every second rebuilds the whole native
//    polyline → in live mode the trace is CHUNKED: completed chunks keep stable
//    array identities (never re-sent), only a small tail updates per fix.
//  • borderRadius+overflow on the map itself can blank the tiles → the rounded
//    clip lives on a wrapper View and the MapView is absoluteFill inside it.
//  • userInterfaceStyle is iOS-only → Android gets a customMapStyle night JSON.
//  • Markers freeze with tracksViewChanges=false; we flip it on briefly when a
//    split's selection changes so the restyle paints, then freeze again.
//
// Native map module, so this is only mounted in a standalone build — Expo Go
// falls back to the SVG RouteTrace.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import MapView, { Circle as MapCircle, Marker, Polyline, type MapType, type Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

import type { LatLng } from "../lib/activities";
import { computeSplits, paceColorRamp } from "../lib/pace";
import { useReplay } from "../lib/useReplay";
import { colors } from "../lib/theme";

type Props = {
  coords: LatLng[];
  times?: number[];
  /** Fixed height; omit to fill the parent (flex: 1) — the fullscreen map mode. */
  height?: number;
  /** Live mode: camera follows the runner; head is a pulsing current-position dot. */
  live?: boolean;
  /** Which km split is highlighted (driven by the splits list); camera flies to it. */
  selectedKm?: number | null;
  onSelectKm?: (km: number | null) => void;
  style?: ViewStyle;
};

const EDGE = { top: 48, right: 48, bottom: 48, left: 48 };
// Live-trace chunking: completed chunks of this many points are frozen (stable
// array identity → the native polyline is never rebuilt); only the tail grows.
const CHUNK = 200;
// Static pace trace: cap the per-segment polylines so a long run stays light.
const MAX_MAP_SEGMENTS = 120;

// Night map style for Android/Google Maps (userInterfaceStyle is iOS-only).
// Google's canonical night theme, trimmed: dark geometry, readable roads,
// POI/transit hidden so the route line owns the view; parks kept (runners).
// Apple Maps ignores customMapStyle, so passing it unconditionally is safe.
// Module-scope constant = stable reference (never re-sent to native).
export const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#263c3f" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
];

export function RunMap({ coords, times, height, live = false, selectedKm = null, onSelectKm, style }: Props) {
  const mapRef = useRef<MapView>(null);
  const region = useMemo(() => regionFor(coords), [coords]);
  const splits = useMemo(() => (live ? [] : computeSplits(coords, times)), [coords, times, live]);
  const [ready, setReady] = useState(false);
  const [laidOut, setLaidOut] = useState(false); // camera calls before layout get dropped on Android
  const [mapType, setMapType] = useState<MapType>("standard");
  const replay = useReplay(coords, times); // animated retrace (saved runs only)

  // Live follow-me pauses when the runner pans (the map must never fight a
  // finger); the locate button re-enables it.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);

  const head = coords[coords.length - 1];
  const satellite = mapType !== "standard";

  // Live trace, chunked. Completed chunks are memoized keyed ONLY on how many
  // exist — the track is append-only, so their contents never change and their
  // identities stay stable across the 1 Hz polls. Chunks overlap by one point
  // so the line has no gaps. When a NEW chunk completes, earlier chunks are
  // reused from the previous compute (the ref) — re-slicing them all would hand
  // every Polyline a fresh coordinates identity and re-marshal the whole route
  // to native in one frame (a growing jank spike every ~3 minutes).
  const chunkCount = live ? Math.floor(Math.max(0, coords.length - 1) / CHUNK) : 0;
  const prevChunksRef = useRef<LatLng[][]>([]);
  const frozenChunks = useMemo(() => {
    const prev = prevChunksRef.current;
    const out: LatLng[][] = [];
    for (let i = 0; i < chunkCount; i++) out.push(prev[i] ?? coords.slice(i * CHUNK, (i + 1) * CHUNK + 1));
    prevChunksRef.current = out;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkCount]);
  const liveTail = useMemo(() => (live ? coords.slice(chunkCount * CHUNK) : []), [live, coords, chunkCount]);

  // Static (saved-run) trace: per-segment polylines carrying the pace ramp —
  // works on Android where Polyline strokeColors (iOS MapKit) silently doesn't.
  const paceSegs = useMemo(() => {
    if (live || coords.length < 2) return null;
    const ramp = times ? paceColorRamp(coords, times) : null;
    if (!ramp) return null;
    const step = Math.max(1, Math.ceil(coords.length / MAX_MAP_SEGMENTS));
    // Consecutive segments share exactly one boundary point (prev's end = next's
    // start) — never re-slice from `end - step`, or the final partial segment
    // overlaps the previous one and double-draws the line.
    const segs: { pts: LatLng[]; color: string }[] = [];
    let prev = 0;
    while (prev < coords.length - 1) {
      const end = Math.min(prev + step, coords.length - 1);
      segs.push({ pts: coords.slice(prev, end + 1), color: ramp[end] ?? colors.primary });
      prev = end;
    }
    return segs;
  }, [live, coords, times]);

  // Markers paint their custom views only while tracksViewChanges is on; flip
  // it on briefly whenever the selection (or live flag) changes style, then
  // freeze for smooth panning + no Android bitmap-redraw battery drain.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(t);
  }, [selectedKm, live, splits.length]);

  // Frame the whole route once the map is ready (and when the route changes, for
  // the static detail view). Live mode skips this — the follow effect owns the camera.
  useEffect(() => {
    if (!ready || !laidOut || live || coords.length < 2) return;
    mapRef.current?.fitToCoordinates(coords, { edgePadding: EDGE, animated: false });
  }, [ready, laidOut, live, coords]);

  // Live: keep the camera centred on the runner as fixes arrive. Partial camera
  // (center only) preserves the user's pinch-zoom; ~800ms chains smoothly at a
  // 1s fix cadence without queuing.
  useEffect(() => {
    if (!ready || !laidOut || !live || !follow || !head) return;
    mapRef.current?.animateCamera({ center: head }, { duration: 800 });
  }, [ready, laidOut, live, follow, head]);

  // Selecting a split (from the list) flies the camera to that kilometre.
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
    // Honour the same sizing contract as the real map (fixed height OR flex
    // fill) so fullscreen mode doesn't collapse to a strip while waiting.
    return (
      <View
        style={[
          height != null ? { height } : { flex: 1 },
          { borderRadius: 16, backgroundColor: "#0B1220", alignItems: "center", justifyContent: "center" },
          style,
        ]}
      >
        {live && <Text style={{ color: "#64748B", fontSize: 13, fontWeight: "700" }}>Waiting for GPS…</Text>}
      </View>
    );
  }

  return (
    // Rounded clip lives on the WRAPPER (explicit bg) — borderRadius+overflow
    // directly around a Google MapView can blank the tiles on Android.
    <View
      style={[height != null ? { height } : { flex: 1 }, { borderRadius: 16, overflow: "hidden", backgroundColor: "#0B1220" }, style]}
      onLayout={(e) => setLaidOut(e.nativeEvent.layout.height > 0)}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType={mapType}
        userInterfaceStyle="dark"
        customMapStyle={mapType === "standard" ? DARK_MAP_STYLE : undefined}
        onMapReady={() => setReady(true)}
        onPanDrag={
          live
            ? () => {
                if (followRef.current) {
                  followRef.current = false;
                  setFollow(false);
                }
              }
            : undefined
        }
        scrollEnabled
        zoomEnabled
        pitchEnabled={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
      >
        {/* Route line: live = frozen chunks + growing tail; saved = pace segments */}
        {live ? (
          <>
            {frozenChunks.map((c, i) => (
              <Polyline key={`chunk-${i}`} coordinates={c} strokeColor={colors.primary} strokeWidth={5} />
            ))}
            {liveTail.length >= 2 && <Polyline coordinates={liveTail} strokeColor={colors.primary} strokeWidth={5} />}
          </>
        ) : paceSegs ? (
          paceSegs.map((s, i) => <Polyline key={`seg-${i}`} coordinates={s.pts} strokeColor={s.color} strokeWidth={5} />)
        ) : (
          <Polyline coordinates={coords} strokeColor={colors.primary} strokeWidth={5} />
        )}

        {/* Start dot */}
        <Marker coordinate={coords[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
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
              tracksViewChanges={tracks}
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
        <Marker coordinate={head} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
          <Dot color={live ? colors.primary : colors.danger} ring pulse={live} />
        </Marker>

        {/* Replay cursor retracing the run (saved runs only). */}
        {!live && replay.cursor && (
          <Marker coordinate={replay.cursor} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={replay.playing}>
            <Dot color={colors.accent} ring pulse />
          </Marker>
        )}
      </MapView>

      {/* Controls: recenter/follow + standard/satellite toggle */}
      <View style={{ position: "absolute", top: 10, right: 10, gap: 8 }}>
        {live ? (
          !follow && (
            <CtrlButton
              icon="locate"
              onPress={() => {
                followRef.current = true;
                setFollow(true);
                if (head) mapRef.current?.animateCamera({ center: head }, { duration: 500 });
              }}
            />
          )
        ) : (
          <CtrlButton icon="scan-outline" onPress={() => mapRef.current?.fitToCoordinates(coords, { edgePadding: EDGE, animated: true })} />
        )}
        <CtrlButton
          icon={satellite ? "map" : "earth"}
          active={satellite}
          onPress={() => setMapType(satellite ? "standard" : "hybrid")}
        />
      </View>

      {/* Replay: retrace the run with an animated cursor (saved runs only) */}
      {!live && coords.length >= 2 && (
        <Pressable
          onPress={replay.toggle}
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: replay.playing ? colors.primary : "rgba(15,23,42,0.85)",
            borderRadius: 999,
            paddingLeft: 10,
            paddingRight: 12,
            paddingVertical: 7,
          }}
          hitSlop={8}
        >
          <Ionicons name={replay.playing ? "pause" : "play"} size={14} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Replay</Text>
        </Pressable>
      )}

      {/* Pace legend (saved runs with a ramp) */}
      {paceSegs && (
        <View style={{ position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(15,23,42,0.85)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#4ADE80" }}>fast</Text>
          <View style={{ width: 34, height: 5, borderRadius: 3, backgroundColor: "#F59E0B" }} />
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#F87171" }}>slow</Text>
        </View>
      )}
    </View>
  );
}

// PreStartMap — the "locking on" view for the pre-start screen: a night map
// centred on the runner with a pulsing position dot and an accuracy halo that
// visibly SHRINKS as the GPS locks (Strava's pattern: small halo = strong
// signal). Non-interactive — it's a status display, not a map to wander.
export function PreStartMap({ coord, accuracyM, height = 170 }: { coord: LatLng; accuracyM?: number | null; height?: number }) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [laidOut, setLaidOut] = useState(false);

  // Glide to each improving fix (partial camera keeps the fixed zoom).
  useEffect(() => {
    if (!ready || !laidOut) return;
    mapRef.current?.animateCamera({ center: coord }, { duration: 800 });
  }, [ready, laidOut, coord]);

  return (
    <View
      style={{ height, borderRadius: 16, overflow: "hidden", backgroundColor: "#0B1220" }}
      onLayout={(e) => setLaidOut(e.nativeEvent.layout.height > 0)}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: coord.latitude, longitude: coord.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
        userInterfaceStyle="dark"
        customMapStyle={DARK_MAP_STYLE}
        onMapReady={() => setReady(true)}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
      >
        {/* Accuracy halo — shrinks as the fix tightens. Capped so a coarse
            network fix doesn't paint the whole city blue. */}
        {accuracyM != null && accuracyM > 0 && accuracyM < 400 && (
          <MapCircle
            center={coord}
            radius={accuracyM}
            strokeColor="rgba(96,165,250,0.55)"
            strokeWidth={1}
            fillColor="rgba(96,165,250,0.12)"
          />
        )}
        <Marker coordinate={coord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <Dot color={colors.accent} ring pulse />
        </Marker>
      </MapView>
    </View>
  );
}

// CtrlButton is a round map overlay button (recenter, layer toggle).
function CtrlButton({ icon, onPress, active }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: active ? colors.primary : "rgba(15,23,42,0.85)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={18} color="#fff" />
    </Pressable>
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
