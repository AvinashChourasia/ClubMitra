// Edit-profile screen. Pre-filled from the current user; saving calls
// auth.updateProfile() (PUT /users/me), which refreshes the cached user. Same
// required fields as registration — everything except t-shirt size.

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
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { colors, styles } from "../../lib/theme";
import { ChipSelect } from "../../components/ChipSelect";
import { PhotoPicker } from "../../components/PhotoPicker";
import { CityPicker } from "../../components/CityPicker";
import { RUNNING_LEVELS, TSHIRT_SIZES } from "../../lib/profile";

export default function EditProfile() {
  const { user, updateProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [age, setAge] = useState(user?.age != null ? String(user.age) : "");
  const [level, setLevel] = useState<string | null>(user?.running_level ?? null);
  const [tshirt, setTshirt] = useState<string | null>(user?.tshirt_size ?? null);
  const [photo, setPhoto] = useState<string | null>(user?.profile_photo ?? null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (!phone.trim()) return setError("Please enter your phone number.");
    const ageNum = Number(age);
    if (!age.trim() || !Number.isFinite(ageNum) || ageNum <= 0) return setError("Please enter a valid age.");
    if (!city.trim()) return setError("Please enter your city.");
    if (!level) return setError("Please pick your running level.");

    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        city: city.trim(),
        age: ageNum,
        running_level: level,
        tshirt_size: tshirt ?? undefined,
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Edit profile</Text>
          <Text style={styles.subtitle}>Email and password are managed separately.</Text>

          <PhotoPicker uri={photo} onChange={setPhoto} label="Add profile photo" />

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput style={styles.input} placeholder="Phone" placeholderTextColor={colors.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <Text style={styles.fieldLabel}>City</Text>
          <CityPicker value={city || null} onChange={setCity} placeholder="City" />
          <Text style={styles.fieldLabel}>Age</Text>
          <TextInput style={styles.input} placeholder="Age" placeholderTextColor={colors.muted} keyboardType="number-pad" value={age} onChangeText={setAge} />

          <Text style={styles.fieldLabel}>Running level</Text>
          <ChipSelect options={RUNNING_LEVELS} value={level} onChange={setLevel} />

          <Text style={styles.fieldLabel}>T-shirt size (optional)</Text>
          <ChipSelect options={TSHIRT_SIZES} value={tshirt} onChange={setTshirt} allowDeselect />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update profile</Text>}
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
