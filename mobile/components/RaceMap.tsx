// RaceMap: the race calendar's map view. One pin per city that has races (a
// count badge on each), since races carry a city — not a venue lat/lng. Tap a
// pin to open a card listing that city's races; tap a race to open its event
// page. The pin set reflects whatever filters are active on the calendar, so
// the map and the list always agree.

import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadow } from "../lib/theme";
import { cityCoord } from "../lib/raceGeo";
import { dateBlock, shortDist, type Race } from "../lib/races";

type Cluster = { city: string; latitude: number; longitude: number; races: Race[] };

// Whole-of-India fallback when nothing is plottable.
const INDIA_REGION = { latitude: 22.5, longitude: 80.0, latitudeDelta: 26, longitudeDelta: 26 };

export function RaceMap({ races, onPressRace }: { races: Race[]; onPressRace: (r: Race) => void }) {
  const clusters = useMemo(() => {
    const byCoord = new Map<string, Cluster>();
    for (const r of races) {
      const c = cityCoord(r.city);
      if (!c) continue;
      const key = `${c.latitude},${c.longitude}`;
      const existing = byCoord.get(key);
      if (existing) existing.races.push(r);
      else byCoord.set(key, { city: r.city, latitude: c.latitude, longitude: c.longitude, races: [r] });
    }
    return [...byCoord.values()];
  }, [races]);

  const plotted = clusters.reduce((n, c) => n + c.races.length, 0);
  const unmapped = races.length - plotted;

  // Frame all pins (with padding); fall back to all-India.
  const region = useMemo(() => {
    if (clusters.length === 0) return INDIA_REGION;
    const lats = clusters.map((c) => c.latitude);
    const lngs = clusters.map((c) => c.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.5, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.5, (maxLng - minLng) * 1.6),
    };
  }, [clusters]);

  const [selected, setSelected] = useState<Cluster | null>(null);

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        onPress={() => setSelected(null)}
        showsPointsOfInterest={false}
      >
        {clusters.map((cl) => (
          <Marker
            key={`${cl.latitude},${cl.longitude}`}
            coordinate={{ latitude: cl.latitude, longitude: cl.longitude }}
            onPress={() => setSelected(cl)}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View style={{ alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: selected?.city === cl.city ? colors.primaryDark : colors.primary, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1.5, borderColor: "#fff", ...shadow.md }}>
                <Ionicons name="flag" size={11} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{cl.races.length}</Text>
              </View>
              <View style={{ width: 2, height: 7, backgroundColor: "#fff" }} />
            </View>
          </Marker>
        ))}
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
      {clusters.length === 0 && (
        <View style={{ position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, ...shadow.md }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>No races to place on the map.</Text>
        </View>
      )}

      {/* Tapped-city card */}
      {selected && (
        <View style={{ position: "absolute", left: 12, right: 12, bottom: 14, backgroundColor: colors.bg, borderRadius: radius.xl, padding: 14, maxHeight: 290, ...shadow.lg, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
            <Ionicons name="location" size={16} color={colors.primary} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, marginLeft: 6, flex: 1 }} numberOfLines={1}>
              {selected.city} · {selected.races.length} race{selected.races.length > 1 ? "s" : ""}
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
            {selected.races.map((r) => {
              const d = dateBlock(r.race_date);
              const dists = r.distances ? r.distances.split("·").map((t) => t.trim()).filter(Boolean) : [];
              return (
                <Pressable
                  key={r.id}
                  onPress={() => onPressRace(r)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider }}
                >
                  <View style={{ width: 44, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", paddingVertical: 6 }}>
                    <Text style={{ color: colors.primary, fontWeight: "900", fontSize: 15, lineHeight: 17 }}>{d.day}</Text>
                    <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 9, letterSpacing: 0.5 }}>{d.month}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13.5 }} numberOfLines={1}>{r.title}</Text>
                    {dists.length > 0 && (
                      <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{dists.map(shortDist).join(" · ")}</Text>
                    )}
                  </View>
                  {r.going ? <Ionicons name="heart" size={15} color={colors.primary} /> : <Ionicons name="chevron-forward" size={16} color={colors.subtle} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
