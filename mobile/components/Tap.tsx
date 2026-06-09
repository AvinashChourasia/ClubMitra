// Tap: a Pressable that springs down on press and fires a light haptic — the
// tactile "2026" feel. Uses the built-in Animated API (no reanimated dep). Drop
// it in place of Pressable for buttons, cards, and rows you want to feel alive.

import { useRef } from "react";
import { Animated, Pressable, type StyleProp, type ViewStyle, type GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";

type Props = {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  haptic?: boolean; // default true
  scaleTo?: number; // default 0.96
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
};

export function Tap({ children, onPress, onLongPress, disabled, haptic = true, scaleTo = 0.96, hitSlop, style }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number, bounciness: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 50, bounciness }).start();

  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => to(scaleTo, 0)}
      onPressOut={() => to(1, 6)}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      onLongPress={onLongPress}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
