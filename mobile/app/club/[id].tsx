// Club (chapter) detail. Header + invite code, then three tabs: Members
// (default), Run schedule (7-day list + calendar), and Challenges scoped to this
// club/org. Admins manage members, schedule runs, edit the club; the owner can
// promote members and soft-delete the club. Role comes from /chapters/mine.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import {
  getChapter,
  listMembers,
  myChapters,
  isChapterAdmin,
  setMemberStatus,
  removeMember,
  deleteChapter,
  assignRole,
  approveMember,
  payMembership,
  MEMBER_STATUSES,
  type Chapter,
  type Member,
} from "../../lib/clubs";
import { listRuns, type Run } from "../../lib/attendance";
import {
  listChallenges,
  challengeUnit,
  challengeTarget,
  type Challenge,
} from "../../lib/challenges";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../components/Avatar";
import { RunScheduleView } from "../../components/RunScheduleView";

type Tab = "members" | "schedule" | "challenges";

export default function ClubDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  useThemeMode(); // subscribe for instant theme updates
  const router = useRouter();

  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("members");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const [ch, mine, runList, allChallenges] = await Promise.all([
      getChapter(token, id),
      myChapters(token),
      listRuns(token, id),
      listChallenges(token),
    ]);
    setChapter(ch);
    const myc = mine.find((c) => c.id === id);
    setRole(myc?.role ?? null);
    setMyStatus(myc?.status ?? null);
    setRuns(runList);
    setChallenges(allChallenges.filter((c) => c.chapter_id === id || (ch.org_id && c.org_id === ch.org_id)));
    try {
      setMembers(await listMembers(token, id)); // admin-only; 403 => not an admin
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) throw e;
      setMembers(null);
    }
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

  const isAdmin = isChapterAdmin(role);
  const isOwner = role === "org_admin";

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* keep last good state */
    }
    setRefreshing(false);
  }

  async function copyCode() {
    if (!chapter) return;
    await Clipboard.setStringAsync(chapter.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function shareInvite() {
    if (!chapter) return;
    await Share.share({ message: `Join ${chapter.name} on ClubMitra! Use invite code ${chapter.invite_code} in the app.` });
  }

  async function withToken(fn: (token: string) => Promise<unknown>) {
    try {
      const token = await getAccessToken();
      await fn(token!);
      await load();
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  // Mock payment: confirm, then call the pay endpoint (Razorpay is Phase 2).
  function payOrRenew() {
    if (!chapter) return;
    const amount = chapter.membership_fee_amount ?? 0;
    Alert.alert(
      myStatus === "active" ? "Renew membership" : "Pay membership fee",
      `Pay ₹${amount} (${chapter.membership_period ?? "monthly"})?  (mock payment)`,
      [
        { text: "Cancel", style: "cancel" },
        { text: `Pay ₹${amount}`, onPress: () => withToken((t) => payMembership(t, id)) },
      ]
    );
  }

  function manageMember(m: Member) {
    if (!isAdmin || !chapter) return;
    // Pending members get a single Approve action (not raw status changes).
    if (m.status === "pending") {
      Alert.alert(m.name, "Approve this join request?", [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => withToken((t) => approveMember(t, id, m.user_id)) },
        { text: "Reject", style: "destructive", onPress: () => withToken((t) => removeMember(t, id, m.user_id)) },
      ]);
      return;
    }
    const buttons: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [
      ...MEMBER_STATUSES.filter((s) => s !== m.status).map((s) => ({
        text: `Set ${s}`,
        onPress: () => withToken((t) => setMemberStatus(t, id, m.user_id, s)),
      })),
    ];
    if (isOwner) {
      buttons.push(
        { text: "Make chapter admin", onPress: () => withToken((t) => assignRole(t, chapter.org_id, m.user_id, "chapter_admin", id)) },
        { text: "Make co-admin", onPress: () => withToken((t) => assignRole(t, chapter.org_id, m.user_id, "co_admin", id)) }
      );
    }
    buttons.push(
      { text: "Remove from club", style: "destructive", onPress: () => withToken((t) => removeMember(t, id, m.user_id)) },
      { text: "Cancel", style: "cancel" }
    );
    Alert.alert(m.name, `Currently ${m.status}.`, buttons);
  }

  function confirmDelete() {
    Alert.alert("Delete club?", "The club is hidden from everyone, but its data is kept (soft delete).", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          withToken(async (t) => {
            await deleteChapter(t, id);
            router.replace("/clubs");
          }),
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger }}>{error}</Text>
        ) : chapter ? (
          <>
            {/* Gradient header */}
            <LinearGradient
              colors={gradients.red}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 22, padding: 20, flexDirection: "row", alignItems: "center", gap: 14, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 5 }}
            >
              <View style={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", borderRadius: 32 }}>
                <Avatar name={chapter.name} size={56} bg="rgba(255,255,255,0.18)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 21, fontWeight: "800", color: "#fff", letterSpacing: -0.3 }}>{chapter.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <Ionicons name="location" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600" }}>
                    {chapter.city}
                    {members ? ` · ${members.length} member${members.length === 1 ? "" : "s"}` : ""}
                  </Text>
                </View>
              </View>
              {isAdmin && (
                <Pressable onPress={() => router.push(`/club/edit/${id}`)} hitSlop={10}>
                  <Ionicons name="create-outline" size={22} color="#fff" />
                </Pressable>
              )}
            </LinearGradient>

            {/* Invite code (compact) */}
            <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <Pressable onPress={copyCode} style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Invite code {copied ? "· Copied!" : "· tap to copy"}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: "800", color: copied ? colors.success : colors.text, letterSpacing: 3 }}>
                  {chapter.invite_code}
                </Text>
              </Pressable>
              <Pressable onPress={shareInvite} style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Share</Text>
              </Pressable>
            </View>

            {/* Your membership banner */}
            {myStatus === "pending" && (
              <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <Ionicons name="time-outline" size={20} color={colors.warning} />
                <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>Awaiting admin approval</Text>
              </View>
            )}
            {myStatus === "pending_payment" && (
              <View style={[styles.card, { gap: 10 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="card-outline" size={20} color={colors.primary} />
                  <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>Approved — pay to activate</Text>
                </View>
                <Pressable onPress={payOrRenew} style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Pay ₹{chapter.membership_fee_amount ?? 0}</Text>
                </Pressable>
              </View>
            )}
            {myStatus === "active" && chapter.membership_fee_enabled && (
              <Pressable onPress={payOrRenew} style={[styles.card, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}>
                <Ionicons name="refresh" size={18} color={colors.accent} />
                <Text style={{ color: colors.accent, fontWeight: "700" }}>Renew membership (₹{chapter.membership_fee_amount ?? 0})</Text>
              </Pressable>
            )}

            {/* Tabs */}
            <View style={{ flexDirection: "row", backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 }}>
              {(
                [
                  ["members", "Members"],
                  ["schedule", "Schedule"],
                  ["challenges", "Challenges"],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center", backgroundColor: tab === key ? colors.primary : "transparent" }}
                >
                  <Text style={{ color: tab === key ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {/* --- Members tab --- */}
            {tab === "members" && (
              <>
                <View style={styles.card}>
                  {members === null ? (
                    <Text style={{ color: colors.muted }}>Member list is visible to club admins.</Text>
                  ) : members.length === 0 ? (
                    <Text style={{ color: colors.muted }}>No members yet — share the invite code.</Text>
                  ) : (
                    <>
                      {isAdmin && <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tap a member to manage.</Text>}
                      {members.map((m, i) => (
                        <Pressable
                          key={m.user_id}
                          onPress={() => manageMember(m)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            paddingVertical: 10,
                            borderBottomWidth: i === members.length - 1 ? 0 : 1,
                            borderBottomColor: colors.border,
                          }}
                        >
                          <Avatar name={m.name} size={36} bg={colors.accent} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: "600" }}>{m.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }}>{m.email}</Text>
                          </View>
                          <Text style={{ color: m.status === "active" ? colors.success : colors.muted, fontSize: 12, fontWeight: "700", textTransform: "capitalize" }}>
                            {m.status}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  )}
                </View>
                {isOwner && (
                  <Pressable
                    onPress={confirmDelete}
                    style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 13, alignItems: "center" }}
                  >
                    <Text style={{ color: colors.danger, fontWeight: "700" }}>Delete club</Text>
                  </Pressable>
                )}
              </>
            )}

            {/* --- Schedule tab --- */}
            {tab === "schedule" && (
              <>
                {isAdmin && (
                  <Pressable
                    onPress={() => router.push(`/run/new?chapter_id=${id}`)}
                    style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>+ Schedule a run</Text>
                  </Pressable>
                )}
                <RunScheduleView runs={runs} onOpenRun={(rid) => router.push(`/run/${rid}`)} showChapter={false} />
              </>
            )}

            {/* --- Challenges tab --- */}
            {tab === "challenges" && (
              <>
                {isAdmin && (
                  <Pressable
                    onPress={() => router.push("/challenge/new")}
                    style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>+ New challenge</Text>
                  </Pressable>
                )}
                {challenges.length === 0 ? (
                  <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                    <Text style={{ fontSize: 32 }}>🏆</Text>
                    <Text style={{ color: colors.muted, marginTop: 6, textAlign: "center" }}>No challenges for this club yet.</Text>
                  </View>
                ) : (
                  challenges.map((c) => (
                    <Pressable key={c.id} onPress={() => router.push(`/challenge/${c.id}`)} style={[styles.card, { gap: 6 }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontWeight: "800", color: colors.text, flex: 1 }}>{c.title}</Text>
                        {c.joined && (
                          <View style={{ backgroundColor: colors.bgSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                            <Text style={{ color: colors.success, fontSize: 11, fontWeight: "800" }}>JOINED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {challengeTarget(c)} {challengeUnit(c)} · {c.participant_count} joined
                      </Text>
                    </Pressable>
                  ))
                )}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
