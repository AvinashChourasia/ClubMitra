// Discovery building blocks shared by the guest tabs and the member Explore
// screen: the club/challenge teaser cards and the join gate. The gate is the
// heart of deferred auth — members join in place; guests get their intent
// stashed and are routed through signup, which resumes the join.

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";
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
import { colors, glow, gradients, radius, styles } from "../lib/theme";

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
          [{ text: "OK", style: "cancel" }, { text: "Open club", onPress: () => router.push(`/club/${club.id}`) }]
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
          { text: "OK", style: "cancel" },
          { text: "Open challenge", onPress: () => router.push(`/challenge/${ch.id}`) },
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

// DiscoverClubCard: one public club row — tap anywhere to open the club's public
// profile (banner, about, members → decide to join); the Join button is a quick
// path for open clubs.
export function DiscoverClubCard({ club, joiningId, onJoin }: { club: DiscoverClub; joiningId: string | null; onJoin: (c: DiscoverClub) => void }) {
  const router = useRouter();
  return (
    <Tap onPress={() => router.push(`/club/public/${club.id}`)} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Invite only</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.subtle} />
        </View>
      )}
    </Tap>
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
// Tap anywhere to open the challenge; guests get their intent stashed and go
// through signup first (same deferral as the Join button).
export function PublicChallengeCard({ challenge: ch, joiningId, onJoin }: { challenge: PublicChallenge; joiningId: string | null; onJoin: (c: PublicChallenge) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  return (
    <Tap
      onPress={async () => {
        if (!user) {
          await setPendingIntent({ type: "join_challenge", id: ch.id, name: ch.title });
          router.push("/register");
          return;
        }
        router.push(`/challenge/${ch.id}`);
      }}
      style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}
    >
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
    </Tap>
  );
}

// TrackRunCard: the Record entry point as a night-HUD hero — a slice of the
// record screen itself (ink gradient, pace-coloured route sweep) with a pulsing
// record button. Deliberately dark: it sits under the red greeting hero on Home,
// so ink contrasts instead of stacking two red gradients. Guests tap into
// signup; members tap straight into recording.
export function TrackRunCard({ onPress, title, subtitle }: { onPress: () => void; title?: string; subtitle?: string }) {
  // Endless soft pulse radiating from the record button — "alive, ready to go".
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.5, 0.15, 0] });

  return (
    <Tap onPress={onPress} scaleTo={0.97} style={{ borderRadius: radius.xl, ...glow("#0B1220", 0.3) }}>
      <LinearGradient
        colors={gradients.ink}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xl, overflow: "hidden", padding: 18 }}
      >
        {/* Decorative pace-gradient route sweeping the card (fast→slow ramp). */}
        <Svg
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          viewBox="0 0 360 150"
          preserveAspectRatio="xMidYMid slice"
        >
          <Defs>
            <SvgLinearGradient id="paceRamp" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#4ADE80" />
              <Stop offset="0.55" stopColor="#F59E0B" />
              <Stop offset="1" stopColor="#EF4444" />
            </SvgLinearGradient>
          </Defs>
          {/* Soft wide underlay, then the ramp line on top — the RouteTrace look. */}
          <Path d={MOTIF_PATH} stroke="rgba(255,255,255,0.07)" strokeWidth={16} fill="none" strokeLinecap="round" />
          <Path d={MOTIF_PATH} stroke="url(#paceRamp)" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeOpacity={0.85} />
          <Circle cx={26} cy={118} r={5} fill="#4ADE80" stroke="#fff" strokeWidth={1.5} />
        </Svg>

        {/* Top gloss so the card reads lit, like the app's other heroes. */}
        <LinearGradient
          colors={gradients.gloss}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: "55%" }}
          pointerEvents="none"
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ flex: 1, gap: 8 }}>
            {/* Eyebrow: live-styled GPS badge */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#4ADE80" }} />
              <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "800", letterSpacing: 1.6 }}>GPS TRACKER</Text>
            </View>
            <View>
              <Text style={{ color: "#fff", fontSize: 21, fontWeight: "800", letterSpacing: -0.4 }}>{title ?? "Track every run"}</Text>
              <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                {subtitle ?? "Every km counts for your club."}
              </Text>
            </View>
            {/* Feature chips — what the tracker gives you, at a glance */}
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <HeroChip icon="map" label="Live map" />
              <HeroChip icon="speedometer" label="Pace" />
              <HeroChip icon="flag" label="Km splits" />
            </View>
          </View>

          {/* The record button — pulsing halo, glossy red disc */}
          <View style={{ width: 74, height: 74, alignItems: "center", justifyContent: "center" }}>
            <Animated.View
              style={{
                position: "absolute",
                width: 62,
                height: 62,
                borderRadius: 31,
                backgroundColor: colors.primary,
                transform: [{ scale: ringScale }],
                opacity: ringOpacity,
              }}
            />
            <View
              style={{
                width: 62,
                height: 62,
                borderRadius: 31,
                backgroundColor: colors.primary,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2.5,
                borderColor: "rgba(255,255,255,0.85)",
                ...glow(colors.primary, 0.45),
              }}
            >
              <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
            </View>
          </View>
        </View>
      </LinearGradient>
    </Tap>
  );
}

// A smooth run-route squiggle sweeping the card, drawn once (viewBox 360×150).
const MOTIF_PATH = "M26,118 C60,128 84,96 104,78 C124,60 150,58 176,72 C202,86 224,120 252,118 C280,116 292,80 310,58 C322,44 338,36 352,34";

function HeroChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4.5 }}>
      <Ionicons name={icon} size={11} color="rgba(255,255,255,0.9)" />
      <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 11.5, fontWeight: "700" }}>{label}</Text>
    </View>
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
  const router = useRouter();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
      {clubs.map((c) => (
        <Tap key={c.id} onPress={() => router.push(`/club/public/${c.id}`)} style={[styles.card, { width: 200, gap: 10, alignItems: "center", paddingVertical: 18 }]}>
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
        </Tap>
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
