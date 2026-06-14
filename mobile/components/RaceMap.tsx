// RaceMap: the race calendar's map view. One flag PER RACE, labelled with the
// event name; tap a flag to open its MarathonMitra event page (same as a card).
//
// The MarathonMitra feed gives a city + venue text but no lat/lng, so races in
// the same city are fanned out on a deterministic phyllotaxis spiral around the
// city centre — each race gets its own pin that separates as you zoom in, rather
// than collapsing into a single count. The pin set reflects the calendar's
// active filters, so the map and the list always agree.

import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadow } from "../lib/theme";
import { cityCoord } from "../lib/raceGeo";
import { type Race } from "../lib/races";

type Pin = { race: Race; latitude: number; longitude: number };

// Whole-of-India fallback when nothing is plottable.
const INDIA_REGION = { latitude: 22.5, longitude: 80.0, latitudeDelta: 26, longitudeDelta: 26 };
const SPREAD = 0.03; // ~3.3km max fan-out radius around a city centre
const GOLDEN = 2.399963; // golden angle → even spiral distribution

export function RaceMap({ races, onPressRace }: { races: Race[]; onPressRace: (r: Race) => void }) {
  // One pin per race. Races sharing a city are spiral-spread around its centre.
  const pins = useMemo(() => {
    const groups = new Map<string, { lat: number; lng: number; races: Race[] }>();
    for (const r of races) {
      const c = cityCoord(r.city);
      if (!c) continue;
      const key = `${c.latitude},${c.longitude}`;
      const g = groups.get(key) ?? { lat: c.latitude, lng: c.longitude, races: [] };
      g.races.push(r);
      groups.set(key, g);
    }
    const out: Pin[] = [];
    for (const g of groups.values()) {
      const n = g.races.length;
      const lngScale = Math.cos((g.lat * Math.PI) / 180) || 1; // keep the spread circular at this latitude
      g.races.forEach((race, i) => {
        if (n === 1) {
          out.push({ race, latitude: g.lat, longitude: g.lng });
          return;
        }
        const r = SPREAD * Math.sqrt(i / (n - 1)); // even area fill, 0 → SPREAD
        const a = i * GOLDEN;
        out.push({
          race,
          latitude: g.lat + r * Math.cos(a),
          longitude: g.lng + (r * Math.sin(a)) / lngScale,
        });
      });
    }
    return out;
  }, [races]);

  const unmapped = races.length - pins.length;

  // Frame all pins (with padding); fall back to all-India.
  const region = useMemo(() => {
    if (pins.length === 0) return INDIA_REGION;
    const lats = pins.map((p) => p.latitude);
    const lngs = pins.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.08, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.08, (maxLng - minLng) * 1.5),
    };
  }, [pins]);

  // Render markers "live" briefly so the custom label paints, then freeze them
  // for smooth panning (Android won't draw a tracksViewChanges=false marker that
  // hasn't measured yet).
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 900);
    return () => clearTimeout(t);
  }, [pins.length]);

  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} provider={PROVIDER_DEFAULT} initialRegion={region} showsPointsOfInterest={false}>
        {pins.map((p) => {
          const saved = p.race.going;
          const tint = saved ? colors.success : colors.primary;
          return (
            <Marker
              key={p.race.id}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              onPress={() => onPressRace(p.race)}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={tracks}
            >
              <View style={{ alignItems: "center", maxWidth: 168 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: tint,
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderWidth: 1.5,
                    borderColor: "#fff",
                    ...shadow.md,
                  }}
                >
                  <Ionicons name={saved ? "heart" : "flag"} size={10} color="#fff" />
                  <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "800", fontSize: 11, maxWidth: 134 }}>
                    {p.race.title}
                  </Text>
                </View>
                <View style={{ width: 2, height: 6, backgroundColor: "#fff" }} />
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint, borderWidth: 1.5, borderColor: "#fff", marginTop: -1 }} />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Heads-up when some races have no known location */}
      {unmapped > 0 && (
        <View style={{ position: "absolute", top: 10, alignSelf: "center", backgroundColor: "rgba(15,23,42,0.82)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="information-circle" size={13} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
            {unmapped} race{unmapped > 1 ? "s" : ""} not on map (location unknown)
          </Text>
        </View>
      )}

      {/* Empty hint */}
      {pins.length === 0 && (
        <View style={{ position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, ...shadow.md }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>No races to place on the map.</Text>
        </View>
      )}

      {/* Hint: tap a flag to open its event page */}
      {pins.length > 0 && (
        <View style={{ position: "absolute", bottom: 16, alignSelf: "center", backgroundColor: "rgba(15,23,42,0.82)", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="hand-left" size={12} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Tap a flag to open the event · pinch to zoom</Text>
        </View>
      )}
    </View>
  );
}
