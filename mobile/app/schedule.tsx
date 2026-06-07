// Your schedule: every run across the clubs you belong to, as a weekly list +
// month calendar (shared RunScheduleView). Runs you've checked into are flagged.
// Powered by GET /runs/mine.

import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../lib/auth";
import { myRuns, type MyRun } from "../lib/attendance";
import { colors } from "../lib/theme";
import { RunScheduleView } from "../components/RunScheduleView";

export default function Schedule() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const [runs, setRuns] = useState<MyRun[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const token = await getAccessToken();
          if (token && active) setRuns(await myRuns(token));
        } catch {
          if (active) setRuns([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [getAccessToken])
  );

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Your schedule</Text>

        {runs === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <RunScheduleView runs={runs} onOpenRun={(id) => router.push(`/run/${id}`)} showChapter />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
