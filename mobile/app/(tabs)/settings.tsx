// Settings tab: account, appearance (light/dark), and other preferences.
// Calling useThemeMode() subscribes this screen so a theme toggle re-themes it
// instantly.

import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { colors, styles, useThemeMode, type ThemeMode } from "../../lib/theme";
import { Avatar } from "../../components/Avatar";

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, opacity: disabled ? 0.5 : 1 }}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.muted} />
      <Text style={{ flex: 1, color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      {value ? <Text style={{ color: colors.muted, fontSize: 13 }}>{value}</Text> : null}
      {onPress && !disabled ? <Ionicons name="chevron-forward" size={18} color={colors.subtle} /> : null}
      {disabled ? <Text style={{ color: colors.subtle, fontSize: 12 }}>Soon</Text> : null}
    </Pressable>
  );
}

const APPEARANCE: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
];

function AppearanceToggle() {
  const { mode, setMode } = useThemeMode();
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 4, gap: 4 }}>
      {APPEARANCE.map((o) => {
        const on = mode === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => setMode(o.key)}
            style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 11, borderRadius: 9, backgroundColor: on ? colors.bg : "transparent" }}
          >
            <Ionicons name={o.icon} size={16} color={on ? colors.primary : colors.muted} />
            <Text style={{ color: on ? colors.text : colors.muted, fontWeight: "700", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Settings() {
  const { user, logout } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe so this screen re-themes instantly on toggle

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Settings</Text>

        {/* Account */}
        <View style={styles.card}>
          <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>Account</Text>
          <Pressable onPress={() => router.push("/profile/edit")} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar name={user.name} uri={user.profile_photo} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{user.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{user.email}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
          </Pressable>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <Row icon="person-outline" label="Edit profile" onPress={() => router.push("/profile/edit")} />
        </View>

        {/* Appearance */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Ionicons name="contrast" size={18} color={colors.text} />
            <Text style={styles.sectionTitle}>Appearance</Text>
          </View>
          <AppearanceToggle />
        </View>

        {/* Preferences (stubs for now) */}
        <View style={styles.card}>
          <Text style={[styles.sectionTitle, { marginBottom: 4 }]}>Preferences</Text>
          <Row icon="notifications-outline" label="Notifications" disabled />
          <Row icon="lock-closed-outline" label="Privacy" disabled />
          <Row icon="help-circle-outline" label="Help & feedback" disabled />
          <Row icon="information-circle-outline" label="About ClubMitra" value="v1 · Phase 1" />
        </View>

        {/* Logout */}
        <Pressable
          onPress={logout}
          style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
        >
          <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 15 }}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
