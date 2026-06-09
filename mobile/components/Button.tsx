// Button: the app's primary call-to-action — spring + haptic via <Tap>, with
// loading and variants. Use everywhere instead of a bare Pressable so every CTA
// feels (and looks) consistent.

import { ActivityIndicator, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Tap } from "./Tap";
import { colors, radius } from "../lib/theme";

type Variant = "primary" | "secondary" | "danger";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, loading, disabled, variant = "primary", icon, style }: Props) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const bg = isPrimary ? colors.primary : isDanger ? "transparent" : colors.bgSecondary;
  const fg = isPrimary ? "#fff" : isDanger ? colors.danger : colors.text;
  const off = disabled || loading;

  return (
    <Tap onPress={onPress} disabled={off} haptic={isPrimary} style={[{ opacity: off ? 0.55 : 1 }, style]}>
      <View
        style={{
          backgroundColor: bg,
          borderRadius: radius.lg,
          paddingVertical: 15,
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderWidth: variant === "primary" ? 0 : 1,
          borderColor: isDanger ? colors.danger : colors.border,
          // a quiet brand glow only on the primary CTA
          ...(isPrimary
            ? { shadowColor: colors.primary, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 }
            : null),
        }}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
            <Text style={{ color: fg, fontSize: 16, fontWeight: "700", letterSpacing: 0.2 }}>{label}</Text>
          </>
        )}
      </View>
    </Tap>
  );
}
