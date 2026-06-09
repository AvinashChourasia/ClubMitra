// Login screen. Collects email + password, calls auth.login() (verified by our
// backend), and on success the auth gate (index.tsx) routes the now-logged-in
// user home. New runners create an account on the register screen.

import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { GradientCard } from "../../components/GradientCard";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace("/home");
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
          <GradientCard colors={gradients.red} glowColor={colors.primary} radius={26} style={{ width: 80, height: 80, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="walk" size={38} color="#fff" />
          </GradientCard>
          <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text, letterSpacing: -0.6 }}>ClubMitra</Text>
          <Text style={{ color: colors.muted, fontSize: 15 }}>Your running club, in your pocket.</Text>
        </View>

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

        <Tap onPress={() => router.push("/register")} haptic={false}>
          <Text style={styles.link}>New here? Create an account</Text>
        </Tap>
      </View>
    </KeyboardAvoidingView>
  );
}
