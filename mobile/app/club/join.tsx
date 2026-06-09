// Join a club with an invite code. The invite-first onboarding path: a runner
// enters the code their club shared and is enrolled into that chapter.

import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { joinByInvite } from "../../lib/clubs";
import { colors, styles } from "../../lib/theme";

export default function JoinClub() {
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!code.trim()) return setError("Enter the invite code.");
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const { chapter, status } = await joinByInvite(token!, code.trim().toUpperCase());
      const msg =
        status === "pending"
          ? "Request sent! An admin will review it shortly."
          : status === "pending_payment"
            ? "Approved! Pay the membership fee on the club page to finish."
            : `You've joined ${chapter.name}.`;
      Alert.alert("Done", msg, [{ text: "OK", onPress: () => router.replace(`/club/${chapter.id}`) }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.screen, { justifyContent: "flex-start", paddingTop: 32 }]}>
          <Text style={styles.title}>Join a club</Text>
          <Text style={styles.subtitle}>Enter the invite code your club shared with you.</Text>

          <TextInput
            style={[styles.input, { letterSpacing: 2, fontWeight: "700", textAlign: "center", fontSize: 20 }]}
            placeholder="ABCD1234"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Button label="Join" onPress={onSubmit} loading={submitting} />
          <Tap onPress={() => router.back()} haptic={false}><Text style={styles.link}>Cancel</Text></Tap>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
