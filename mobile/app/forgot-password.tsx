// Forgot password — for a user who can't log in. Two phases in one screen:
//   1. enter email → we mail a 6-digit code (server never reveals if it matched)
//   2. enter the code + a new password → reset, then back to login
// If email delivery isn't configured server-side, the request returns 503 and
// we surface that message as-is (the flow is dormant until a club sets it up).

import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { requestPasswordReset, resetPassword } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Tap } from "../components/Tap";
import { Button } from "../components/Button";
import { colors, styles, useThemeMode } from "../lib/theme";

export default function ForgotPassword() {
  const router = useRouter();
  useThemeMode();

  const [phase, setPhase] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setError(null);
    const addr = email.trim();
    if (!addr.includes("@")) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await requestPasswordReset(addr);
      setPhase("reset");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send a reset code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setError(null);
    if (code.trim().length !== 6) return setError("Enter the 6-digit code from your email.");
    if (password.length < 8) return setError("New password must be at least 8 characters.");
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      router.replace({ pathname: "/login", params: { reset: "1" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reset your password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Ionicons name="lock-closed" size={40} color={colors.primary} />
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Reset password</Text>
          <Text style={{ color: colors.muted, fontSize: 14.5, textAlign: "center" }}>
            {phase === "request"
              ? "Enter your account email and we'll send you a code."
              : `Enter the 6-digit code we sent to ${email.trim()} and choose a new password.`}
          </Text>
        </View>

        {phase === "request" ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button label="Send reset code" onPress={sendCode} loading={busy} />
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            <TextInput
              style={styles.input}
              placeholder="New password (min 8 chars)"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button label="Reset password" onPress={doReset} loading={busy} />
            <Tap onPress={sendCode} haptic={false} disabled={busy}>
              <Text style={styles.link}>Didn't get it? Resend code</Text>
            </Tap>
          </>
        )}

        <Tap onPress={() => router.back()} haptic={false}>
          <Text style={[styles.link, { marginTop: 4 }]}>Back to log in</Text>
        </Tap>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
