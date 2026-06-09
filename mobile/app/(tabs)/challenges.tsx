// Challenges tab: browse the challenges visible to you, filter to the ones you've
// joined, and open one for detail. Distance / days / streak, with progress on
// joined challenges.

import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { Tap } from "../../components/Tap";

import { useAuth } from "../../lib/auth";
import {
  listChallenges,
  challengeUnit,
  challengeTarget,
  challengeProgress,
  challengeFraction,
  type Challenge,
} from "../../lib/challenges";
import { ProgressBar } from "../../components/ProgressBar";
import { colors, styles, useThemeMode } from "../../lib/theme";

const TYPE_LABEL: Record<string, string> = { distance: "Distance", days: "Days", streak: "Streak" };
const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = { distance: "speedometer", days: "calendar", streak: "flame" };

export default function Challenges() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode(); // subscribe for instant theme updates
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (token) setChallenges(await listChallenges(token, joinedOnly));
    } catch {
      setChallenges([]);
    }
  }, [getAccessToken, joinedOnly]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
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

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Challenges</Text>
          <Tap
            onPress={() => router.push("/challenge/new")}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>New</Text>
          </Tap>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <FilterChip label="All" active={!joinedOnly} onPress={() => setJoinedOnly(false)} />
          <FilterChip label="Joined" active={joinedOnly} onPress={() => setJoinedOnly(true)} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : challenges.length === 0 ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 32, marginTop: 8 }]}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="trophy" size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 12 }}>
              {joinedOnly ? "No joined challenges" : "No challenges yet"}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4, textAlign: "center" }}>
              {joinedOnly ? "Join one from the All tab." : "Create one with New."}
            </Text>
          </View>
        ) : (
          challenges.map((c) => <ChallengeCard key={c.id} item={c} onPress={() => router.push(`/challenge/${c.id}`)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Tap
      onPress={onPress}
      haptic={false}
      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? colors.primary : colors.bg, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
    >
      <Text style={{ color: active ? "#fff" : colors.muted, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Tap>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Stat({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ionicons name={icon} size={13} color={colors.muted} />
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

function ChallengeCard({ item, onPress }: { item: Challenge; onPress: () => void }) {
  const unit = challengeUnit(item);
  const target = challengeTarget(item);
  const daysLeft = Math.ceil((new Date(item.end_date).getTime() - Date.now()) / 86400000);
  const timeLabel = daysLeft > 0 ? `${daysLeft}d left` : "Ended";

  return (
    <Tap onPress={onPress} style={[styles.card, { gap: 10, padding: 18 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={TYPE_ICON[item.type]} size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.text }}>{item.title}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
            <Tag text={TYPE_LABEL[item.type]} />
            <Tag text={item.visibility === "city" && item.city ? item.city : item.visibility} />
          </View>
        </View>
        {item.joined && (
          <View style={{ backgroundColor: colors.bgSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ color: colors.success, fontSize: 11, fontWeight: "800" }}>JOINED</Text>
          </View>
        )}
      </View>

      {item.description ? (
        <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        <Stat icon="flag" text={`${target} ${unit}`} />
        <Stat icon="people" text={`${item.participant_count} joined`} />
        <Stat icon="time" text={`${timeLabel} · ends ${fmtDate(item.end_date)}`} />
      </View>

      {item.joined && (
        <View style={{ gap: 4 }}>
          <ProgressBar fraction={challengeFraction(item)} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {challengeProgress(item)} / {target} {unit} ({Math.round(challengeFraction(item) * 100)}%)
          </Text>
        </View>
      )}
    </Tap>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <View style={{ backgroundColor: colors.bgSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>{text}</Text>
    </View>
  );
}
