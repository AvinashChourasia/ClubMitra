// Login screen. Collects email + password, calls auth.login() (verified by our
// backend), and on success the auth gate (index.tsx) routes the now-logged-in
// user home. New runners create an account on the register screen.

import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
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
          <LinearGradient
            colors={gradients.red}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 76, height: 76, borderRadius: 24, alignItems: "center", justifyContent: "center", shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}
          >
            <Ionicons name="walk" size={38} color="#fff" />
          </LinearGradient>
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

        <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
        </Pressable>

        <Pressable onPress={() => router.push("/register")}>
          <Text style={styles.link}>New here? Create an account</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
