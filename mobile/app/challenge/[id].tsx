// Challenge detail: the goal, your progress, the leaderboard, and Phase-1 proof.
// A member can join and submit proof (Strava link / screenshot); the creator
// reviews and verifies proof, which credits the submitter's progress.

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import {
  getChallenge,
  getLeaderboard,
  joinChallenge,
  leaveChallenge,
  submitProof,
  listProof,
  verifyProof,
  challengeUnit,
  challengeTarget,
  challengeProgress,
  challengeFraction,
  type Challenge,
  type LeaderboardEntry,
  type Proof,
} from "../../lib/challenges";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { ProgressBar } from "../../components/ProgressBar";
import { Avatar } from "../../components/Avatar";
import { Calendar, toDateStr } from "../../components/Calendar";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";

const TYPE_LABEL: Record<string, string> = { distance: "Distance", days: "Days", streak: "Streak" };
const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = { distance: "speedometer", days: "calendar", streak: "flame" };
const MEDAL = ["#FACC15", "#CBD5E1", "#D8965B"]; // gold / silver / bronze for the top 3

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]); // creator-only
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Proof submission modal
  const [showProof, setShowProof] = useState(false);
  const [strava, setStrava] = useState("");
  const [screenshot, setScreenshot] = useState("");
  const [km, setKm] = useState("");
  const [proofDate, setProofDate] = useState(toDateStr(new Date()));
  const [showCal, setShowCal] = useState(false);

  const isCreator = !!challenge && !!user && challenge.creator_id === user.id;

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const ch = await getChallenge(token, id);
    setChallenge(ch);
    setBoard(await getLeaderboard(token, id));
    if (user && ch.creator_id === user.id) {
      try {
        setProofs(await listProof(token, id));
      } catch {
        setProofs([]);
      }
    }
  }, [getAccessToken, id, user]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch (e) {
          if (active) setError(e instanceof ApiError ? e.message : "Something went wrong");
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  if (!user) return <Redirect href="/login" />;

  async function run(fn: (token: string) => Promise<unknown>) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await fn(token!);
      await load();
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function confirmJoin() {
    if (!challenge) return;
    const fee = challenge.join_fee ?? 0;
    if (fee > 0) {
      Alert.alert("Join challenge", `This challenge has a ₹${fee} join fee. Pay and join? (mock payment)`, [
        { text: "Cancel", style: "cancel" },
        { text: `Pay ₹${fee} & join`, onPress: () => run((t) => joinChallenge(t, id, { paid: true })) },
      ]);
    } else {
      Alert.alert("Join challenge", "Are you ready to join this challenge?", [
        { text: "Cancel", style: "cancel" },
        { text: "Join", onPress: () => run((t) => joinChallenge(t, id)) },
      ]);
    }
  }

  function confirmLeave() {
    Alert.alert("Leave challenge", "Remove yourself from this challenge? Your progress will be discarded.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => run((t) => leaveChallenge(t, id)) },
    ]);
  }

  // Challenge phase from its date window, and what actions are open.
  const now = Date.now();
  const started = !!challenge && now >= new Date(challenge.start_date).getTime();
  const ended = !!challenge && now > new Date(challenge.end_date).getTime();
  const phase: "upcoming" | "running" | "ended" = ended ? "ended" : started ? "running" : "upcoming";
  const canJoin = !!challenge && !challenge.joined && phase === "upcoming";
  // Leaving closes at the lock date, or at the start if the organiser set none.
  const leaveCutoff = challenge ? new Date(challenge.lock_date ?? challenge.start_date).getTime() : 0;
  const canLeave = !!challenge && challenge.joined && now < leaveCutoff;

  async function onSubmitProof() {
    if (!challenge) return;
    if (!strava.trim() && !screenshot.trim()) {
      Alert.alert("Add proof", "Paste a Strava link or a screenshot URL.");
      return;
    }
    await run((t) =>
      submitProof(t, id, {
        strava_link: strava.trim() || undefined,
        screenshot_url: screenshot.trim() || undefined,
        km_claimed: challenge.type === "distance" && km.trim() ? Number(km) : undefined,
        proof_date: proofDate,
      })
    );
    setShowProof(false);
    setStrava("");
    setScreenshot("");
    setKm("");
    setShowCal(false);
  }

  const unit = challenge ? challengeUnit(challenge) : "km";
  const target = challenge ? challengeTarget(challenge) : 0;
  const pendingProofs = proofs.filter((p) => !p.verified);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger }}>{error}</Text>
        ) : challenge ? (
          <>
            {/* Gradient header */}
            <LinearGradient
              colors={gradients.red}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 22, padding: 20, gap: 12, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 5 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <Text style={{ flex: 1, fontSize: 23, fontWeight: "800", color: "#fff", letterSpacing: -0.3 }}>{challenge.title}</Text>
                <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={TYPE_ICON[challenge.type]} size={24} color="#fff" />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <HeroChip text={TYPE_LABEL[challenge.type]} />
                <HeroChip text={challenge.visibility === "city" && challenge.city ? challenge.city : challenge.visibility} />
                <HeroChip text={phase} solid={phase === "running"} />
              </View>
              {challenge.description ? <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 14 }}>{challenge.description}</Text> : null}
              <View style={{ flexDirection: "row", gap: 20, marginTop: 2 }}>
                <HeroStat icon="flag" label="Goal" value={`${target} ${unit}`} />
                <HeroStat icon="calendar-clear" label="Window" value={`${fmtDate(challenge.start_date)} – ${fmtDate(challenge.end_date)}`} />
              </View>
            </LinearGradient>

            {/* Join / progress (gated by the challenge phase) */}
            {challenge.joined ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Your progress</Text>
                <View style={{ gap: 6, marginTop: 8 }}>
                  <ProgressBar fraction={challengeFraction(challenge)} />
                  <Text style={{ color: colors.muted, fontSize: 13 }}>
                    {challengeProgress(challenge)} / {target} {unit} ({Math.round(challengeFraction(challenge) * 100)}%)
                  </Text>
                </View>
                {!ended && (
                  <Pressable
                    onPress={() => setShowProof(true)}
                    disabled={busy}
                    style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>Submit proof</Text>
                  </Pressable>
                )}
                {canLeave ? (
                  <Pressable onPress={confirmLeave} disabled={busy} style={{ alignItems: "center", paddingVertical: 8, marginTop: 4 }}>
                    <Text style={{ color: colors.danger, fontWeight: "700" }}>Leave challenge</Text>
                  </Pressable>
                ) : !ended ? (
                  <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
                    {phase === "running" ? "You're locked in — the challenge is underway." : "Leaving is closed."}
                  </Text>
                ) : null}
              </View>
            ) : canJoin ? (
              <Pressable
                onPress={confirmJoin}
                disabled={busy}
                style={{ backgroundColor: colors.primary, opacity: busy ? 0.7 : 1, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                    {challenge.join_fee ? `Join · ₹${challenge.join_fee}` : "Join challenge"}
                  </Text>
                )}
              </Pressable>
            ) : (
              <View style={[styles.card, { alignItems: "center" }]}>
                <Text style={{ color: colors.muted, fontWeight: "600", textAlign: "center" }}>
                  {phase === "ended" ? "This challenge has ended." : "Joining has closed — the challenge is underway."}
                </Text>
              </View>
            )}

            {/* Creator: proof review queue */}
            {isCreator && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Proof to review ({pendingProofs.length})</Text>
                {pendingProofs.length === 0 ? (
                  <Text style={{ color: colors.muted, marginTop: 8 }}>No pending proof.</Text>
                ) : (
                  pendingProofs.map((p, i) => (
                    <View
                      key={p.id}
                      style={{ paddingVertical: 12, borderBottomWidth: i === pendingProofs.length - 1 ? 0 : 1, borderBottomColor: colors.border, gap: 6 }}
                    >
                      {p.proof_date ? <Text style={{ color: colors.text, fontWeight: "700" }}>For {p.proof_date}</Text> : null}
                      {p.km_claimed != null && <Text style={{ color: colors.text }}>Claims {p.km_claimed} km</Text>}
                      {p.strava_link ? <Text style={{ color: colors.accent, fontSize: 12 }}>{p.strava_link}</Text> : null}
                      {p.screenshot_url ? <Text style={{ color: colors.accent, fontSize: 12 }}>{p.screenshot_url}</Text> : null}
                      <Pressable
                        onPress={() => run((t) => verifyProof(t, id, p.id))}
                        disabled={busy}
                        style={{ alignSelf: "flex-start", backgroundColor: colors.success, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Verify</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* Leaderboard */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Leaderboard</Text>
              {board.length === 0 ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>No progress yet — be the first.</Text>
              ) : (
                board.map((e, i) => {
                  const me = e.user_id === user.id;
                  const medal = e.rank <= 3 ? MEDAL[e.rank - 1] : null;
                  return (
                    <View
                      key={e.user_id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 10,
                        paddingHorizontal: me ? 8 : 0,
                        marginHorizontal: me ? -8 : 0,
                        borderRadius: 12,
                        backgroundColor: me ? colors.primarySoft : "transparent",
                        borderBottomWidth: i === board.length - 1 || me ? 0 : 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: medal ?? colors.bgSecondary }}>
                        <Text style={{ color: medal ? "#0B1220" : colors.muted, fontWeight: "800", fontSize: 12 }}>{e.rank}</Text>
                      </View>
                      <Avatar name={e.display_name || "?"} size={34} bg={colors.accent} />
                      <Text style={{ flex: 1, color: me ? colors.primary : colors.text, fontWeight: me ? "800" : "600" }}>
                        {e.display_name || "Unknown"} {me ? "(you)" : ""}
                      </Text>
                      <Text style={{ color: colors.text, fontWeight: "800" }}>
                        {e.score} <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 12 }}>{unit}</Text>
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Submit-proof modal */}
      <Modal visible={showProof} animationType="fade" transparent onRequestClose={() => setShowProof(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}
        >
          <View style={{ backgroundColor: colors.bg, borderRadius: 16, maxHeight: "88%" }}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Submit proof</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Paste a Strava link or a screenshot URL. The organiser verifies it.</Text>
            <TextInput style={styles.input} placeholder="Strava link" placeholderTextColor={colors.muted} autoCapitalize="none" value={strava} onChangeText={setStrava} />
            <TextInput style={styles.input} placeholder="Screenshot URL" placeholderTextColor={colors.muted} autoCapitalize="none" value={screenshot} onChangeText={setScreenshot} />
            {challenge?.type === "distance" && (
              <TextInput style={styles.input} placeholder="Distance claimed (km)" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={km} onChangeText={setKm} />
            )}

            <Pressable
              onPress={() => setShowCal((s) => !s)}
              style={[styles.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>Date: {proofDate}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{showCal ? "▴" : "▾"}</Text>
            </Pressable>
            {showCal && (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8 }}>
                <Calendar selected={proofDate} onSelect={(d) => { setProofDate(d); setShowCal(false); }} />
              </View>
            )}
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              With a Strava link the date is read from it; otherwise pick the run&apos;s date.
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={() => setShowProof(false)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                <Text style={{ color: colors.text, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSubmitProof}
                disabled={busy}
                style={{ flex: 1, backgroundColor: colors.primary, opacity: busy ? 0.7 : 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Submit</Text>}
              </Pressable>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function HeroChip({ text, solid }: { text: string; solid?: boolean }) {
  return (
    <View style={{ backgroundColor: solid ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
      <Text style={{ color: solid ? colors.primary : "#fff", fontSize: 11, fontWeight: "800", textTransform: "capitalize", letterSpacing: 0.2 }}>{text}</Text>
    </View>
  );
}

function HeroStat({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Ionicons name={icon} size={13} color="rgba(255,255,255,0.85)" />
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      </View>
      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}
