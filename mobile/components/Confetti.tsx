// Confetti: a one-shot celebration burst — paper pieces tumble from the top of
// the screen, drifting and spinning as they fall, then fade. Rendered over the
// whole parent (pointerEvents off). Mount it when the moment happens (e.g. a
// challenge goal completed); it plays once.

import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, View } from "react-native";

const PALETTE = ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#A855F7", "#FACC15"];
const COUNT = 26;

type Piece = {
  x: number; // start x
  drift: number; // horizontal sway distance
  size: number;
  color: string;
  duration: number;
  delay: number;
  spins: number;
};

function makePieces(width: number): Piece[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    x: (i / COUNT) * width + (Math.random() - 0.5) * 40,
    drift: (Math.random() - 0.5) * 90,
    size: 7 + Math.random() * 6,
    color: PALETTE[i % PALETTE.length],
    duration: 2300 + Math.random() * 1400,
    delay: Math.random() * 500,
    spins: 2 + Math.random() * 3,
  }));
}

function FallingPiece({ p, height }: { p: Piece; height: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: p.duration,
      delay: p.delay,
      easing: Easing.in(Easing.quad), // gravity: slow release, faster fall
      useNativeDriver: true,
    }).start();
  }, [t, p]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: -20,
        left: p.x,
        width: p.size,
        height: p.size * 1.7,
        borderRadius: 2,
        backgroundColor: p.color,
        opacity: t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.92] }) },
          // Sway out and back while falling, like real paper.
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.drift, p.drift * 0.4] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spins * 360}deg`] }) },
          { rotateX: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spins * 540}deg`] }) },
        ],
      }}
    />
  );
}

export function Confetti() {
  const { width, height } = Dimensions.get("window");
  const pieces = useRef(makePieces(width)).current;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
      {pieces.map((p, i) => (
        <FallingPiece key={i} p={p} height={height} />
      ))}
    </View>
  );
}
