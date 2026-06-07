// Create a club. A club is an organisation with at least one city chapter, so
// this single screen creates the org and its first chapter together — the
// creator becomes its org admin. They land on the new chapter (with its invite
// code to share).

import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { createOrg, createChapter } from "../../lib/clubs";
import { colors, styles } from "../../lib/theme";
import { PhotoPicker } from "../../components/PhotoPicker";
import { CityPicker } from "../../components/CityPicker";
import { ClubFeeFields, defaultFeeState, feeSettings, type FeeState } from "../../components/ClubFeeFields";

export default function NewClub() {
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [orgName, setOrgName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [fee, setFee] = useState<FeeState>(defaultFeeState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!orgName.trim()) return setError("Enter the organisation name.");
    if (!chapterName.trim()) return setError("Enter the chapter name.");
    if (!city.trim()) return setError("Enter the city.");

    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const org = await createOrg(token!, orgName.trim(), description.trim());
      const chapter = await createChapter(token!, org.id, chapterName.trim(), city.trim(), description.trim(), feeSettings(fee));
      router.replace(`/club/${chapter.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create a club</Text>
          <Text style={styles.subtitle}>You&apos;ll be its admin. Add a city chapter to start.</Text>

          <PhotoPicker uri={logo} onChange={setLogo} label="Add club logo" />

          <Text style={styles.fieldLabel}>Organisation name</Text>
          <TextInput style={styles.input} placeholder="e.g. XYZ Running Academy" placeholderTextColor={colors.muted} value={orgName} onChangeText={setOrgName} />

          <Text style={styles.fieldLabel}>Chapter name</Text>
          <TextInput style={styles.input} placeholder="e.g. Bangalore Runners" placeholderTextColor={colors.muted} value={chapterName} onChangeText={setChapterName} />

          <Text style={styles.fieldLabel}>City</Text>
          <CityPicker value={city || null} onChange={setCity} placeholder="Select city" />

          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.input, { height: 88, textAlignVertical: "top" }]}
            placeholder="What's your club about?"
            placeholderTextColor={colors.muted}
            multiline
            value={description}
            onChangeText={setDescription}
          />

          <ClubFeeFields value={fee} onChange={setFee} />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create club</Text>}
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
