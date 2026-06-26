// Change password — current + new + confirm, behind the logged-in session.
// (Forgot-password, for locked-out users, is a separate email-based flow.)

import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth, changePassword } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { colors, styles, useThemeMode } from "../../lib/theme";

export default function ChangePassword() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return <Redirect href="/login" />;

  async function submit() {
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next.length > 72) return setError("New password must be at most 72 characters.");
    if (next !== confirm) return setError("New passwords don't match.");
    if (next === current) return setError("Pick a password different from your current one.");
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Your session expired — please log in again.");
        return;
      }
      await changePassword(token, current, next);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change your password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Change password</Text>
        </View>

        {done ? (
          <View style={[styles.card, { alignItems: "center", gap: 8, paddingVertical: 28 }]}>
            <Text style={{ fontSize: 34 }}>✅</Text>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Password updated</Text>
            <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>Use your new password next time you log in.</Text>
            <Pressable onPress={() => router.back()} style={{ marginTop: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Current password</Text>
            <TextInput style={styles.input} secureTextEntry autoCapitalize="none" placeholder="Current password" placeholderTextColor={colors.subtle} value={current} onChangeText={setCurrent} />
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput style={styles.input} secureTextEntry autoCapitalize="none" placeholder="At least 8 characters" placeholderTextColor={colors.subtle} value={next} onChangeText={setNext} />
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput style={styles.input} secureTextEntry autoCapitalize="none" placeholder="Re-enter new password" placeholderTextColor={colors.subtle} value={confirm} onChangeText={setConfirm} />

            {error ? <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={busy || !current || !next || !confirm}
              style={{ marginTop: 6, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: busy || !current || !next || !confirm ? 0.6 : 1 }}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Update password</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
