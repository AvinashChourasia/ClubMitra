// ErrorState: the shared "couldn't load — try again" card. Use it wherever a
// screen's data fetch can fail with nothing to show, so a load failure reads as
// a load failure (with a way out) rather than an empty screen.

import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, styles } from "../lib/theme";

export function ErrorState({
  message,
  onRetry,
  retrying,
  compact,
  style,
}: {
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
  /** compact = tighter padding, for inline (in-list) use vs. a full screen. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, { alignItems: "center", paddingVertical: compact ? 24 : 40, gap: 12 }, style]}>
      <Ionicons name="cloud-offline-outline" size={compact ? 30 : 38} color={colors.subtle} />
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Couldn&apos;t load</Text>
        <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>
          {message ?? "Check your connection and try again."}
        </Text>
      </View>
      <Pressable
        onPress={onRetry}
        disabled={retrying}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: colors.primary,
          borderRadius: 12,
          paddingVertical: 11,
          paddingHorizontal: 22,
          opacity: retrying ? 0.6 : 1,
        }}
      >
        {retrying ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="refresh" size={16} color="#fff" />}
        <Text style={{ color: "#fff", fontWeight: "800" }}>Try again</Text>
      </Pressable>
    </View>
  );
}
