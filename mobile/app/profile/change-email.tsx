// Change email — verified. Two phases: enter the new address (we mail a code to
// it to prove the user controls it), then enter the code to apply the change.
// Dormant server-side until email delivery is configured (request returns 503,
// surfaced as-is). On success we refresh the cached profile so the new address
// shows immediately.

import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth, requestEmailChange, confirmEmailChange } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { colors, styles, useThemeMode } from "../../lib/theme";

export default function ChangeEmail() {
  const { user, getAccessToken, refreshUser } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [phase, setPhase] = useState<"request" | "confirm">("request");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return <Redirect href="/login" />;

  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T | undefined> {
    const token = await getAccessToken();
    if (!token) {
      setError("Your session expired — please log in again.");
      return undefined;
    }
    return fn(token);
  }

  async function sendCode() {
    setError(null);
    const addr = newEmail.trim();
    if (!addr.includes("@")) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      const ok = await withToken((t) => requestEmailChange(t, addr).then(() => true));
      if (ok) setPhase("confirm");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send a verification code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError(null);
    if (code.trim().length !== 6) return setError("Enter the 6-digit code from your email.");
    setBusy(true);
    try {
      const res = await withToken((t) => confirmEmailChange(t, code.trim()));
      if (res) {
        await refreshUser().catch(() => {});
        setDone(true);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't confirm the change. Try again.");
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
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Change email</Text>
        </View>

        {done ? (
          <View style={[styles.card, { alignItems: "center", gap: 8, paddingVertical: 28 }]}>
            <Text style={{ fontSize: 34 }}>✅</Text>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Email updated</Text>
            <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>{newEmail.trim()} is now your account email.</Text>
            <Pressable onPress={() => router.back()} style={{ marginTop: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Done</Text>
            </Pressable>
          </View>
        ) : phase === "request" ? (
          <>
            <Text style={{ color: colors.muted, fontSize: 13.5 }}>Current: {user.email}</Text>
            <Text style={styles.fieldLabel}>New email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
            />
            {error ? <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text> : null}
            <Pressable onPress={sendCode} disabled={busy || !newEmail} style={{ marginTop: 6, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: busy || !newEmail ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Send verification code</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ color: colors.muted, fontSize: 13.5 }}>We sent a 6-digit code to {newEmail.trim()}. Enter it to confirm.</Text>
            <Text style={styles.fieldLabel}>Verification code</Text>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor={colors.subtle}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            {error ? <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text> : null}
            <Pressable onPress={confirm} disabled={busy || !code} style={{ marginTop: 6, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: busy || !code ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Confirm new email</Text>}
            </Pressable>
            <Pressable onPress={sendCode} disabled={busy} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 6 }}>
              <Text style={{ color: colors.accent, fontWeight: "600" }}>Didn't get it? Resend code</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
