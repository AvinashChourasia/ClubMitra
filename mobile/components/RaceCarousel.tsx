// RaceCarousel: the "Upcoming marathons" teaser on Home — a horizontally
// snapping strip of immersive, poster-style tiles (the look of Luma / Airbnb /
// App Store "Today" cards): a full-bleed event banner, an ink scrim, and all the
// content — date, countdown, title, city, distances — laid over the image so the
// card reads as one cohesive poster. Tiles glide + fade in (staggered) and
// spring on press. Tapping hands off to the caller; "See all" lives in the Home
// section header. The next card peeks at the edge to invite the swipe.

import { useEffect, useRef } from "react";
import { Animated, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { Tap } from "./Tap";
import { colors, styles, gradients, radius, shadow } from "../lib/theme";
import { dateBlock, countdownLabel, shortDist, type Race } from "../lib/races";

// Strong toward the bottom so overlaid text stays legible over any photo.
const SCRIM = ["rgba(2,6,23,0)", "rgba(2,6,23,0.15)", "rgba(2,6,23,0.6)", "rgba(2,6,23,0.94)"] as const;
const CARD_W = 300;
const CARD_H = 208;
const GAP = 14;

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
      { translateX: mount.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
      { scale: mount.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
    ],
  };

  return (
    <Animated.View style={[styles.card, { width: CARD_W, padding: 0 }, animatedStyle]}>
      <Tap onPress={onPress} scaleTo={0.97} style={{ height: CARD_H, borderRadius: radius.xl, overflow: "hidden" }}>
        {/* Banner — real photo, or a branded gradient with a faint flag motif */}
        {r.image_url ? (
          <Image source={{ uri: r.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <LinearGradient colors={gradients.red} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
            <Ionicons name="flag" size={150} color="rgba(255,255,255,0.10)" style={{ position: "absolute", right: -18, top: -14, transform: [{ rotate: "12deg" }] }} />
          </LinearGradient>
        )}
        <LinearGradient colors={SCRIM} locations={[0, 0.4, 0.72, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />

        {/* Glassy date badge, top-left */}
        <View style={{ position: "absolute", top: 12, left: 12, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 13, paddingHorizontal: 11, paddingVertical: 7, alignItems: "center", ...shadow.sm }}>
          <Text style={{ color: "#0F172A", fontSize: 17, fontWeight: "900", letterSpacing: -0.5, lineHeight: 19 }}>{d.day}</Text>
          <Text style={{ color: "#E11D2E", fontSize: 9.5, fontWeight: "800", letterSpacing: 1 }}>{d.month}</Text>
        </View>

        {/* Top-right cluster: saved heart + countdown */}
        <View style={{ position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {r.going ? (
            <View style={{ width: 27, height: 27, borderRadius: 13.5, backgroundColor: "rgba(225,29,46,0.95)", alignItems: "center", justifyContent: "center", ...shadow.sm }}>
              <Ionicons name="heart" size={14} color="#fff" />
            </View>
          ) : null}
          {cd ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: cd.urgent ? "rgba(225,29,46,0.96)" : "rgba(15,23,42,0.6)" }}>
              <Ionicons name={cd.urgent ? "flame" : "time-outline"} size={11} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{cd.label}</Text>
            </View>
          ) : null}
        </View>

        {/* Content, overlaid on the bottom of the poster */}
        <View style={{ position: "absolute", left: 14, right: 14, bottom: 13, gap: 9 }}>
          <View>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 17, letterSpacing: -0.3, lineHeight: 21, textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 7, textShadowOffset: { width: 0, height: 1 } }} numberOfLines={2}>
              {r.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
              <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.92)" />
              <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 12.5, fontWeight: "600", flex: 1 }} numberOfLines={1}>{r.city}</Text>
            </View>
          </View>
          {distances.length > 0 ? (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {distances.slice(0, 4).map((t) => (
                <View key={t} style={{ backgroundColor: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{shortDist(t)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Tap>
    </Animated.View>
  );
}
