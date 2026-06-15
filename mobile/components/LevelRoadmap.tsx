// LevelRoadmap: the runner's level journey as a vertical roadmap — Rookie all
// the way up to Club Legend, with the XP each rung costs. The spine fills gold
// up to where you are (partway through your current rung), reached rungs sit
// proud, the rung you're on glows with a "YOU ARE HERE" tag, and the ones ahead
// wait in greyscale. One glance answers "where am I and what's next?".

import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";

import { LEVELS } from "../lib/gamification";
import { colors, glow } from "../lib/theme";

const GOLD = "#FACC15";

export function LevelRoadmap({ xp }: { xp: number }) {
  // The rung you're on = highest threshold you've crossed.
  let current = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].at) current = i;

  return (
    <View style={{ gap: 0 }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 10 }}>
        YOUR JOURNEY
      </Text>
      {LEVELS.map((lvl, i) => {
        const reached = xp >= lvl.at;
        const isCurrent = i === current;
        const isLast = i === LEVELS.length - 1;

        // Fill of the spine segment BELOW this node (towards the next rung):
        // full once you've reached the next rung, partial while you're climbing
        // toward it, empty when this rung is still locked.
        let segFill = 0;
        if (!isLast) {
          const next = LEVELS[i + 1];
          if (xp >= next.at) segFill = 1;
          else if (reached) segFill = Math.max(0, Math.min(1, (xp - lvl.at) / (next.at - lvl.at)));
        }

        const remaining = lvl.at - xp; // >0 only for locked rungs

        return (
          <View key={lvl.title} style={{ flexDirection: "row", gap: 14 }}>
            {/* Spine gutter: node + connecting line */}
            <View style={{ width: 46, alignItems: "center" }}>
              <Node emoji={lvl.emoji} reached={reached} isCurrent={isCurrent} index={i} />
              {!isLast && (
                <View style={{ flex: 1, width: 4, backgroundColor: colors.border, borderRadius: 2, marginVertical: 2, overflow: "hidden" }}>
                  <View style={{ width: "100%", height: `${segFill * 100}%`, backgroundColor: GOLD, borderRadius: 2 }} />
                </View>
              )}
            </View>

            {/* Rung label + state */}
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : 22, paddingTop: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{
                    color: reached ? colors.text : colors.muted,
                    fontSize: 16,
                    fontWeight: "800",
                    letterSpacing: -0.2,
                  }}
                >
                  {lvl.title}
                </Text>
                {isCurrent && (
                  <View style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: "#fff", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6 }}>YOU ARE HERE</Text>
                  </View>
                )}
                {reached && !isCurrent && <Text style={{ color: GOLD, fontSize: 13, fontWeight: "900" }}>✓</Text>}
              </View>

              <Text style={{ color: colors.subtle, fontSize: 12.5, fontWeight: "600", marginTop: 2 }}>
                {lvl.at === 0 ? "Where every runner starts" : `${lvl.at.toLocaleString()} XP`}
              </Text>

              {/* The motivating line: how close you are to THIS rung / the next. */}
              {isCurrent && !isLast ? (
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
                  {(LEVELS[i + 1].at - xp).toLocaleString()} XP to {LEVELS[i + 1].title}
                </Text>
              ) : isCurrent && isLast ? (
                <Text style={{ color: GOLD, fontSize: 12, fontWeight: "800", marginTop: 4 }}>Top of the ladder 🏆</Text>
              ) : !reached && remaining > 0 ? (
                <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: "600", marginTop: 4 }}>
                  {remaining.toLocaleString()} XP away
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// One rung medallion. Reached = gold; current = gold + a pulsing glow ring;
// locked = grey dashed.
function Node({ emoji, reached, isCurrent, index }: { emoji: string; reached: boolean; isCurrent: boolean; index: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isCurrent) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isCurrent, pulse]);

  const size = isCurrent ? 46 : 40;

  return (
    <View style={{ width: 46, height: 46, alignItems: "center", justifyContent: "center" }}>
      {isCurrent && (
        <Animated.View
          style={{
            position: "absolute",
            width: 46,
            height: 46,
            borderRadius: 23,
            borderWidth: 2,
            borderColor: colors.primary,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
          }}
        />
      )}
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: reached ? "rgba(250,204,21,0.18)" : colors.bgSecondary,
            borderWidth: reached ? 2 : 1.5,
            borderColor: reached ? GOLD : colors.border,
            borderStyle: reached ? "solid" : "dashed",
          },
          isCurrent ? glow(colors.primary, 0.5) : null,
        ]}
      >
        <Text style={{ fontSize: isCurrent ? 22 : 18, opacity: reached ? 1 : 0.45 }}>{emoji}</Text>
      </View>
      {/* tiny level number badge */}
      <View
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          minWidth: 16,
          height: 16,
          paddingHorizontal: 3,
          borderRadius: 8,
          backgroundColor: reached ? GOLD : colors.subtle,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: reached ? "#1A1206" : colors.bg, fontSize: 9.5, fontWeight: "900" }}>{index + 1}</Text>
      </View>
    </View>
  );
}
