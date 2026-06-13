// RaceCarousel: the "Upcoming marathons" teaser on Home — a horizontally
// snapping strip of hero tiles that reuse the calendar's visual language (event
// banner + ink scrim + glassy date badge + smart countdown + distance chips).
// Tiles slide + fade in, staggered, and spring on press. Tapping a tile hands
// off to the caller (open the event page); "See all" lives in the section
// header on Home.

import { useEffect, useRef } from "react";
import { Animated, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { Tap } from "./Tap";
import { colors, styles, gradients, radius, shadow } from "../lib/theme";
import { dateBlock, countdownLabel, shortDist, type Race } from "../lib/races";

const SCRIM = ["rgba(2,6,23,0)", "rgba(2,6,23,0.45)", "rgba(2,6,23,0.92)"] as const;
const CARD_W = 280;
const GAP = 12;

export function RaceCarousel({ races, onPressRace }: { races: Race[]; onPressRace: (r: Race) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: GAP, paddingRight: 4, paddingVertical: 2 }}
      decelerationRate="fast"
      snapToInterval={CARD_W + GAP}
      snapToAlignment="start"
    >
      {races.map((r, i) => (
        <RaceTile key={r.id} race={r} index={i} onPress={() => onPressRace(r)} />
      ))}
    </ScrollView>
  );
}

function RaceTile({ race: r, index, onPress }: { race: Race; index: number; onPress: () => void }) {
  const d = dateBlock(r.race_date);
  const cd = countdownLabel(r.race_date);
  const distances = r.distances ? r.distances.split("·").map((t) => t.trim()).filter(Boolean) : [];

  // Light, staggered entrance — tiles glide in from the right as you land.
  const mount = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(mount, {
      toValue: 1,
      useNativeDriver: true,
      delay: Math.min(index, 6) * 70,
      speed: 12,
      bounciness: 6,
    }).start();
  }, [mount, index]);
  const animatedStyle = {
    opacity: mount,
    transform: [
      { translateX: mount.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
      { scale: mount.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  };

  return (
    <Animated.View style={[styles.card, { width: CARD_W, padding: 0 }, animatedStyle]}>
      <Tap onPress={onPress} scaleTo={0.97} style={{ borderRadius: radius.xl, overflow: "hidden" }}>
        <View style={{ height: 150 }}>
          {r.image_url ? (
            <Image source={{ uri: r.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <LinearGradient colors={gradients.red} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: "100%", height: "100%" }} />
          )}
          <LinearGradient colors={SCRIM} locations={[0, 0.5, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />

          {/* Glassy date badge */}
          <View style={{ position: "absolute", top: 10, left: 10, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center", ...shadow.sm }}>
            <Text style={{ color: "#0F172A", fontSize: 16, fontWeight: "900", letterSpacing: -0.5, lineHeight: 18 }}>{d.day}</Text>
            <Text style={{ color: "#E11D2E", fontSize: 9.5, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
          </View>

          {/* Top-right: saved heart + countdown */}
          <View style={{ position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {r.going ? (
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(225,29,46,0.95)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="heart" size={13} color="#fff" />
              </View>
            ) : null}
            {cd ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: cd.urgent ? "rgba(225,29,46,0.95)" : "rgba(2,6,23,0.55)" }}>
                <Ionicons name={cd.urgent ? "flame" : "time-outline"} size={11} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{cd.label}</Text>
              </View>
            ) : null}
          </View>

          {/* Title + city, overlaid on the scrim */}
          <View style={{ position: "absolute", left: 12, right: 12, bottom: 10 }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: -0.3, textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }} numberOfLines={2}>
              {r.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
              <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.9)" />
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 11.5, fontWeight: "600", flex: 1 }} numberOfLines={1}>{r.city}</Text>
            </View>
          </View>
        </View>

        {/* Footer: scannable distance chips */}
        {distances.length > 0 ? (
          <View style={{ flexDirection: "row", gap: 5, padding: 10, alignItems: "center" }}>
            {distances.slice(0, 4).map((t) => (
              <View key={t} style={{ backgroundColor: colors.primarySoft, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800" }}>{shortDist(t)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Tap>
    </Animated.View>
  );
}
