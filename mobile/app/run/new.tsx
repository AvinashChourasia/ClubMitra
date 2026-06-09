// Schedule a run for a chapter (admins only). Supports one-time and recurring
// schedules (weekdays / weekends / alternate / custom days) over a date range,
// with an optional time. The client expands the recurrence into concrete
// occurrences and creates them all in one call.

import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import { scheduleRuns, expandOccurrences, FREQUENCY_OPTIONS, type Frequency } from "../../lib/attendance";
import { colors, styles } from "../../lib/theme";
import { ChipSelect } from "../../components/ChipSelect";
import { Calendar, toDateStr } from "../../components/Calendar";
import { TimePicker } from "../../components/TimePicker";

const WEEK_OPTIONS = [
  { key: "2", label: "2 weeks" },
  { key: "4", label: "4 weeks" },
  { key: "8", label: "8 weeks" },
  { key: "12", label: "12 weeks" },
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}

export default function NewRun() {
  const { chapter_id } = useLocalSearchParams<{ chapter_id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(toDateStr(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [weeks, setWeeks] = useState("4");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const endDate = frequency === "once" ? startDate : addDays(startDate, Number(weeks) * 7 - 1);

  const occurrences = useMemo(
    () => expandOccurrences({ frequency, startDate, endDate, weekdays, time }),
    [frequency, startDate, endDate, weekdays, time]
  );

  function toggleDow(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function onSubmit() {
    setError(null);
    if (!title.trim()) return setError("Enter a title.");
    if (occurrences.length === 0) return setError("That recurrence has no dates — pick days/range.");

    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const runs = await scheduleRuns(token!, {
        chapter_id,
        title: title.trim(),
        has_time: time !== null,
        location: location.trim() || undefined,
        distance_target: distance.trim() ? Number(distance) : undefined,
        notes: notes.trim() || undefined,
        scheduled_ats: occurrences,
      });
      // Go to the first created run.
      router.replace(`/run/${runs[0].id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Schedule a run</Text>

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} placeholder="e.g. Morning Run" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />

        <Text style={styles.fieldLabel}>Repeats</Text>
        <ChipSelect options={FREQUENCY_OPTIONS} value={frequency} onChange={(k) => setFrequency((k as Frequency) ?? "once")} />

        {frequency === "custom" && (
          <>
            <Text style={styles.fieldLabel}>On these days</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {DOW.map((d, i) => {
                const on = weekdays.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => toggleDow(i)}
                    style={{
                      flex: 1,
                      paddingVertical: 9,
                      borderRadius: 8,
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary : colors.bg,
                    }}
                  >
                    <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "700", fontSize: 12 }}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <Text style={styles.fieldLabel}>{frequency === "once" ? "Date" : "Starting from"}</Text>
        <View style={styles.card}>
          <Calendar selected={startDate} onSelect={setStartDate} minDate={new Date()} />
        </View>

        {frequency !== "once" && (
          <>
            <Text style={styles.fieldLabel}>Repeat for</Text>
            <ChipSelect options={WEEK_OPTIONS} value={weeks} onChange={(k) => setWeeks(k ?? "4")} />
          </>
        )}

        <Text style={styles.fieldLabel}>Time</Text>
        <TimePicker value={time} onChange={setTime} />

        <Text style={styles.fieldLabel}>Location (optional)</Text>
        <TextInput style={styles.input} placeholder="e.g. Cubbon Park" placeholderTextColor={colors.muted} value={location} onChangeText={setLocation} />

        <Text style={styles.fieldLabel}>Distance target km (optional)</Text>
        <TextInput style={styles.input} placeholder="e.g. 5" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={distance} onChangeText={setDistance} />

        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, { height: 72, textAlignVertical: "top" }]}
          placeholder="Anything members should know"
          placeholderTextColor={colors.muted}
          multiline
          value={notes}
          onChangeText={setNotes}
        />

        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 4 }}>
          Creates {occurrences.length} run{occurrences.length === 1 ? "" : "s"}
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Button label="Schedule" onPress={onSubmit} loading={submitting} />
        <Tap onPress={() => router.back()} haptic={false}><Text style={styles.link}>Cancel</Text></Tap>
      </ScrollView>
    </SafeAreaView>
  );
}
