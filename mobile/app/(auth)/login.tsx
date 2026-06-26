// Login screen. Collects email + password, calls auth.login() (verified by our
// backend), and on success the auth gate (index.tsx) routes the now-logged-in
// user home. New runners create an account on the register screen.

import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { resumePendingIntent } from "../../lib/discover";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { GradientCard } from "../../components/GradientCard";
import { colors, styles, useThemeMode } from "../../lib/theme";

export default function Login() {
  const { login, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  // Arrived here after a successful password reset → confirm it so the user
  // knows their new password is the one to use.
  const { reset } = useLocalSearchParams<{ reset?: string }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // If an auth gate stopped a guest mid-action (joining a club/challenge),
      // finish it now and land them where they were headed.
      const token = await getAccessToken();
      const resumed = token ? await resumePendingIntent(token) : null;
      if (resumed) {
        router.replace(resumed.route as Href);
        Alert.alert(resumed.title, resumed.message);
      } else {
        router.replace("/home");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.screen}>
        {/* Brand */}
        <View style={{ alignItems: "center", gap: 12, marginBottom: 12 }}>
          <GradientCard glowColor={colors.primary} radius={26} style={{ width: 80, height: 80, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="walk" size={38} color="#fff" />
          </GradientCard>
          <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text, letterSpacing: -0.6 }}>ClubMitra</Text>
          <Text style={{ color: colors.muted, fontSize: 15 }}>Your running club, in your pocket.</Text>
        </View>

        {reset ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 12, marginBottom: 4 }}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={{ color: colors.text, flex: 1, fontSize: 13.5 }}>Password reset — log in with your new password.</Text>
          </View>
        ) : null}

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
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button label="Log in" onPress={onSubmit} loading={submitting} />

        <Tap onPress={() => router.push("/forgot-password")} haptic={false}>
          <Text style={[styles.link, { marginTop: 14 }]}>Forgot password?</Text>
        </Tap>

        <Tap onPress={() => router.push("/register")} haptic={false}>
          <Text style={styles.link}>New here? Create an account</Text>
        </Tap>
      </View>
    </KeyboardAvoidingView>
  );
}
