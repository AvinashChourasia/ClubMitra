// Runner profile — the public face of another runner: identity hero (avatar,
// city, gamification level), Follow / Message actions, and the social + run
// stats that make following meaningful. Reached by tapping a sender in a club
// chat, or any runner row in a followers/following list.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { getRunnerProfile, followRunner, unfollowRunner, type RunnerProfile } from "../../lib/social";
import { runningLevelLabel } from "../../lib/profile";
import { formatDistance } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { GradientCard } from "../../components/GradientCard";
import { Tap } from "../../components/Tap";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";

function memberSince(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString([], { month: "short", year: "numeric" });
}

export default function RunnerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token || !id) return;
      setProfile(await getRunnerProfile(token, id));
    } catch {
      /* keep last good */
    }
  }, [getAccessToken, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    const wasFollowing = profile.is_following;
    // Optimistic flip (button + follower count); reconcile with the server.
    setProfile((p) => (p ? { ...p, is_following: !wasFollowing, followers: p.followers + (wasFollowing ? -1 : 1) } : p));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no token");
      const res = wasFollowing ? await unfollowRunner(token, profile.id) : await followRunner(token, profile.id);
      setProfile((p) => (p ? { ...p, is_following: res.following, followers: res.followers } : p));
    } catch {
      setProfile((p) => (p ? { ...p, is_following: wasFollowing, followers: p.followers + (wasFollowing ? 1 : -1) } : p));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} hitSlop={12} haptic={false} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Tap>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text, flex: 1 }} numberOfLines={1}>
          {profile?.name ?? "Runner"}
        </Text>
      </View>

      {loading && !profile ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !profile ? (
        <View style={{ alignItems: "center", marginTop: 60, padding: 24 }}>
          <Ionicons name="person-circle-outline" size={48} color={colors.subtle} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Runner not found.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Identity hero */}
          <GradientCard colors={gradients.cool} glowColor={colors.accent} style={{ padding: 20, alignItems: "center", gap: 10 }}>
            <Avatar name={profile.name} uri={profile.profile_photo} size={88} bg="rgba(255,255,255,0.25)" />
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, letterSpacing: -0.3 }} numberOfLines={1}>
                {profile.name}
              </Text>
              {profile.city ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="location" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "600" }}>{profile.city}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 }}>
                <Ionicons name="trophy" size={13} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12.5 }}>
                  {profile.level_title} · {profile.xp.toLocaleString()} XP
                </Text>
              </View>
            </View>
          </GradientCard>

          {/* Follow + Message (not on your own profile) */}
          {!profile.is_self && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Tap
                onPress={toggleFollow}
                disabled={busy}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: 999,
                  backgroundColor: profile.is_following ? colors.bg : colors.primary,
                  borderWidth: 1,
                  borderColor: profile.is_following ? colors.border : colors.primary,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Ionicons name={profile.is_following ? "checkmark" : "person-add"} size={16} color={profile.is_following ? colors.text : "#fff"} />
                <Text style={{ color: profile.is_following ? colors.text : "#fff", fontWeight: "800", fontSize: 14 }}>
                  {profile.is_following ? "Following" : "Follow"}
                </Text>
              </Tap>
              <Tap
                onPress={() => router.push(`/thread/dm/${profile.id}` as Href)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
                <Text style={{ color: colors.accent, fontWeight: "800", fontSize: 14 }}>Message</Text>
              </Tap>
            </View>
          )}

          {/* Social + run stats */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <StatTile label="Followers" value={String(profile.followers)} onPress={() => router.push(`/u/${profile.id}/connections?tab=followers` as Href)} />
            <StatTile label="Following" value={String(profile.following)} onPress={() => router.push(`/u/${profile.id}/connections?tab=following` as Href)} />
            <StatTile label="Runs" value={String(profile.total_runs)} />
            <StatTile label="Distance" value={formatDistance(profile.total_distance_m)} />
          </View>

          {/* Meta */}
          <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <Ionicons name="calendar-outline" size={18} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>Running with ClubMitra since {memberSince(profile.member_since)}</Text>
          </View>
          {profile.running_level ? (
            <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
              <Ionicons name="fitness-outline" size={18} color={colors.muted} />
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{runningLevelLabel(profile.running_level)} runner</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="medal" size={15} color={colors.warning} />
              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>
                {profile.badges} badge{profile.badges === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatTile({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const content = (
    <>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  return onPress ? (
    <Tap haptic={false} onPress={onPress} style={[styles.statCard]}>
      {content}
    </Tap>
  ) : (
    <View style={[styles.statCard]}>{content}</View>
  );
}
