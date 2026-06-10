// Discovery building blocks shared by the guest tabs and the member Explore
// screen: the club/challenge teaser cards and the join gate. The gate is the
// heart of deferred auth — members join in place; guests get their intent
// stashed and are routed through signup, which resumes the join.

import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
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
import { RouteTrace } from "./RouteTrace";
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

// A synthetic ~2.5km loop so the GPS teaser shows the real RouteTrace (pace
// gradient, km markers) without needing a real run. Built once.
function demoRoute() {
  const coords = [] as { latitude: number; longitude: number }[];
  const times = [] as number[];
  let t = 0;
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    coords.push({
      latitude: 18.52 + 0.0035 * Math.sin(a) + 0.0008 * Math.sin(3 * a),
      longitude: 73.85 + 0.0045 * Math.cos(a) + 0.0006 * Math.sin(2 * a),
    });
    t += 24000 + 9000 * Math.sin(a * 2); // varying pace → visible gradient
    times.push(t);
  }
  return { coords, times };
}
export const DEMO_ROUTE = demoRoute();

// TrackRunCard: the GPS pitch that doubles as the Record entry point — shows the
// real RouteTrace (pace gradient + km markers) on a demo loop. Guests tap into
// signup; members tap straight into recording.
export function TrackRunCard({ onPress, title, subtitle }: { onPress: () => void; title?: string; subtitle?: string }) {
  return (
    <Tap onPress={onPress} style={[styles.card, { gap: 12, padding: 16 }]}>
      <RouteTrace coords={DEMO_ROUTE.coords} times={DEMO_ROUTE.times} height={150} live />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="navigate" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{title ?? "Track every run"}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{subtitle ?? "GPS route, pace, splits — and it counts for your club."}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtle} />
      </View>
    </Tap>
  );
}

// SearchBar: the shared rounded search field used across discovery + tabs.
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg, borderRadius: 12, paddingHorizontal: 12 }}>
      <Ionicons name="search" size={18} color={colors.muted} />
      <TextInput
        style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 15 }}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
      />
      {value !== "" && (
        <Tap haptic={false} onPress={() => onChange("")} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={colors.muted} />
        </Tap>
      )}
    </View>
  );
}

// ClubCarousel: horizontally-scrolling compact club tiles with Join buttons —
// the "popular clubs in your city" strip used on both guest and member homes.
export function ClubCarousel({ clubs, joiningId, onJoin }: { clubs: DiscoverClub[]; joiningId: string | null; onJoin: (c: DiscoverClub) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
      {clubs.map((c) => (
        <View key={c.id} style={[styles.card, { width: 200, gap: 10, alignItems: "center", paddingVertical: 18 }]}>
          <Avatar name={c.name} uri={c.logo} size={56} bg={colors.accent} />
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, textAlign: "center" }} numberOfLines={1}>{c.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{c.member_count} {c.member_count === 1 ? "member" : "members"}</Text>
          </View>
          {c.join_policy === "open" ? (
            <Tap
              onPress={() => onJoin(c)}
              disabled={joiningId === c.id}
              style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 8, opacity: joiningId === c.id ? 0.6 : 1 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{joiningId === c.id ? "Joining…" : "Join"}</Text>
            </Tap>
          ) : (
            <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Invite only</Text>
          )}
        </View>
      ))}
    </ScrollView>
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
