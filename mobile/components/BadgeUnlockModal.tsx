// BadgeUnlockModal: the full-screen unlock moment — confetti rains, the medal
// springs in with a wobble, XP counts. Multiple unlocks page through one by
// one ("Next" → "Done"). Mount it with the badges to celebrate; it owns the
// rest.

import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, Text, View } from "react-native";

import { BadgeMedal } from "./BadgeMedal";
import { Confetti } from "./Confetti";
import { tierColor, type Badge } from "../lib/gamification";
import { colors } from "../lib/theme";

export function BadgeUnlockModal({ badges, onClose }: { badges: Badge[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const pop = useRef(new Animated.Value(0)).current;
  const badge = badges[idx];
  const last = idx >= badges.length - 1;

  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
  }, [idx, pop]);

  if (!badge) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.88)", alignItems: "center", justifyContent: "center", padding: 28 }}>
        <Confetti />
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "800", letterSpacing: 2.5 }}>BADGE UNLOCKED</Text>
        <Animated.View
          style={{
            alignItems: "center",
            marginTop: 18,
            opacity: pop,
            transform: [
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
              { rotate: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: ["-14deg", "6deg", "0deg"] }) },
            ],
          }}
        >
          <BadgeMedal emoji={badge.emoji} color={tierColor(badge.tier)} size={170} />
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 14, textAlign: "center" }}>
            {badge.name}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 14.5, marginTop: 6, textAlign: "center" }}>{badge.desc}</Text>
          <View style={{ backgroundColor: "rgba(250,204,21,0.16)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 12 }}>
            <Text style={{ color: "#FACC15", fontWeight: "900", fontSize: 15 }}>+{badge.xp} XP</Text>
          </View>
        </Animated.View>

        {badges.length > 1 && (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 18 }}>
            {badges.map((_, i) => (
              <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === idx ? "#fff" : "rgba(255,255,255,0.3)" }} />
            ))}
          </View>
        )}

        <Pressable
          onPress={() => (last ? onClose() : setIdx((i) => i + 1))}
          style={{ marginTop: 26, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 44, paddingVertical: 14 }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{last ? "Let's go 🏃" : "Next badge →"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
