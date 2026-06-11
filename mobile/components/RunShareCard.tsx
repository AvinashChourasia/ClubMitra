// RunShareCard: the run as a picture — what actually gets posted to WhatsApp /
// Instagram. A dark 4:5 card: pace-gradient route trace as the hero, the
// distance huge, the stats that matter, ClubMitra branding. Pure RN + SVG
// (no native deps) so it renders everywhere; capturing it to a PNG is the
// caller's job (react-native-view-shot, lazily required).

import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { RouteTrace } from "./RouteTrace";
import { formatDistance, formatDuration, formatPace } from "../lib/format";
import type { LatLng } from "../lib/activities";

export const SHARE_CARD_WIDTH = 340;

type Props = {
  runnerName: string;
  startedAt: string; // ISO
  distanceM: number;
  durationS: number; // moving time
  avgPaceSPerKm?: number | null;
  bestSplitSPerKm?: number | null;
  coords: LatLng[];
  times?: number[];
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2 }}>{label}</Text>
      <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.3, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function RunShareCard({ runnerName, startedAt, distanceM, durationS, avgPaceSPerKm, bestSplitSPerKm, coords, times }: Props) {
  const when = new Date(startedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const fullKm = distanceM >= 1000;

  return (
    <LinearGradient
      colors={["#101A30", "#0B1220"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={{ width: SHARE_CARD_WIDTH, borderRadius: 26, padding: 20, gap: 14, overflow: "hidden" }}
    >
      {/* Header: brand left, date right */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: "#E11D2E", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 12 }}>🏃</Text>
          </View>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 13, letterSpacing: 0.3 }}>ClubMitra</Text>
        </View>
        <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11.5, fontWeight: "700" }}>{when}</Text>
      </View>

      {/* The route is the picture */}
      {coords.length >= 2 ? (
        <View style={{ borderRadius: 18, backgroundColor: "rgba(255,255,255,0.05)", paddingVertical: 10 }}>
          <RouteTrace coords={coords} times={times} height={180} weight={4.5} />
        </View>
      ) : (
        <View style={{ borderRadius: 18, backgroundColor: "rgba(255,255,255,0.05)", height: 120, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 34 }}>🏃</Text>
        </View>
      )}

      {/* Distance owns the card */}
      <View>
        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 }}>DISTANCE</Text>
        <Text style={{ color: "#fff", fontSize: 46, fontWeight: "900", letterSpacing: -1.5, marginTop: -2 }}>
          {formatDistance(distanceM)}
        </Text>
      </View>

      {/* The stats that matter (pace family only on 1 km+ runs) */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat label="TIME" value={formatDuration(durationS)} />
        {fullKm && avgPaceSPerKm ? <Stat label="PACE" value={formatPace(avgPaceSPerKm)} /> : null}
        {fullKm && bestSplitSPerKm ? <Stat label="BEST KM" value={formatPace(bestSplitSPerKm)} /> : null}
      </View>

      {/* Footer: who ran */}
      <View style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", paddingTop: 12 }}>
        <Text style={{ flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "800" }} numberOfLines={1}>
          {runnerName}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 }}>
          GPS-tracked · clubmitra
        </Text>
      </View>
    </LinearGradient>
  );
}
