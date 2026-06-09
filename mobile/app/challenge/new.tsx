// Create-a-challenge form: title, type (distance/days/streak), target, visibility
// scope (public/chapter/city/org), a start date + length, and description.

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { Tap } from "../../components/Tap";
import { Button } from "../../components/Button";
import {
  createChallenge,
  CHALLENGE_TYPES,
  VISIBILITIES,
  type ChallengeType,
  type Visibility,
} from "../../lib/challenges";
import { myChapters, isChapterAdmin, type MyChapter } from "../../lib/clubs";
import { colors, styles } from "../../lib/theme";
import { ChipSelect } from "../../components/ChipSelect";
import { CityPicker } from "../../components/CityPicker";
import { Calendar, toDateStr } from "../../components/Calendar";

const LENGTHS = [
  { key: "7", label: "1 week" },
  { key: "14", label: "2 weeks" },
  { key: "30", label: "1 month" },
  { key: "90", label: "3 months" },
];

// How long before the start members can still leave.
const LOCK_OPTIONS = [
  { key: "0", label: "Anytime" },
  { key: "2", label: "2d before" },
  { key: "5", label: "5d before" },
  { key: "10", label: "10d before" },
];

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}
function startISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
function endISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

export default function NewChallenge() {
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChallengeType>("distance");
  const [target, setTarget] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [city, setCity] = useState("");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(toDateStr(new Date()));
  const [length, setLength] = useState("30");
  const [joinFee, setJoinFee] = useState("");
  const [lockDays, setLockDays] = useState("0");
  const [description, setDescription] = useState("");
  const [adminChapters, setAdminChapters] = useState<MyChapter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Chapters the user can scope a challenge to (those they administer).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (token) {
            const mine = await myChapters(token);
            if (active) setAdminChapters(mine.filter((c) => isChapterAdmin(c.role)));
          }
        } catch {
          /* leave empty */
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken])
  );

  const endDate = addDays(startDate, Number(length));
  const unit = type === "distance" ? "km" : "days";
  const needsChapter = visibility === "chapter" || visibility === "org";
  const selectedChapter = useMemo(() => adminChapters.find((c) => c.id === chapterId), [adminChapters, chapterId]);

  async function onSubmit() {
    setError(null);
    if (!title.trim()) return setError("Enter a title.");
    const targetNum = Number(target);
    if (!target.trim() || !Number.isFinite(targetNum) || targetNum <= 0) return setError(`Enter a target in ${unit}.`);
    if (visibility === "city" && !city.trim()) return setError("Pick a city for a city challenge.");
    if (needsChapter && !selectedChapter) return setError("Pick a club to scope this challenge to.");

    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const feeNum = Number(joinFee);
      const lockN = Number(lockDays);
      const ch = await createChallenge(token!, {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        visibility,
        city: visibility === "city" ? city.trim() : undefined,
        chapter_id: visibility === "chapter" ? selectedChapter!.id : undefined,
        org_id: visibility === "org" ? selectedChapter!.org_id : undefined,
        target_km: type === "distance" ? targetNum : undefined,
        target_days: type !== "distance" ? Math.round(targetNum) : undefined,
        start_date: startISO(startDate),
        end_date: endISO(endDate),
        join_fee: joinFee.trim() && feeNum > 0 ? feeNum : undefined,
        lock_date: lockN > 0 ? startISO(addDays(startDate, -lockN)) : undefined,
      });
      router.replace(`/challenge/${ch.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New challenge</Text>

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} placeholder="e.g. June 50K" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />

        <Text style={styles.fieldLabel}>Type</Text>
        <ChipSelect options={CHALLENGE_TYPES} value={type} onChange={(k) => setType((k as ChallengeType) ?? "distance")} />

        <Text style={styles.fieldLabel}>Target ({unit})</Text>
        <TextInput
          style={styles.input}
          placeholder={type === "distance" ? "e.g. 50" : "e.g. 30"}
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          value={target}
          onChangeText={setTarget}
        />

        <Text style={styles.fieldLabel}>Visibility</Text>
        <ChipSelect options={VISIBILITIES} value={visibility} onChange={(k) => setVisibility((k as Visibility) ?? "public")} />

        {visibility === "city" && (
          <>
            <Text style={styles.fieldLabel}>City</Text>
            <CityPicker value={city || null} onChange={setCity} placeholder="Select city" />
          </>
        )}

        {needsChapter && (
          <>
            <Text style={styles.fieldLabel}>{visibility === "org" ? "Organisation (via your club)" : "Club"}</Text>
            {adminChapters.length === 0 ? (
              <Text style={{ color: colors.muted }}>You don&apos;t admin any club to scope this to.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {adminChapters.map((c) => {
                  const on = chapterId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setChapterId(c.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primary : colors.bg,
                        borderRadius: 10,
                        paddingVertical: 11,
                        paddingHorizontal: 14,
                      }}
                    >
                      <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "700" }}>{c.name}</Text>
                      <Text style={{ color: on ? "rgba(255,255,255,0.85)" : colors.muted, fontSize: 12 }}>{c.city}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        <Text style={styles.fieldLabel}>Starts</Text>
        <View style={styles.card}>
          <Calendar selected={startDate} onSelect={setStartDate} minDate={new Date()} />
        </View>

        <Text style={styles.fieldLabel}>Length</Text>
        <ChipSelect options={LENGTHS} value={length} onChange={(k) => setLength(k ?? "30")} />

        <Text style={styles.fieldLabel}>Join fee ₹ (optional)</Text>
        <TextInput style={styles.input} placeholder="0 = free" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={joinFee} onChangeText={setJoinFee} />

        <Text style={styles.fieldLabel}>Members can leave until</Text>
        <ChipSelect options={LOCK_OPTIONS} value={lockDays} onChange={(k) => setLockDays(k ?? "0")} />

        <Text style={styles.fieldLabel}>Description (optional)</Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          placeholder="What's the challenge about?"
          placeholderTextColor={colors.muted}
          multiline
          value={description}
          onChangeText={setDescription}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button label="Create challenge" onPress={onSubmit} loading={submitting} />
        <Tap onPress={() => router.back()} haptic={false}><Text style={styles.link}>Cancel</Text></Tap>
      </ScrollView>
    </SafeAreaView>
  );
}
