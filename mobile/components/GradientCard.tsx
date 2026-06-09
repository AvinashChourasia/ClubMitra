// GradientCard: a glossy, "lit" gradient surface for hero sections. It layers a
// gradient base + a white top-highlight (gloss) + a colored glow shadow so the
// card reads as 3D/elevated — the signature 2026-SaaS look.

import { View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { gradients, glow, radius as r } from "../lib/theme";

type Props = {
  children: React.ReactNode;
  colors?: readonly [string, string, ...string[]]; // gradient stops (default brand red)
  glowColor?: string; // colored glow under the card (default = last gradient stop)
  radius?: number;
  style?: StyleProp<ViewStyle>; // inner padding/layout
};

export function GradientCard({ children, colors = gradients.red, glowColor, radius = r.xl, style }: Props) {
  const glowC = glowColor ?? colors[colors.length - 1];
  return (
    // Outer view carries the colored glow (no overflow clip, so the shadow shows).
    <View style={[{ borderRadius: radius }, glow(glowC, 0.4)]}>
      {/* Inner clips the gloss to the rounded gradient. */}
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[{ borderRadius: radius, overflow: "hidden" }, style]}
      >
        {/* Top gloss highlight — makes it look lit from above. */}
        <LinearGradient
          colors={gradients.gloss}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%" }}
          pointerEvents="none"
        />
        {children}
      </LinearGradient>
    </View>
  );
}
