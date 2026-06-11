// Achievement wall — the trophy room. Your level + XP runway up top, then the
// full badge catalog by family: earned medals in color, locked ones as grey
// silhouettes with live progress bars ("72/100 km"). Fetching the wall is also
// an award pass, so anything earned off-device (a challenge ending) celebrates
// right here.

import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import {
  getGamification,
  tierColor,
  BADGE_CATEGORIES,
  type GamificationProfile,
  type BadgeStatus,
  type Badge,
} from "../../lib/gamification";
import { BadgeMedal } from "../../components/BadgeMedal";
import { BadgeUnlockModal } from "../../components/BadgeUnlockModal";
import { GradientCard } from "../../components/GradientCard";
import { Tap } from "../../components/Tap";
import { colors, styles, gradients, useThemeMode } from "../../lib/theme";

export default function Achievements() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [selected, setSelected] = useState<BadgeStatus | null>(null);
  const [celebrate, setCelebrate] = useState<Badge[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;
          const p = await getGamification(token);
          if (!active) return;
          setProfile(p);
          if (p.new_badges.length > 0) setCelebrate(p.new_badges);
        } catch {
          if (active) setProfile(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken])
  );

  if (!user) return <Redirect href="/login" />;

  const earned = profile?.badges.filter((b) => b.earned).length ?? 0;
  const total = profile?.badges.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tap
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
            hitSlop={12}
            haptic={false}
            style={{ marginLeft: -8, padding: 6 }}
          >
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Tap>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Achievements</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {profile ? `${earned} of ${total} unlocked` : "Your trophy room"}
            </Text>
          </View>
        </View>

        {profile === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* Level hero */}
            <GradientCard colors={gradients.ink} glowColor="#0B1220" radius={22} style={{ padding: 20, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(250,204,21,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 26 }}>⚡</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }}>
                    LEVEL {profile.level.index + 1}
                  </Text>
                  <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.4 }}>{profile.level.title}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#FACC15", fontSize: 20, fontWeight: "900" }}>{profile.xp.toLocaleString()}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700" }}>XP</Text>
                </View>
              </View>
              <View style={{ height: 9, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 5, overflow: "hidden" }}>
                <View
                  style={{
                    width: `${Math.round(Math.min(1, Math.max(0, profile.level.progress)) * 100)}%`,
                    height: "100%",
                    backgroundColor: "#FACC15",
                    borderRadius: 5,
                  }}
                />
              </View>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" }}>
                {profile.level.next_at != null
                  ? `${(profile.level.next_at - profile.xp).toLocaleString()} XP to ${profile.level.next_title}`
                  : "Top of the ladder — Club Legend 🏆"}
              </Text>
            </GradientCard>

            {/* Badge families */}
            {BADGE_CATEGORIES.map(({ key, label }) => {
              const group = profile.badges.filter((b) => b.category === key);
              if (group.length === 0) return null;
              const got = group.filter((b) => b.earned).length;
              return (
                <View key={key} style={[styles.card, { gap: 4 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={styles.sectionTitle}>{label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
                      {got}/{group.length}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {group.map((b) => (
                      <BadgeCell key={b.id} badge={b} onPress={() => setSelected(b)} />
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Badge detail */}
      {selected && <BadgeDetail badge={selected} onClose={() => setSelected(null)} />}

      {/* Wall-discovered unlocks (e.g. a challenge ended since the last look) */}
      {celebrate.length > 0 && <BadgeUnlockModal badges={celebrate} onClose={() => setCelebrate([])} />}
    </SafeAreaView>
  );
}

function BadgeCell({ badge, onPress }: { badge: BadgeStatus; onPress: () => void }) {
  const frac = badge.target > 0 ? Math.min(1, badge.current / badge.target) : 0;
  return (
    <Tap onPress={onPress} haptic={false} style={{ width: "33.33%", alignItems: "center", paddingVertical: 10, gap: 2 }}>
      <BadgeMedal emoji={badge.emoji} color={tierColor(badge.tier)} size={68} locked={!badge.earned} />
      <Text
        numberOfLines={1}
        style={{ color: badge.earned ? colors.text : colors.muted, fontSize: 11.5, fontWeight: "700", maxWidth: 100 }}
      >
        {badge.name}
      </Text>
      {badge.earned ? (
        <Text style={{ color: colors.success, fontSize: 10, fontWeight: "800" }}>✓ earned</Text>
      ) : (
        <View style={{ width: 64, gap: 2, alignItems: "center" }}>
          <View style={{ width: 64, height: 3.5, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
            <View style={{ width: `${frac * 100}%`, height: "100%", backgroundColor: tierColor(badge.tier), borderRadius: 2 }} />
          </View>
          <Text style={{ color: colors.subtle, fontSize: 9.5, fontWeight: "700" }}>
            {fmtProgress(badge.current, badge.target)}
          </Text>
        </View>
      )}
    </Tap>
  );
}

function fmtProgress(current: number, target: number): string {
  const c = current >= 10 || Number.isInteger(current) ? Math.floor(current).toString() : current.toFixed(1);
  return `${c}/${target}`;
}

function BadgeDetail({ badge, onClose }: { badge: BadgeStatus; onClose: () => void }) {
  const frac = badge.target > 0 ? Math.min(1, badge.current / badge.target) : 0;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.bg, borderRadius: 22, padding: 24, alignItems: "center", alignSelf: "stretch", gap: 6 }}>
          <BadgeMedal emoji={badge.emoji} color={tierColor(badge.tier)} size={120} locked={!badge.earned} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" }}>{badge.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>{badge.desc}</Text>
          {badge.earned ? (
            <Text style={{ color: colors.success, fontWeight: "800", fontSize: 13, marginTop: 4 }}>
              Earned {badge.earned_at ? new Date(badge.earned_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""} · +{badge.xp} XP
            </Text>
          ) : (
            <View style={{ alignSelf: "stretch", gap: 5, marginTop: 6 }}>
              <View style={{ height: 7, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                <View style={{ width: `${frac * 100}%`, height: "100%", backgroundColor: tierColor(badge.tier), borderRadius: 4 }} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", textAlign: "center" }}>
                {fmtProgress(badge.current, badge.target)} {badge.unit} · worth {badge.xp} XP
              </Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
