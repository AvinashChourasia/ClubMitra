// Challenge detail — the race-day screen. A type-themed hero, your progress as
// an animated gradient ring with smart coaching (what you need per day), a 3D
// podium for the top three, and confetti when the goal falls. Progress is
// GPS-native: every recorded run counts automatically — no proof, no review.
// The organiser can edit details until the start gun.

import { useCallback, useMemo, useState } from "react";
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
  updateChallenge,
  challengeUnit,
  challengeTarget,
  challengeProgress,
  challengeFraction,
  challengePhase,
  daysUntil,
  type Challenge,
  type LeaderboardEntry,
} from "../../lib/challenges";
import { GradientCard } from "../../components/GradientCard";
import { Ionicons } from "@expo/vector-icons";

import { ProgressRing, useCountUp } from "../../components/ProgressRing";
import { Podium3D } from "../../components/Podium3D";
import { Confetti } from "../../components/Confetti";
import { Avatar } from "../../components/Avatar";
import { Tap } from "../../components/Tap";
import { Calendar, toDateStr } from "../../components/Calendar";
import { TYPE_THEME, LiveDot } from "../../components/ChallengeBits";
import { colors, styles, useThemeMode } from "../../lib/theme";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
// Local-day ISO bounds, same convention the create form uses.
function startISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
function endISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    setChallenge(await getChallenge(token, id));
    setBoard(await getLeaderboard(token, id));
  }, [getAccessToken, id]);

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
      run((t) => joinChallenge(t, id));
    }
  }

  function confirmLeave() {
    Alert.alert("Leave challenge", "Remove yourself from this challenge? Your progress will be discarded.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => run((t) => leaveChallenge(t, id)) },
    ]);
  }

  const isCreator = !!challenge && challenge.creator_id === user.id;
  const phase = challenge ? challengePhase(challenge) : "upcoming";
  const canJoin = !!challenge && !challenge.joined && phase === "upcoming";
  const canEdit = isCreator && phase === "upcoming";
  const leaveCutoff = challenge ? new Date(challenge.lock_date ?? challenge.start_date).getTime() : 0;
  const canLeave = !!challenge && challenge.joined && Date.now() < leaveCutoff;

  const t = challenge ? TYPE_THEME[challenge.type] : TYPE_THEME.distance;
  const unit = challenge ? challengeUnit(challenge) : "km";
  const target = challenge ? challengeTarget(challenge) : 0;
  const progress = challenge ? challengeProgress(challenge) : 0;
  const frac = challenge ? challengeFraction(challenge) : 0;
  const completed = !!challenge?.joined && frac >= 1;
  const myRank = board.find((e) => e.user_id === user.id)?.rank ?? null;

  const fmtScore = (s: number) => (unit === "km" ? `${s.toFixed(1)} km` : `${Math.round(s)}d`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      {completed && <Confetti />}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Tap
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/challenges"))}
            hitSlop={12}
            haptic={false}
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Tap>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger }}>{error}</Text>
        ) : challenge ? (
          <>
            {/* ── Hero ─────────────────────────────────────────────── */}
            <GradientCard colors={t.hero} glowColor={t.hero[1]} radius={22} style={{ padding: 20, gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <Text style={{ flex: 1, fontSize: 23, fontWeight: "800", color: "#fff", letterSpacing: -0.3 }}>{challenge.title}</Text>
                {canEdit ? (
                  <Tap
                    onPress={() => setShowEdit(true)}
                    hitSlop={8}
                    style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="pencil" size={18} color="#fff" />
                  </Tap>
                ) : (
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={t.icon} size={20} color="#fff" />
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <HeroChip text={t.label} />
                <HeroChip text={challenge.visibility === "city" && challenge.city ? challenge.city : challenge.visibility} />
                {phase === "live" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
                    <LiveDot color={t.tint} size={6} />
                    <Text style={{ color: t.tint, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }}>LIVE</Text>
                  </View>
                ) : (
                  <HeroChip text={phase === "upcoming" ? `starts in ${daysUntil(challenge.start_date)}d` : "ended"} />
                )}
              </View>
              {challenge.description ? <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 14 }}>{challenge.description}</Text> : null}
              <View style={{ flexDirection: "row", gap: 14, marginTop: 2 }}>
                <HeroStat icon="flag" label="Goal" value={`${target} ${unit}`} />
                <HeroStat icon="calendar-clear" label="Window" value={`${fmtDate(challenge.start_date)} – ${fmtDate(challenge.end_date)}`} />
                <HeroStat icon="people" label="Runners" value={`${challenge.participant_count}`} />
              </View>
            </GradientCard>

            {/* ── Your progress ────────────────────────────────────── */}
            {challenge.joined ? (
              <ProgressCard challenge={challenge} myRank={myRank} completed={completed} />
            ) : canJoin ? (
              <Pressable
                onPress={confirmJoin}
                disabled={busy}
                style={{ backgroundColor: colors.primary, opacity: busy ? 0.7 : 1, borderRadius: 16, paddingVertical: 15, alignItems: "center" }}
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

            {/* ── GPS auto-tracking (replaces proof + review) ──────── */}
            {phase !== "ended" && (
              <View style={[styles.card, { gap: 10 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(18,183,106,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="navigate" size={18} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 14.5 }}>Auto-tracked by GPS</Text>
                      <LiveDot color={colors.success} size={6} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 1 }}>
                      {challenge.type === "distance"
                        ? "Every run you record adds its distance here instantly."
                        : "One recorded run a day moves you forward. No uploads, no review."}
                    </Text>
                  </View>
                </View>
                {challenge.joined && phase === "live" && (
                  <Tap
                    onPress={() => router.push("/activity/record")}
                    style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, backgroundColor: colors.text, borderRadius: 12, paddingVertical: 12 }}
                  >
                    <Ionicons name="play" size={15} color={colors.bg} />
                    <Text style={{ color: colors.bg, fontWeight: "800", fontSize: 14 }}>Record a run now</Text>
                  </Tap>
                )}
              </View>
            )}

            {/* ── Leaderboard: 3D podium + the chase pack ──────────── */}
            <View style={[styles.card, { gap: 4 }]}>
              <Text style={styles.sectionTitle}>Leaderboard</Text>
              {board.length === 0 ? (
                <Text style={{ color: colors.muted, marginTop: 8 }}>
                  {phase === "upcoming" ? "The board opens with the first run." : "No progress yet — be the first."}
                </Text>
              ) : (
                <>
                  <Podium3D
                    entries={board.slice(0, 3).map((e) => ({
                      name: e.display_name || "Unknown",
                      score: fmtScore(e.score),
                      you: e.user_id === user.id,
                    }))}
                  />
                  {board.length > 3 && <View style={{ height: 8 }} />}
                  {board.slice(3).map((e, i, rest) => {
                    const me = e.user_id === user.id;
                    return (
                      <View
                        key={e.user_id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                          paddingVertical: 10,
                          paddingHorizontal: me ? 10 : 0,
                          marginHorizontal: me ? -10 : 0,
                          borderRadius: 12,
                          backgroundColor: me ? colors.primarySoft : "transparent",
                          borderBottomWidth: i === rest.length - 1 || me ? 0 : 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <Text style={{ width: 26, textAlign: "center", color: colors.muted, fontWeight: "800", fontSize: 13 }}>{e.rank}</Text>
                        <Avatar name={e.display_name || "?"} size={34} bg={me ? colors.primary : colors.accent} />
                        <Text style={{ flex: 1, color: me ? colors.primary : colors.text, fontWeight: me ? "800" : "600" }} numberOfLines={1}>
                          {me ? "You" : e.display_name || "Unknown"}
                        </Text>
                        <Text style={{ color: colors.text, fontWeight: "800" }}>{fmtScore(e.score)}</Text>
                      </View>
                    );
                  })}
                </>
              )}
            </View>

            {/* ── Leave / locked-in note ───────────────────────────── */}
            {challenge.joined &&
              (canLeave ? (
                <Pressable onPress={confirmLeave} disabled={busy} style={{ alignItems: "center", paddingVertical: 6 }}>
                  <Text style={{ color: colors.danger, fontWeight: "700" }}>Leave challenge</Text>
                </Pressable>
              ) : phase !== "ended" ? (
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
                  {phase === "live" ? "You're locked in — the challenge is underway. 💪" : "Leaving is closed."}
                </Text>
              ) : null)}
          </>
        ) : null}
      </ScrollView>

      {/* ── Organiser edit (open until the start date). Mounted only while
          open so each visit starts from the current values; stays open if
          the save fails so nothing typed is lost. ───────────────── */}
      {challenge && showEdit && (
        <EditSheet
          challenge={challenge}
          busy={busy}
          onClose={() => setShowEdit(false)}
          onSave={async (body) => {
            setBusy(true);
            try {
              const token = await getAccessToken();
              await updateChallenge(token!, id, body);
              setShowEdit(false);
              await load();
            } catch (e) {
              Alert.alert("Couldn't save", e instanceof ApiError ? e.message : "Something went wrong");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ProgressCard: the animated ring + the numbers a runner actually wants — rank,
// runway, and what's needed per day to make it.
function ProgressCard({ challenge, myRank, completed }: { challenge: Challenge; myRank: number | null; completed: boolean }) {
  const t = TYPE_THEME[challenge.type];
  const unit = challengeUnit(challenge);
  const target = challengeTarget(challenge);
  const progress = challengeProgress(challenge);
  const frac = challengeFraction(challenge);
  const phase = challengePhase(challenge);
  const dLeft = daysUntil(challenge.end_date);
  const shown = useCountUp(progress);

  // The coach line: what it takes from here.
  let tip: string | null = null;
  if (completed) tip = null;
  else if (phase === "upcoming") tip = `Starts ${fmtDate(challenge.start_date)} — joining locked in. 🏁`;
  else if (phase === "ended") tip = "This one's in the books.";
  else if (challenge.type === "distance") {
    const remain = Math.max(0, target - progress);
    tip = `~${(remain / Math.max(1, dLeft)).toFixed(1)} km/day for ${dLeft}d gets it done.`;
  } else if (challenge.type === "days") {
    const remain = Math.ceil(Math.max(0, target - progress));
    tip = remain > dLeft ? `${remain} run days needed with ${dLeft}d left — make every day count.` : `Run ${remain} of the next ${dLeft} days to finish.`;
  } else {
    const remain = Math.ceil(Math.max(0, target - progress));
    tip = `${remain} more consecutive days — keep the flame alive.`;
  }

  return (
    <View style={[styles.card, { gap: 12 }]}>
      {completed && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(18,183,106,0.12)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Ionicons name="trophy" size={16} color={colors.success} />
          <Text style={{ color: colors.success, fontWeight: "800", fontSize: 13.5 }}>Goal completed — take a bow! 🎉</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <ProgressRing size={148} stroke={14} fraction={frac} colors={t.ring}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 34, letterSpacing: -1 }}>
            {unit === "km" ? shown.toFixed(1) : Math.round(shown)}
          </Text>
          <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12, marginTop: -3 }}>
            of {target} {unit}
          </Text>
          <Text style={{ color: t.tint, fontWeight: "800", fontSize: 12, marginTop: 2 }}>{Math.round(frac * 100)}%</Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: 12 }}>
          <MiniFact icon="podium" label="Your rank" value={myRank ? `#${myRank}` : "—"} tint={t.tint} />
          <MiniFact icon="hourglass" label="Time left" value={phase === "ended" ? "Done" : `${dLeft}d`} tint={t.tint} />
          {challenge.type === "streak" && (
            <MiniFact icon="flame" label="Current streak" value={`${challenge.current_streak}d`} tint="#F59E0B" />
          )}
        </View>
      </View>
      {tip && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.bgSecondary, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }}>
          <Ionicons name="sparkles" size={13} color={t.tint} />
          <Text style={{ flex: 1, color: colors.muted, fontSize: 12.5, fontWeight: "600" }}>{tip}</Text>
        </View>
      )}
    </View>
  );
}

function MiniFact({ icon, label, value, tint }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tint: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: `${tint}1C`, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={15} color={tint} />
      </View>
      <View>
        <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{value}</Text>
      </View>
    </View>
  );
}

// EditSheet: organiser's pre-start edit — title, story, target, window.
function EditSheet({
  challenge,
  busy,
  onClose,
  onSave,
}: {
  challenge: Challenge;
  busy: boolean;
  onClose: () => void;
  onSave: (body: { title: string; description: string; target_km?: number; target_days?: number; start_date: string; end_date: string }) => void;
}) {
  const [title, setTitle] = useState(challenge.title);
  const [desc, setDesc] = useState(challenge.description);
  const [target, setTarget] = useState(String(challengeTarget(challenge)));
  const [startStr, setStartStr] = useState(toDateStr(new Date(challenge.start_date)));
  const [endStr, setEndStr] = useState(toDateStr(new Date(challenge.end_date)));
  const [whichCal, setWhichCal] = useState<"start" | "end" | null>(null);
  const isDistance = challenge.type === "distance";
  const t = TYPE_THEME[challenge.type];

  const valid = useMemo(() => {
    const n = Number(target);
    return title.trim().length > 0 && n > 0 && endStr > startStr;
  }, [title, target, startStr, endStr]);

  function save() {
    onSave({
      title: title.trim(),
      description: desc.trim(),
      ...(isDistance ? { target_km: Number(target) } : { target_days: Math.round(Number(target)) }),
      start_date: startISO(startStr),
      end_date: endISO(endStr),
    });
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 22 }}
      >
        <View style={{ backgroundColor: colors.bg, borderRadius: 20, maxHeight: "88%" }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 11 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: `${t.tint}1C`, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="pencil" size={16} color={t.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>Edit challenge</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Open until the start — then it locks.</Text>
              </View>
            </View>

            <TextInput style={styles.input} placeholder="Title" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
            <TextInput
              style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
              placeholder="Description (optional)"
              placeholderTextColor={colors.muted}
              value={desc}
              onChangeText={setDesc}
              multiline
            />
            <TextInput
              style={styles.input}
              placeholder={isDistance ? "Target (km)" : "Target (days)"}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={target}
              onChangeText={setTarget}
            />

            <Pressable onPress={() => setWhichCal(whichCal === "start" ? null : "start")} style={[styles.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
              <Text style={{ color: colors.text, fontSize: 15 }}>Starts: {startStr}</Text>
              <Ionicons name="calendar-outline" size={16} color={colors.muted} />
            </Pressable>
            {whichCal === "start" && (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8 }}>
                <Calendar selected={startStr} onSelect={(d) => { setStartStr(d); setWhichCal(null); }} />
              </View>
            )}
            <Pressable onPress={() => setWhichCal(whichCal === "end" ? null : "end")} style={[styles.input, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
              <Text style={{ color: colors.text, fontSize: 15 }}>Ends: {endStr}</Text>
              <Ionicons name="calendar-outline" size={16} color={colors.muted} />
            </Pressable>
            {whichCal === "end" && (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8 }}>
                <Calendar selected={endStr} onSelect={(d) => { setEndStr(d); setWhichCal(null); }} />
              </View>
            )}
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>Everyone who joined gets a heads-up about the change.</Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable onPress={onClose} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ color: colors.text, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={busy || !valid}
                style={{ flex: 1, backgroundColor: colors.primary, opacity: busy || !valid ? 0.6 : 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Save changes</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HeroChip({ text }: { text: string }) {
  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", textTransform: "capitalize", letterSpacing: 0.2 }}>{text}</Text>
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
