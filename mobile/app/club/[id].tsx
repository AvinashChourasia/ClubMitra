// Club (chapter) detail. Header + invite code, then three tabs: Members
// (default), Run schedule (7-day list + calendar), and Challenges scoped to this
// club/org. Admins manage members, schedule runs, edit the club; the owner can
// promote members and soft-delete the club. Role comes from /chapters/mine.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ImageBackground, Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
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
  assignRole,
  approveMember,
  payMembership,
  setOwnStatus,
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
import { leaderboard, clubStanding, type BoardEntry, type ClubStanding, type Period } from "../../lib/runlog";
import { chapterFeed, type FeedItem } from "../../lib/activities";
import { formatDistance, formatPace } from "../../lib/format";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";
import { GradientCard } from "../../components/GradientCard";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../components/Avatar";
import { RunScheduleView } from "../../components/RunScheduleView";

type Tab = "feed" | "members" | "schedule" | "challenges" | "leaderboard";

const MEDAL = ["#FACC15", "#CBD5E1", "#D8965B"]; // gold / silver / bronze

// timeAgo renders a feed timestamp the way people read it ("2h ago").
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

// FeedTab — the club's activity feed: recent GPS runs by members, the social
// proof that the club is alive.
function FeedTab({ chapterId, meId, getToken }: { chapterId: string; meId: string; getToken: () => Promise<string | null> }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getToken();
          if (token && active) setItems(await chapterFeed(token, chapterId));
        } catch {
          if (active) setItems([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [chapterId, getToken])
  );

  if (items === null) return <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />;

  if (items.length === 0) {
    return (
      <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="footsteps" size={28} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>No runs yet</Text>
        <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
          Member runs show up here the moment they're recorded. Be the first!
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {items.map((f) => {
        const me = f.user_id === meId;
        return (
          <View key={f.activity_id} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
            <Avatar name={f.name} uri={f.profile_photo} size={44} bg={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>
                <Text style={{ fontWeight: "800" }}>{me ? "You" : f.name}</Text>
                <Text> ran </Text>
                <Text style={{ fontWeight: "800", color: colors.primary }}>{formatDistance(f.distance_m)}</Text>
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {formatPace(f.avg_pace_s_per_km)} · {timeAgo(f.started_at)}
              </Text>
            </View>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="walk" size={18} color={colors.primary} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// LeaderboardTab — the club's rolling board with a period switcher.
function LeaderboardTab({ chapterId, meId, getToken }: { chapterId: string; meId: string; getToken: () => Promise<string | null> }) {
  const PERIODS: [Period, string][] = [
    ["daily", "Today"],
    ["weekly", "Week"],
    ["monthly", "Month"],
    ["alltime", "All-time"],
  ];
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("weekly");
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [standing, setStanding] = useState<ClubStanding | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const token = await getToken();
        if (!token) return;
        const data = await leaderboard(token, chapterId, period);
        if (active) setEntries(data);
      })();
      return () => {
        active = false;
      };
    }, [getToken, chapterId, period])
  );

  // Club standing (XP/level + Member of the Week) is period-independent — fetch
  // once per focus.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const token = await getToken();
        if (!token) return;
        try {
          const s = await clubStanding(token, chapterId);
          if (active) setStanding(s);
        } catch {
          /* leave whatever we had */
        }
      })();
      return () => {
        active = false;
      };
    }, [getToken, chapterId])
  );

  const mow = standing?.member_of_week;

  return (
    <View style={{ gap: 12 }}>
      {/* Club standing — collective level + this week's standout runner */}
      {standing && (
        <View style={[styles.card, { gap: 12 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="ribbon" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{standing.level_title}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {standing.xp.toLocaleString()} club XP · {Math.round(standing.total_km).toLocaleString()} km all-time
              </Text>
            </View>
          </View>

          {standing.next_title && standing.next_at != null ? (
            <View style={{ gap: 5 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(Math.max(0, Math.min(1, standing.progress)) * 100)}%`, height: "100%", backgroundColor: colors.primary }} />
              </View>
              <Text style={{ color: colors.subtle, fontSize: 11 }}>
                {(standing.next_at - standing.xp).toLocaleString()} XP to {standing.next_title}
              </Text>
            </View>
          ) : (
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: "700" }}>Top club level reached 🏆</Text>
          )}

          {mow ? (
            <Pressable
              onPress={() => router.push(`/u/${mow.user_id}` as Href)}
              style={{ flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.bgSecondary, borderRadius: 14, padding: 11 }}
            >
              <Avatar name={mow.display_name} size={42} bg={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.warning, fontWeight: "800", fontSize: 10.5, letterSpacing: 0.5 }}>⭐ MEMBER OF THE WEEK</Text>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 14.5 }} numberOfLines={1}>{mow.display_name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {mow.km.toFixed(1)} km · {mow.runs} run{mow.runs === 1 ? "" : "s"} this week
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={{ flexDirection: "row", backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 }}>
        {PERIODS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setPeriod(key)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: period === key ? colors.primary : "transparent" }}
          >
            <Text style={{ color: period === key ? "#fff" : colors.muted, fontWeight: "700", fontSize: 12 }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        {entries === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : entries.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <Ionicons name="podium-outline" size={28} color={colors.subtle} />
            <Text style={{ color: colors.muted, marginTop: 8, textAlign: "center" }}>No runs logged for this period yet.</Text>
          </View>
        ) : (
          entries.map((e, i) => {
            const me = e.user_id === meId;
            const medal = e.rank <= 3 ? MEDAL[e.rank - 1] : null;
            return (
              <Pressable
                key={e.user_id}
                onPress={() => {
                  if (!me) router.push(`/u/${e.user_id}` as Href);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 10,
                  paddingHorizontal: me ? 8 : 0,
                  marginHorizontal: me ? -8 : 0,
                  borderRadius: 12,
                  backgroundColor: me ? colors.primarySoft : "transparent",
                  borderBottomWidth: i === entries.length - 1 || me ? 0 : 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: medal ?? colors.bgSecondary }}>
                  <Text style={{ color: medal ? "#0B1220" : colors.muted, fontWeight: "800", fontSize: 12 }}>{e.rank}</Text>
                </View>
                <Avatar name={e.display_name || "?"} size={34} bg={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: me ? colors.primary : colors.text, fontWeight: me ? "800" : "600" }}>
                    {e.display_name || "Unknown"} {me ? "(you)" : ""}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{e.runs} {e.runs === 1 ? "run" : "runs"}</Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: "800" }}>
                  {e.km.toFixed(1)} <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 12 }}>km</Text>
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}


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
  const [tab, setTab] = useState<Tab>("feed");
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

  // Header content (logo avatar + name/city), with an admin gear → Manage screen.
  // Management (edit/inventory/insights/delete) lives there, not in the tab strip.
  const headerInner = chapter && (
    <>
      <View style={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", borderRadius: 32 }}>
        <Avatar name={chapter.name} uri={chapter.logo} size={56} bg="rgba(255,255,255,0.18)" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 21, fontWeight: "800", color: "#fff", letterSpacing: -0.3 }}>{chapter.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
          <Ionicons name="location" size={13} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600" }}>
            {chapter.city}
            {members ? ` · ${members.length} member${members.length === 1 ? "" : "s"}` : ""}
            {chapter.join_policy === "open" ? " · open to join" : " · invite only"}
          </Text>
        </View>
        {chapter.description ? (
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4 }} numberOfLines={2}>
            {chapter.description}
          </Text>
        ) : null}
      </View>
      {isAdmin && (
        <Pressable onPress={() => router.push(`/club/manage/${id}`)} hitSlop={10}>
          <Ionicons name="settings-outline" size={22} color="#fff" />
        </Pressable>
      )}
    </>
  );

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
        text: `Set ${s.replace("_", " ")}`,
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ marginLeft: -8, padding: 6, alignSelf: "flex-start" }}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger }}>{error}</Text>
        ) : chapter ? (
          <>
            {/* Header — banner image when set, else the brand gradient */}
            {chapter.banner ? (
              <ImageBackground
                source={{ uri: chapter.banner }}
                imageStyle={{ borderRadius: 22 }}
                style={{
                  borderRadius: 22,
                  minHeight: 180,
                  justifyContent: "flex-end",
                  shadowColor: colors.primary,
                  shadowOpacity: 0.3,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 5,
                }}
              >
                {/* Content sits at the bottom over a scrim, banner art breathes above. */}
                <View
                  style={{
                    borderBottomLeftRadius: 22,
                    borderBottomRightRadius: 22,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    backgroundColor: "rgba(11,18,32,0.55)",
                  }}
                >
                  {headerInner}
                </View>
              </ImageBackground>
            ) : (
              <GradientCard colors={gradients.red} glowColor={colors.primary} radius={22} style={{ padding: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
                {headerInner}
              </GradientCard>
            )}

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

            {/* Self-service: take a break / come back (pauses you from the leaderboard) */}
            {(myStatus === "active" || myStatus === "on_leave") && (
              <Pressable onPress={() => withToken((t) => setOwnStatus(t, id, myStatus === "on_leave" ? "active" : "on_leave"))} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <Ionicons name={myStatus === "on_leave" ? "pause-circle" : "pause-circle-outline"} size={20} color={myStatus === "on_leave" ? colors.warning : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>{myStatus === "on_leave" ? "You're on leave" : "Active member"}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {myStatus === "on_leave" ? "Paused from the leaderboard" : "Tap to take a break (pause from the leaderboard)"}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontWeight: "700" }}>{myStatus === "on_leave" ? "Resume" : "On leave"}</Text>
              </Pressable>
            )}

            {/* Tabs — horizontally scrollable chips so five never feel cramped */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(
                [
                  ["feed", "Feed"],
                  ["members", "Members"],
                  ["schedule", "Schedule"],
                  ["challenges", "Challenges"],
                  ["leaderboard", "Leaders"],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={{
                    paddingVertical: 9,
                    paddingHorizontal: 16,
                    borderRadius: 999,
                    backgroundColor: tab === key ? colors.primary : colors.bg,
                    borderWidth: 1,
                    borderColor: tab === key ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ color: tab === key ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* --- Feed tab --- */}
            {tab === "feed" && <FeedTab chapterId={id} meId={user.id} getToken={getAccessToken} />}

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
                            {m.status.replace("_", " ")}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  )}
                </View>
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

            {/* --- Leaderboard tab --- */}
            {tab === "leaderboard" && <LeaderboardTab chapterId={id} meId={user.id} getToken={getAccessToken} />}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
