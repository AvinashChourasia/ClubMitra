// Achievement wall — built on runner psychology, not a settings page:
//   1. Identity first (level + XP runway — "I'm a Pacer").
//   2. NEXT UP — the 2–3 nearest unlocks with exact distance-to-goal. The
//      goal-gradient effect: runners push hardest when the finish is visible,
//      so this is the screen's motivational core.
//   3. YOUR MEDALS — earned only, displayed proudly, zero clutter.
//   4. Still to earn — small, quiet, collapsed ambition. A wall of grey
//      medals demotivates; a whisper of "there's more" invites.
// Fetching is also the award pass: anything earned off-device celebrates here.

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
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<BadgeStatus | null>(null);
  const [celebrate, setCelebrate] = useState<Badge[]>([]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const p = await getGamification(token);
      setProfile(p);
      if (p.new_badges.length > 0) setCelebrate(p.new_badges);
    } catch {
      setFailed(true); // error state with retry — never an endless spinner
    }
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) return <Redirect href="/login" />;

  const earned = (profile?.badges ?? []).filter((b) => b.earned);
  const locked = (profile?.badges ?? []).filter((b) => !b.earned);

  // The motivational core: nearest unlocks first. For a brand-new runner all
  // fractions are 0 and catalog order surfaces the natural firsts (first run,
  // first club, 25 km) — exactly the right onboarding.
  const nextUp = [...locked]
    .sort((a, b) => b.current / Math.max(1, b.target) - a.current / Math.max(1, a.target))
    .slice(0, 3);
  const nextIds = new Set(nextUp.map((b) => b.id));
  const rest = locked.filter((b) => !nextIds.has(b.id));
  const newestFirst = [...earned].sort((a, b) => (b.earned_at ?? "").localeCompare(a.earned_at ?? ""));

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
              {profile ? `${earned.length} of ${profile.badges.length} medals` : "Your trophy room"}
            </Text>
          </View>
        </View>

        {failed && profile === null ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32, gap: 8 }]}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.subtle} />
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>Couldn't load your achievements</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
              The server may be waking up — give it another try.
            </Text>
            <Tap onPress={() => void load()} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Retry</Text>
            </Tap>
          </View>
        ) : profile === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* ── Identity: level + XP runway ─────────────────────── */}
            <GradientCard colors={gradients.ink} glowColor="#0B1220" radius={22} style={{ padding: 20, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: "rgba(250,204,21,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 25 }}>⚡</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontSize: 23, fontWeight: "900", letterSpacing: -0.4 }}>{profile.level.title}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, fontWeight: "600" }}>
                    {profile.xp.toLocaleString()} XP
                  </Text>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <View style={{ height: 8, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 4, overflow: "hidden" }}>
                  <View
                    style={{
                      width: `${Math.round(Math.min(1, Math.max(0, profile.level.progress)) * 100)}%`,
                      height: "100%",
                      backgroundColor: "#FACC15",
                      borderRadius: 4,
                    }}
                  />
                </View>
                <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "600" }}>
                  {profile.level.next_at != null
                    ? `${(profile.level.next_at - profile.xp).toLocaleString()} XP to ${profile.level.next_title}`
                    : "Top of the ladder 🏆"}
                </Text>
              </View>
            </GradientCard>

            {/* ── Next up: the goal-gradient hook ─────────────────── */}
            {nextUp.length > 0 && (
              <View style={[styles.card, { gap: 2 }]}>
                <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>🎯 Next up</Text>
                {nextUp.map((b, i) => (
                  <NextUpRow key={b.id} badge={b} last={i === nextUp.length - 1} onPress={() => setSelected(b)} />
                ))}
              </View>
            )}

            {/* ── Your medals: earned only, proudly ───────────────── */}
            <View style={[styles.card, { gap: 6 }]}>
              <Text style={styles.sectionTitle}>🏅 Your medals</Text>
              {newestFirst.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 8 }}>
                  Your first run earns your first medal. Lace up. 👟
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {newestFirst.map((b) => (
                    <Tap key={b.id} onPress={() => setSelected(b)} haptic={false} style={{ width: "33.33%", alignItems: "center", paddingVertical: 10, gap: 4 }}>
                      <BadgeMedal emoji={b.emoji} color={tierColor(b.tier)} size={64} />
                      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 11.5, fontWeight: "700", maxWidth: 100 }}>
                        {b.name}
                      </Text>
                    </Tap>
                  ))}
                </View>
              )}
            </View>

            {/* ── Still to earn: quiet, compact ───────────────────── */}
            {rest.length > 0 && (
              <View style={[styles.card, { gap: 6 }]}>
                <Text style={styles.sectionTitle}>Still to earn · {rest.length}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {rest.map((b) => (
                    <Tap key={b.id} onPress={() => setSelected(b)} haptic={false} style={{ width: "25%", alignItems: "center", paddingVertical: 8, gap: 3 }}>
                      <BadgeMedal emoji={b.emoji} color={tierColor(b.tier)} size={46} locked />
                      <Text numberOfLines={1} style={{ color: colors.subtle, fontSize: 10, fontWeight: "600", maxWidth: 78 }}>
                        {b.name}
                      </Text>
                    </Tap>
                  ))}
                </View>
              </View>
            )}
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

// remainingText says exactly what closes the gap — the number a runner acts on.
function remainingText(b: BadgeStatus): string {
  if (b.target <= 1) return b.desc; // one-shot badges: the rule IS the hint
  const left = Math.max(0, b.target - b.current);
  if (b.unit === "km") return `${left.toFixed(1)} km to go`;
  const n = Math.ceil(left);
  const unit = n === 1 ? b.unit.replace(/s$/, "") : b.unit;
  return `${n} more ${unit}`;
}

function NextUpRow({ badge, last, onPress }: { badge: BadgeStatus; last: boolean; onPress: () => void }) {
  const frac = badge.target > 0 ? Math.min(1, badge.current / badge.target) : 0;
  return (
    <Tap
      onPress={onPress}
      haptic={false}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}
    >
      <BadgeMedal emoji={badge.emoji} color={tierColor(badge.tier)} size={46} locked />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1, color: colors.text, fontWeight: "800", fontSize: 14 }} numberOfLines={1}>
            {badge.name}
          </Text>
          <Text style={{ color: tierColor(badge.tier), fontWeight: "800", fontSize: 12 }}>{Math.round(frac * 100)}%</Text>
        </View>
        <View style={{ height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" }}>
          <View style={{ width: `${frac * 100}%`, height: "100%", backgroundColor: tierColor(badge.tier), borderRadius: 3 }} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
          {remainingText(badge)}
        </Text>
      </View>
    </Tap>
  );
}

function BadgeDetail({ badge, onClose }: { badge: BadgeStatus; onClose: () => void }) {
  const frac = badge.target > 0 ? Math.min(1, badge.current / badge.target) : 0;
  const category = BADGE_CATEGORIES.find((c) => c.key === badge.category)?.label ?? "";
  const tier = badge.tier >= 3 ? "Gold" : badge.tier === 2 ? "Silver" : "Bronze";
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.bg, borderRadius: 22, padding: 24, alignItems: "center", alignSelf: "stretch", gap: 6 }}>
          <BadgeMedal emoji={badge.emoji} color={tierColor(badge.tier)} size={130} locked={!badge.earned} />
          <Text style={{ color: colors.subtle, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>
            {category} · {tier}
          </Text>
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
                {remainingText(badge)} · worth {badge.xp} XP
              </Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
