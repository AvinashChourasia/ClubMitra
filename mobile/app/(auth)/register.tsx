// Register screen. Collects the full runner profile and creates the account via
// auth.register() (ClubMitra owns identity now). On success the auth gate routes
// the new, already-logged-in user home. Everything except t-shirt size is
// required — the backend enforces the same.

import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { colors, styles, useThemeMode } from "../../lib/theme";
import { ChipSelect } from "../../components/ChipSelect";
import { PhotoPicker } from "../../components/PhotoPicker";
import { CityPicker } from "../../components/CityPicker";
import { RUNNING_LEVELS, TSHIRT_SIZES } from "../../lib/profile";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [tshirt, setTshirt] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);

    // Cheap client-side checks (the backend re-validates everything).
    if (!name.trim()) return setError("Please enter your name.");
    if (!email.includes("@")) return setError("Please enter a valid email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (!phone.trim()) return setError("Please enter your phone number.");
    const ageNum = Number(age);
    if (!age.trim() || !Number.isFinite(ageNum) || ageNum <= 0) return setError("Please enter a valid age.");
    if (!city.trim()) return setError("Please enter your city.");
    if (!level) return setError("Please pick your running level.");

    setSubmitting(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        city: city.trim(),
        age: ageNum,
        running_level: level,
        tshirt_size: tshirt ?? undefined,
      });
      router.replace("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Join your running club on ClubMitra.</Text>

        <PhotoPicker uri={photo} onChange={setPhoto} label="Add profile photo" />

        <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
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
          placeholder="Phone"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 characters)"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <CityPicker value={city || null} onChange={setCity} placeholder="City" />
        <TextInput
          style={styles.input}
          placeholder="Age"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          value={age}
          onChangeText={setAge}
        />

        <Text style={styles.fieldLabel}>Running level</Text>
        <ChipSelect options={RUNNING_LEVELS} value={level} onChange={setLevel} />

        <Text style={styles.fieldLabel}>T-shirt size (optional)</Text>
        <ChipSelect options={TSHIRT_SIZES} value={tshirt} onChange={setTshirt} allowDeselect />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create account</Text>}
        </Pressable>

        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Already have an account? Log in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
