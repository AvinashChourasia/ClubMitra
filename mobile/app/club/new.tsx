// Create a club. One club, one name — the user gives a single club name and
// city, and we land them on the new club with its invite code to share.
// (Under the hood this still creates the org + its one chapter, sharing the
// same name, but that's invisible: the experience is a single flat club.)

import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { createOrg, createChapter } from "../../lib/clubs";
import { uploadClubImage, isRemote } from "../../lib/upload";
import { colors, styles } from "../../lib/theme";
import { PhotoPicker } from "../../components/PhotoPicker";
import { CityPicker } from "../../components/CityPicker";
import { ClubFeeFields, defaultFeeState, feeSettings, type FeeState } from "../../components/ClubFeeFields";
import { PAYMENTS_ENABLED } from "../../lib/flags";

export default function NewClub() {
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [fee, setFee] = useState<FeeState>(defaultFeeState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!name.trim()) return setError("Enter the club name.");
    if (!city.trim()) return setError("Enter the city.");

    setSubmitting(true);
    try {
      const token = await getAccessToken();
      // Upload freshly-picked images first; persist the hosted URLs on the club.
      const logoUrl = logo && !isRemote(logo) ? await uploadClubImage(token!, logo) : logo ?? undefined;
      const bannerUrl = banner && !isRemote(banner) ? await uploadClubImage(token!, banner) : banner ?? undefined;
      // One name for the whole club (the org + its single chapter share it).
      const org = await createOrg(token!, name.trim(), description.trim());
      const chapter = await createChapter(token!, org.id, name.trim(), city.trim(), description.trim(), {
        ...feeSettings(fee),
        logo: logoUrl,
        banner: bannerUrl,
      });
      router.replace(`/club/${chapter.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* behavior="padding" on BOTH platforms: Android adjustResize is dead
          under edge-to-edge — the bottom-of-form Description was typed blind. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create a club</Text>
          <Text style={styles.subtitle}>You&apos;ll be its admin. Name it and pick your city to start.</Text>

          <PhotoPicker uri={logo} onChange={setLogo} label="Add club logo" />

          <Text style={styles.fieldLabel}>Banner (optional)</Text>
          <PhotoPicker uri={banner} onChange={setBanner} label="Add club banner" shape="banner" size={120} />

          <Text style={styles.fieldLabel}>Club name</Text>
          <TextInput style={styles.input} placeholder="e.g. Bangalore Runners" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />

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

          {/* Approval is a membership setting, not a payments one — always shown.
              ClubFeeFields already includes this toggle, so it only renders inline
              when the fee fields are flagged off. */}
          {PAYMENTS_ENABLED ? (
            <ClubFeeFields value={fee} onChange={setFee} />
          ) : (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Require admin approval</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>New members wait for an admin to approve them.</Text>
              </View>
              <Switch value={fee.requiresApproval} onValueChange={(v) => setFee({ ...fee, requiresApproval: v })} trackColor={{ true: colors.primary }} />
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Button label="Create club" onPress={onSubmit} loading={submitting} />
          <Tap onPress={() => router.back()} haptic={false}><Text style={styles.link}>Cancel</Text></Tap>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
