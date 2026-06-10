// Discovery building blocks shared by the guest tabs and the member Explore
// screen: the club/challenge teaser cards and the join gate. The gate is the
// heart of deferred auth — members join in place; guests get their intent
// stashed and are routed through signup, which resumes the join.

import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../lib/auth";
import {
  joinOpenClub,
  setPendingIntent,
  getGuestCity,
  setGuestCity,
  type DiscoverClub,
  type PublicChallenge,
} from "../lib/discover";
import { joinChallenge } from "../lib/challenges";
import { Avatar } from "./Avatar";
import { Tap } from "./Tap";
import { colors, styles } from "../lib/theme";

// useGuestCity: the discovery city — the member's profile city, else the city
// the guest picked on Welcome (persisted so every guest surface agrees).
export function useGuestCity(): [string, (c: string) => void] {
  const { user } = useAuth();
  const [city, setCity] = useState("");

  useEffect(() => {
    if (user?.city) setCity(user.city);
    else getGuestCity().then((c) => c && setCity(c));
  }, [user?.city]);

  const update = useCallback(
    (c: string) => {
      setCity(c);
      if (!user) void setGuestCity(c);
    },
    [user]
  );
  return [city, update];
}

// useJoinGate: join actions that work for everyone. Guests are sent to signup
// with a pending intent (resumed after); members join right here.
export function useJoinGate() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const joinClub = useCallback(
    async (club: DiscoverClub) => {
      if (!user) {
        await setPendingIntent({ type: "join_club", id: club.id, name: club.name });
        router.push("/register");
        return;
      }
      setJoiningId(club.id);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await joinOpenClub(token, club.id);
        Alert.alert(
          res.status === "active" ? "Welcome to the club! 🎉" : "Request sent",
          res.status === "active"
            ? `You're now a member of ${club.name}.`
            : res.status === "pending_payment"
              ? `${club.name} has a membership fee — open the club to pay and activate.`
              : `${club.name} reviews join requests — you'll be in once an admin approves.`,
          [{ text: "Open club", onPress: () => router.push(`/club/${club.id}`) }, { text: "OK" }]
        );
      } catch (e) {
        Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
      } finally {
        setJoiningId(null);
      }
    },
    [user, getAccessToken, router]
  );

  const joinPublicChallenge = useCallback(
    async (ch: PublicChallenge) => {
      if (!user) {
        await setPendingIntent({ type: "join_challenge", id: ch.id, name: ch.title });
        router.push("/register");
        return;
      }
      setJoiningId(ch.id);
      try {
        const token = await getAccessToken();
        if (!token) return;
        await joinChallenge(token, ch.id);
        Alert.alert("You're in! 🏁", `${ch.title} — go log those runs.`, [
          { text: "Open challenge", onPress: () => router.push(`/challenge/${ch.id}`) },
          { text: "OK" },
        ]);
      } catch (e) {
        Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
      } finally {
        setJoiningId(null);
      }
    },
    [user, getAccessToken, router]
  );

  return { joinClub, joinPublicChallenge, joiningId };
}

// JoinButton: the gate's visible end — pill button with a joining state.
function JoinButton({ joining, onPress }: { joining: boolean; onPress: () => void }) {
  return (
    <Tap
      onPress={onPress}
      disabled={joining}
      style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, opacity: joining ? 0.6 : 1 }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{joining ? "Joining…" : "Join"}</Text>
    </Tap>
  );
}

// DiscoverClubCard: one public club row — logo, name, city, size, Join/invite.
export function DiscoverClubCard({ club, joiningId, onJoin }: { club: DiscoverClub; joiningId: string | null; onJoin: (c: DiscoverClub) => void }) {
  return (
    <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
      <Avatar name={club.name} uri={club.logo} size={48} bg={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{club.name}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {club.city} · {club.member_count} {club.member_count === 1 ? "member" : "members"}
        </Text>
      </View>
      {club.join_policy === "open" ? (
        <JoinButton joining={joiningId === club.id} onPress={() => onJoin(club)} />
      ) : (
        <View style={{ backgroundColor: colors.bgSecondary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Invite only</Text>
        </View>
      )}
    </View>
  );
}

export function challengeGoal(ch: PublicChallenge): string {
  if (ch.type === "distance" && ch.target_km) return `${ch.target_km} km`;
  if (ch.target_days) return `${ch.target_days} days`;
  return ch.type;
}

export function challengeIcon(type: PublicChallenge["type"]): keyof typeof Ionicons.glyphMap {
  return type === "distance" ? "speedometer" : type === "streak" ? "flame" : "calendar";
}

function endDateLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// PublicChallengeCard: one public challenge row — goal, window, joined count.
export function PublicChallengeCard({ challenge: ch, joiningId, onJoin }: { challenge: PublicChallenge; joiningId: string | null; onJoin: (c: PublicChallenge) => void }) {
  return (
    <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={challengeIcon(ch.type)} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{ch.title}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {challengeGoal(ch)} · ends {endDateLabel(ch.end_date)} · {ch.participant_count} joined
        </Text>
      </View>
      <JoinButton joining={joiningId === ch.id} onPress={() => onJoin(ch)} />
    </View>
  );
}

// EmptyState: shared "nothing here" card for discovery lists.
export function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>{title}</Text>
      <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>{body}</Text>
    </View>
  );
}
