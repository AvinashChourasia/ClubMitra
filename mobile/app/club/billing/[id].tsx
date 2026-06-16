// Club plan & billing (admin-only) — the club → platform subscription. Shows the
// current tier, member usage against the plan's limit, and the upgrade options.
// Buying a plan runs Razorpay hosted checkout (dormant until the backend has
// keys); on capture the backend stamps the tier + extends the period.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { getPlan, type PlanStatus, type PlanTier } from "../../../lib/clubs";
import { pay } from "../../../lib/payments";
import { colors, styles, useThemeMode } from "../../../lib/theme";

const TIER_LABELS: Record<string, string> = { free: "Free", team: "Team", club: "Club", club_plus: "Club+" };
const tierLabel = (t: string) => TIER_LABELS[t] ?? t;

export default function ClubBilling() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (token) setPlan(await getPlan(token, id));
  }, [getAccessToken, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load();
        } catch {
          if (active) setFailed(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  if (!user) return <Redirect href="/login" />;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  function choose(tier: PlanTier) {
    if (!tier.purchasable) return;
    Alert.alert(
      `Switch to ${tierLabel(tier.name)}?`,
      `₹${tier.price_rupees}/month · up to ${tier.member_limit} members.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Pay ₹${tier.price_rupees}`,
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                const token = await getAccessToken();
                const outcome = await pay(token!, {
                  purpose: "subscription",
                  targetId: id,
                  meta: { tier: tier.name },
                  desc: `${tierLabel(tier.name)} plan`,
                });
                if (outcome === "paid") {
                  await load();
                  Alert.alert("Plan updated 🎉", `Your club is now on the ${tierLabel(tier.name)} plan.`);
                } else if (outcome === "failed") {
                  Alert.alert("Almost there", "If your payment went through, it'll reflect in a moment.");
                }
              } catch (e) {
                Alert.alert("Couldn't start payment", e instanceof ApiError ? e.message : "Something went wrong");
              } finally {
                setBusy(false);
              }
            })(),
        },
      ]
    );
  }

  const usageFraction = plan && plan.member_limit > 0 ? Math.min(1, plan.member_count / plan.member_limit) : 0;
  const nearLimit = plan ? plan.member_count >= plan.member_limit : false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Plan & billing</Text>
        </View>

        {failed ? (
          <Text style={{ color: colors.muted, marginTop: 12 }}>Couldn&apos;t load the plan. Only club admins can manage billing.</Text>
        ) : plan === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : (
          <>
            {/* Current plan + usage */}
            <View style={[styles.card, { gap: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{tierLabel(plan.tier)} plan</Text>
                {plan.subscription_until && (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    renews {new Date(plan.subscription_until).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                )}
              </View>
              <View style={{ height: 10, backgroundColor: colors.bgSecondary, borderRadius: 5, overflow: "hidden" }}>
                <View style={{ width: `${usageFraction * 100}%`, height: "100%", backgroundColor: nearLimit ? colors.warning : colors.primary }} />
              </View>
              <Text style={{ color: nearLimit ? colors.warning : colors.muted, fontSize: 13, fontWeight: "600" }}>
                {plan.member_count} / {plan.member_limit} members{nearLimit ? " · limit reached — upgrade to grow" : ""}
              </Text>
            </View>

            {/* Tier catalog */}
            <Text style={[styles.sectionTitle, { marginTop: 4 }]}>Plans</Text>
            {plan.tiers.map((t) => {
              const current = t.name === plan.tier;
              return (
                <View key={t.name} style={[styles.card, { gap: 8, borderWidth: current ? 1.5 : 0, borderColor: colors.primary }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{tierLabel(t.name)}</Text>
                    <Text style={{ color: colors.text, fontWeight: "800" }}>
                      {t.price_rupees > 0 ? `₹${t.price_rupees}` : "Free"}
                      {t.price_rupees > 0 && <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 12 }}>/mo</Text>}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Up to {t.member_limit.toLocaleString()} members</Text>
                  {current ? (
                    <View style={{ paddingVertical: 9, alignItems: "center", backgroundColor: colors.primarySoft, borderRadius: 10 }}>
                      <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>Current plan</Text>
                    </View>
                  ) : t.purchasable ? (
                    <Pressable
                      onPress={() => choose(t)}
                      disabled={busy}
                      style={{ paddingVertical: 11, alignItems: "center", backgroundColor: colors.primary, borderRadius: 10 }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Choose {tierLabel(t.name)} · ₹{t.price_rupees}</Text>
                    </Pressable>
                  ) : t.name === "club_plus" ? (
                    <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 6 }}>Custom pricing — contact us</Text>
                  ) : null}
                </View>
              );
            })}

            <Text style={{ color: colors.subtle, fontSize: 11, textAlign: "center", marginTop: 4 }}>
              One-time per month · renew anytime. Payments are secured by Razorpay.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
