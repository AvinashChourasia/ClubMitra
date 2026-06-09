// Manage club — the admin console, reached from the gear in the club header.
// Keeps management (edit, inventory, insights, delete) out of the member-facing
// tab strip. Tools route to their own screens; Insights renders inline for roles
// allowed analytics (org / chapter admin, not co-admin).

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { getChapter, myChapters, deleteChapter, isChapterAdmin } from "../../../lib/clubs";
import { getDropoff, getEngagement, getVolume, type Dropoff, type Engagement, type VolumePoint } from "../../../lib/analytics";
import { colors, styles, useThemeMode } from "../../../lib/theme";

function ToolRow({ icon, label, onPress, danger, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.accent} />
      <Text style={{ flex: 1, color: danger ? colors.danger : colors.text, fontWeight: "600" }}>{label}</Text>
      {!danger && <Ionicons name="chevron-forward" size={18} color={colors.subtle} />}
    </Pressable>
  );
}

function Insights({ chapterId, getToken }: { chapterId: string; getToken: () => Promise<string | null> }) {
  const [eng, setEng] = useState<Engagement | null>(null);
  const [drop, setDrop] = useState<Dropoff | null>(null);
  const [vol, setVol] = useState<VolumePoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getToken();
          if (!token) return;
          const [e, d, v] = await Promise.all([getEngagement(token, chapterId), getDropoff(token, chapterId), getVolume(token, chapterId)]);
          if (active) {
            setEng(e);
            setDrop(d);
            setVol(v);
          }
        } catch {
          if (active) setFailed(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [getToken, chapterId])
  );

  if (failed) return <Text style={{ color: colors.muted, marginTop: 8 }}>Couldn&apos;t load insights.</Text>;
  if (!eng || !drop || !vol) return <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />;

  const maxKm = Math.max(1, ...vol.map((p) => p.km));
  const dropRows: [string, number][] = [
    ["7+ days quiet", drop.inactive_7d],
    ["14+ days quiet", drop.inactive_14d],
    ["30+ days quiet", drop.inactive_30d],
    ["60+ days quiet", drop.inactive_60d],
  ];

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Weekly engagement</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 6 }}>
          <Text style={{ color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1 }}>{eng.engagement_rate}%</Text>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>{eng.weekly_active}/{eng.total_members} active this week</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Drop-off</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Active members with no run logged / no check-in.</Text>
        {dropRows.map(([label, n], i) => (
          <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: i === dropRows.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.text }}>{label}</Text>
            <Text style={{ color: n > 0 ? colors.warning : colors.muted, fontWeight: "800" }}>{n}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Weekly volume</Text>
        {vol.length === 0 ? (
          <Text style={{ color: colors.muted, marginTop: 6 }}>No runs logged in the last 8 weeks.</Text>
        ) : (
          <View style={{ gap: 8, marginTop: 8 }}>
            {vol.map((p) => (
              <View key={p.week_start} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: colors.muted, fontSize: 11, width: 64 }}>{p.week_start.slice(5)}</Text>
                <View style={{ flex: 1, height: 10, backgroundColor: colors.bgSecondary, borderRadius: 5, overflow: "hidden" }}>
                  <View style={{ width: `${(p.km / maxKm) * 100}%`, height: "100%", backgroundColor: colors.primary }} />
                </View>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: "700", width: 56, textAlign: "right" }}>{p.km.toFixed(1)} km</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

export default function ManageClub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [name, setName] = useState("club");
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;
          const [ch, mine] = await Promise.all([getChapter(token, id), myChapters(token)]);
          if (active) {
            setName(ch.name);
            setRole(mine.find((c) => c.id === id)?.role ?? null);
          }
        } catch {
          /* keep defaults */
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken, id])
  );

  if (!user) return <Redirect href="/login" />;

  const isOwner = role === "org_admin";
  const canViewInsights = role === "org_admin" || role === "chapter_admin";

  function confirmDelete() {
    Alert.alert("Delete club?", "The club is hidden from everyone, but its data is kept (soft delete).", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const token = await getAccessToken();
            await deleteChapter(token!, id);
            router.replace("/clubs");
          } catch (e) {
            Alert.alert("Couldn't delete", e instanceof ApiError ? e.message : "Something went wrong");
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <View>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Manage</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>{name}</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : !isChapterAdmin(role) ? (
          <Text style={{ color: colors.muted, marginTop: 12 }}>You don&apos;t manage this club.</Text>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={[styles.sectionTitle, { marginBottom: 2 }]}>Club tools</Text>
              <ToolRow icon="create-outline" label="Edit club details" onPress={() => router.push(`/club/edit/${id}`)} />
              <ToolRow icon="cube-outline" label="Inventory" onPress={() => router.push(`/club/inventory/${id}`)} last={!isOwner} />
              {isOwner && <ToolRow icon="trash-outline" label="Delete club" danger last onPress={confirmDelete} />}
            </View>

            {canViewInsights && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 4 }]}>Insights</Text>
                <Insights chapterId={id} getToken={getAccessToken} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
