// Edit a single run (organiser only — the backend re-checks the role). Date via
// the calendar, optional time via the time picker. No recurrence here; editing
// changes just this one run.

import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { getRun, updateRun } from "../../../lib/attendance";
import { colors, styles } from "../../../lib/theme";
import { Calendar, toDateStr } from "../../../components/Calendar";
import { TimePicker } from "../../../components/TimePicker";

export default function EditRun() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toDateStr(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          const run = await getRun(token!, id);
          if (!active) return;
          const d = new Date(run.scheduled_at);
          setTitle(run.title);
          setDate(toDateStr(d));
          setTime(run.has_time ? `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}` : null);
          setLocation(run.location ?? "");
          setDistance(run.distance_target != null ? String(run.distance_target) : "");
          setNotes(run.notes ?? "");
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
    if (!title.trim()) return setError("Enter a title.");
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time ? time.split(":").map(Number) : [0, 0];
    const scheduledAt = new Date(y, m - 1, d, hh, mm, 0).toISOString();

    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateRun(token!, id, {
        title: title.trim(),
        scheduled_at: scheduledAt,
        has_time: time !== null,
        location: location.trim() || undefined,
        distance_target: distance.trim() ? Number(distance) : undefined,
        notes: notes.trim() || undefined,
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
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Edit run</Text>

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} placeholder="Title" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />

        <Text style={styles.fieldLabel}>Date</Text>
        <View style={styles.card}>
          <Calendar selected={date} onSelect={setDate} minDate={new Date()} />
        </View>

        <Text style={styles.fieldLabel}>Time</Text>
        <TimePicker value={time} onChange={setTime} />

        <Text style={styles.fieldLabel}>Location (optional)</Text>
        <TextInput style={styles.input} placeholder="Location" placeholderTextColor={colors.muted} value={location} onChangeText={setLocation} />

        <Text style={styles.fieldLabel}>Distance target km (optional)</Text>
        <TextInput style={styles.input} placeholder="e.g. 5" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={distance} onChangeText={setDistance} />

        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, { height: 72, textAlignVertical: "top" }]}
          placeholder="Notes"
          placeholderTextColor={colors.muted}
          multiline
          value={notes}
          onChangeText={setNotes}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={onSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save changes</Text>}
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
