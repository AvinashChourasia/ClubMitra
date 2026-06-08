// Edit a club (chapter): name, city, description, visibility. Admin-only — the
// backend gates the PUT, and we only link here from the detail screen when the
// caller is an admin.

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { getChapter, updateChapter } from "../../../lib/clubs";
import { uploadClubImage, isRemote } from "../../../lib/upload";
import { colors, styles } from "../../../lib/theme";
import { PhotoPicker } from "../../../components/PhotoPicker";
import { CityPicker } from "../../../components/CityPicker";
import { ClubFeeFields, defaultFeeState, feeSettings, type FeeState } from "../../../components/ClubFeeFields";

export default function EditClub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [fee, setFee] = useState<FeeState>(defaultFeeState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          const ch = await getChapter(token!, id);
          if (active) {
            setName(ch.name);
            setCity(ch.city);
            setDescription(ch.description);
            setLogo(ch.logo ?? null);
            setBanner(ch.banner ?? null);
            setIsPublic(ch.is_public);
            setFee({
              requiresApproval: ch.requires_approval,
              feeEnabled: ch.membership_fee_enabled,
              amount: ch.membership_fee_amount != null ? String(ch.membership_fee_amount) : "",
              period: ch.membership_period ?? "monthly",
              renewalDays: String(ch.renewal_window_days ?? 5),
            });
          }
        } catch (e) {
          if (active) setError(e instanceof ApiError ? e.message : "Something went wrong");
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken, id])
  );

  async function onSave() {
    setError(null);
    if (!name.trim()) return setError("Enter the club name.");
    if (!city.trim()) return setError("Enter the city.");
    setSaving(true);
    try {
      const token = await getAccessToken();
      // Upload freshly-picked images; an unchanged remote URL is reused, null clears it.
      const logoUrl = logo && !isRemote(logo) ? await uploadClubImage(token!, logo) : logo;
      const bannerUrl = banner && !isRemote(banner) ? await uploadClubImage(token!, banner) : banner;
      await updateChapter(token!, id, {
        name: name.trim(),
        city: city.trim(),
        description: description.trim(),
        is_public: isPublic,
        logo: logoUrl,
        banner: bannerUrl,
        ...feeSettings(fee),
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Edit club</Text>

          <PhotoPicker uri={logo} onChange={setLogo} label="Add club logo" />

          <Text style={styles.fieldLabel}>Banner (optional)</Text>
          <PhotoPicker uri={banner} onChange={setBanner} label="Add club banner" shape="banner" size={120} />

          <Text style={styles.fieldLabel}>Club name</Text>
          <TextInput style={styles.input} placeholder="Club name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />

          <Text style={styles.fieldLabel}>City</Text>
          <CityPicker value={city || null} onChange={setCity} placeholder="Select city" />

          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, { height: 88, textAlignVertical: "top" }]}
            placeholder="What's your club about?"
            placeholderTextColor={colors.muted}
            multiline
            value={description}
            onChangeText={setDescription}
          />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Public</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Allow others to discover this club.</Text>
            </View>
            <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: colors.primary }} />
          </View>

          <ClubFeeFields value={fee} onChange={setFee} />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save changes</Text>}
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
