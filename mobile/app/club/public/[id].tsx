// Public club profile — the non-member's view of a club, reached from the
// directory/explore. No auth gate: guests can browse and tap Join (which routes
// them through signup and resumes the join). Logged-in users get an "Open club"
// button into the full member experience.

import { useCallback, useState } from "react";
import { ActivityIndicator, ImageBackground, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { publicClub, type DiscoverClub } from "../../../lib/discover";
import { useJoinGate } from "../../../components/discovery";
import { Avatar } from "../../../components/Avatar";
import { Tap } from "../../../components/Tap";
import { colors, styles, useThemeMode } from "../../../lib/theme";

export default function PublicClubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  useThemeMode();
  const { joinClub, joiningId } = useJoinGate();
  const [club, setClub] = useState<DiscoverClub | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setClub(await publicClub(id));
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // A guest who just signed in mid-flow shouldn't be stuck here — but we don't
  // force a redirect; the screen works for everyone. (No <Redirect> on purpose.)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/explore" as Href))} hitSlop={12} haptic={false} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Tap>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text, flex: 1 }} numberOfLines={1}>
          {club?.name ?? "Club"}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : missing || !club ? (
        <View style={{ alignItems: "center", marginTop: 60, padding: 24 }}>
          <Ionicons name="people-outline" size={48} color={colors.subtle} />
          <Text style={{ color: colors.muted, marginTop: 8, textAlign: "center" }}>This club isn&apos;t public or no longer exists.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Banner */}
          <ImageBackground
            source={club.banner ? { uri: club.banner } : undefined}
            style={{ height: 150, backgroundColor: colors.primary, justifyContent: "flex-end" }}
          >
            <View style={{ height: "100%", justifyContent: "flex-end", backgroundColor: club.banner ? "rgba(2,6,23,0.28)" : "transparent" }} />
          </ImageBackground>

          <View style={{ padding: 16, gap: 14, marginTop: -34 }}>
            {/* Logo + identity */}
            <View style={{ alignItems: "center", gap: 8 }}>
              <View style={{ borderRadius: 22, borderWidth: 3, borderColor: colors.bg }}>
                <Avatar name={club.name} uri={club.logo} size={76} bg={colors.accent} />
              </View>
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 22, letterSpacing: -0.3, textAlign: "center" }}>{club.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="location" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600" }}>{club.city}</Text>
                <Text style={{ color: colors.subtle }}>·</Text>
                <Ionicons name="people" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600" }}>
                  {club.member_count} {club.member_count === 1 ? "member" : "members"}
                </Text>
              </View>
            </View>

            {/* Primary action */}
            {user ? (
              <Tap onPress={() => router.push(`/club/${club.id}` as Href)} style={[styles.button, { borderRadius: 999 }]}>
                <Text style={styles.buttonText}>Open club</Text>
              </Tap>
            ) : club.join_policy === "open" ? (
              <Tap
                onPress={() => void joinClub(club)}
                disabled={joiningId === club.id}
                style={[styles.button, { borderRadius: 999, opacity: joiningId === club.id ? 0.6 : 1 }]}
              >
                <Text style={styles.buttonText}>{joiningId === club.id ? "Joining…" : "Join this club"}</Text>
              </Tap>
            ) : (
              <View style={[styles.card, { alignItems: "center", paddingVertical: 14 }]}>
                <Text style={{ color: colors.muted, fontWeight: "700" }}>Invite only — ask an admin for the invite link.</Text>
              </View>
            )}

            {/* Description */}
            {club.description ? (
              <View style={[styles.card, { gap: 6 }]}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 14 }}>About</Text>
                <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{club.description}</Text>
              </View>
            ) : null}

            {!user && (
              <Text style={{ color: colors.subtle, fontSize: 12, textAlign: "center", paddingHorizontal: 16 }}>
                Join to see runs, challenges, the club chat, and the leaderboard.
              </Text>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
