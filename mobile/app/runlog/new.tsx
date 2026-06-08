// Log a run: pick the club, enter distance + date (+ optional note). Feeds the
// chapter rolling leaderboards.

import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { myChapters, type MyChapter } from "../../lib/clubs";
import { logRun } from "../../lib/runlog";
import { Calendar, toDateStr } from "../../components/Calendar";
import { ChipSelect } from "../../components/ChipSelect";
import { colors, styles, useThemeMode } from "../../lib/theme";

export default function LogRun() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [chapters, setChapters] = useState<MyChapter[] | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [km, setKm] = useState("");
  const [date, setDate] = useState(toDateStr(new Date()));
  const [showCal, setShowCal] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const token = await getAccessToken();
        if (!token) return;
        const all = await myChapters(token);
        const active = all.filter((c) => c.status === "active");
        setChapters(active);
        if (active.length && !chapterId) setChapterId(active[0].id);
      })();
    }, [getAccessToken, chapterId])
  );

  async function onSave() {
    setError(null);
    const dist = Number(km);
    if (!km.trim() || !Number.isFinite(dist) || dist <= 0) return setError("Enter a distance greater than 0.");
    if (!chapterId) return setError("Pick a club to log this run for.");

    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await logRun(token, { chapter_id: chapterId, distance_km: dist, ran_on: date, note: note.trim() || undefined });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <Redirect href="/login" />;

  const options = (chapters ?? []).map((c) => ({ key: c.id, label: c.name }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Log a run</Text>
          <Text style={styles.subtitle}>Add a run to climb your club&apos;s leaderboard.</Text>

          {chapters && chapters.length === 0 ? (
            <View style={[styles.card, { alignItems: "center", paddingVertical: 28 }]}>
              <Ionicons name="people-outline" size={28} color={colors.subtle} />
              <Text style={{ color: colors.muted, marginTop: 8, textAlign: "center" }}>
                Join a club first — runs are logged to a club&apos;s leaderboard.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Club</Text>
              <ChipSelect options={options} value={chapterId} onChange={setChapterId} />

              <Text style={styles.fieldLabel}>Distance (km)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 5.2"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={km}
                onChangeText={setKm}
              />

              <Text style={styles.fieldLabel}>Date</Text>
              <Pressable
                onPress={() => setShowCal((s) => !s)}
                style={[styles.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
              >
                <Text style={{ color: colors.text, fontSize: 16 }}>{date}</Text>
                <Ionicons name={showCal ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
              </Pressable>
              {showCal && (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 8 }}>
                  <Calendar
                    selected={date}
                    onSelect={(d) => {
                      setDate(d);
                      setShowCal(false);
                    }}
                  />
                </View>
              )}

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Easy morning run…"
                placeholderTextColor={colors.muted}
                value={note}
                onChangeText={setNote}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={onSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log run</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
