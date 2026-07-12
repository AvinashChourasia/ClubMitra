// Import a run — the guided GPX path for runners who record on Strava/Garmin.
// Pick a .gpx (or arrive here with one shared into the app via ?src=), see how to
// export from each app, and it lands as a recorded run that counts everywhere.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { useGpxImport } from "../../lib/gpx";
import { ApiError } from "../../lib/api";
import { colors, styles, useThemeMode } from "../../lib/theme";

const GUIDES: { app: string; icon: keyof typeof Ionicons.glyphMap; steps: string[] }[] = [
  {
    app: "Strava",
    icon: "fitness-outline",
    steps: [
      "On strava.com, open the run (GPX export is web-only).",
      "Click the ••• menu → Export GPX.",
      "Share that file to MarathonMitra, or save it and tap Choose a GPX file below.",
    ],
  },
  {
    app: "Garmin Connect",
    icon: "watch-outline",
    steps: [
      "Open the activity in Garmin Connect.",
      "Tap the ••• / gear menu → Export to GPX.",
      "Share it to MarathonMitra, or save it and tap Choose a GPX file below.",
    ],
  },
];

export default function ImportRun() {
  const { user } = useAuth();
  const { src } = useLocalSearchParams<{ src?: string }>();
  const router = useRouter();
  useThemeMode();
  const { importing, pickAndImport, importFromUri } = useGpxImport();
  const [autoTried, setAutoTried] = useState(false);
  const handledSrc = useRef(false);

  const finish = useCallback(
    (activityId: string) => {
      Alert.alert("Run imported 🎉", "It's been added to your runs and counts toward your clubs & challenges.", [
        { text: "View run", onPress: () => router.replace(`/activity/${activityId}` as Href) },
        { text: "Done", onPress: () => router.replace("/activity" as Href) },
      ]);
    },
    [router]
  );

  const fail = useCallback((e: unknown) => {
    const msg =
      e instanceof ApiError ? e.message : e instanceof URIError ? "That shared link looks malformed." : "Try a different .gpx file.";
    Alert.alert("Couldn't import that", msg);
  }, []);

  // Arrived with a file shared into the app → import it straight away (once).
  useEffect(() => {
    if (!src || handledSrc.current) return;
    handledSrc.current = true;
    (async () => {
      try {
        const act = await importFromUri(decodeURIComponent(src));
        if (act) finish(act.id);
      } catch (e) {
        fail(e);
      } finally {
        setAutoTried(true);
      }
    })();
  }, [src, importFromUri, finish, fail]);

  const onChoose = useCallback(async () => {
    try {
      const act = await pickAndImport();
      if (act) finish(act.id);
    } catch (e) {
      fail(e);
    }
  }, [pickAndImport, finish, fail]);

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/activity" as Href))} hitSlop={10} style={{ marginLeft: -4 }}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Import a run</Text>
        </View>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Recorded on Strava, Garmin, or another watch? Bring it in as a GPX — it counts toward your clubs, challenges, and badges, just like a run recorded here.
        </Text>

        {/* Primary action */}
        <Pressable
          onPress={onChoose}
          disabled={importing}
          style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: importing ? 0.6 : 1 }}
        >
          {importing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={19} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Choose a GPX file</Text>
            </>
          )}
        </Pressable>
        {src && !autoTried && (
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>Importing your shared file…</Text>
        )}

        {/* How to export */}
        <Text style={[styles.sectionTitle, { marginTop: 4 }]}>How to export your run</Text>
        {GUIDES.map((g) => (
          <View key={g.app} style={[styles.card, { gap: 10 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name={g.icon} size={18} color={colors.primary} />
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{g.app}</Text>
            </View>
            {g.steps.map((s, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12 }}>{i + 1}</Text>
                </View>
                <Text style={{ flex: 1, color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>{s}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", paddingHorizontal: 4 }}>
          <Ionicons name="share-outline" size={15} color={colors.subtle} style={{ marginTop: 2 }} />
          <Text style={{ flex: 1, color: colors.subtle, fontSize: 12.5, lineHeight: 18 }}>
            Tip: from Strava or Files, use Share → MarathonMitra to import a .gpx without leaving the other app.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
