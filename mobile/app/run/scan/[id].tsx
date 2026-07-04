// Member check-in: scan the organiser's QR (camera) or type the 6-digit code.
// Either way we POST the live code, which the server validates against the
// run's current rotating window — so presence is real, not a couch tap.
//
// The camera (expo-camera) is a native module: it works in a dev/standalone
// build, and we lazy-require it so Expo Go (where it may be absent) simply falls
// back to the code-entry path — which works everywhere, today.

import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { checkIn } from "../../../lib/attendance";
import { Tap } from "../../../components/Tap";
import { colors, styles } from "../../../lib/theme";

// Lazy camera: present in dev/standalone builds, may be absent in Expo Go.
let Camera: typeof import("expo-camera") | null = null;
try {
  Camera = require("expo-camera") as typeof import("expo-camera");
} catch {
  Camera = null;
}

// Pull the 6-digit code out of a scanned QR payload ("clubmitra:checkin:{run}:{code}")
// or accept a bare 6-digit string.
function parseCode(raw: string, runId: string): string | null {
  const m = raw.match(/clubmitra:checkin:([0-9a-f-]+):(\d{6})/i);
  if (m) return m[1] === runId ? m[2] : null; // ignore another run's QR
  const digits = raw.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

export default function CheckinScan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"scan" | "code">(Camera ? "scan" : "code");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  const camPerm = Camera?.useCameraPermissions ? Camera.useCameraPermissions() : [null, async () => {}];
  const permission = camPerm[0] as { granted: boolean } | null;
  const requestPermission = camPerm[1] as () => Promise<unknown>;

  const submit = useCallback(
    async (code: string) => {
      if (submitted.current) return;
      submitted.current = true;
      setBusy(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) return;
        await checkIn(token, id, { code });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace(`/run/${id}`);
      } catch (e) {
        submitted.current = false; // allow retry
        setError(e instanceof ApiError ? e.message : "Couldn't check in — try again");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [getAccessToken, id, router]
  );

  if (!user) return <Redirect href="/login" />;

  // Lazy native component — typed loose so JSX doesn't fight the maybe-undefined.
  const CameraView = Camera?.CameraView as React.ComponentType<any> | undefined;
  const canScan = !!CameraView && mode === "scan";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }}>
        <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace(`/run/${id}`))} hitSlop={12} haptic={false} style={{ marginLeft: -4, padding: 6 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Tap>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>Check in</Text>
      </View>

      {/* Mode toggle (only when the camera is available) */}
      {CameraView && (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
          <Toggle label="Scan QR" active={mode === "scan"} onPress={() => setMode("scan")} />
          <Toggle label="Enter code" active={mode === "code"} onPress={() => setMode("code")} />
        </View>
      )}

      {canScan ? (
        permission?.granted ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }: { data: string }) => {
                const code = parseCode(String(data), id);
                if (code && !submitted.current) void submit(code);
              }}
            />
            {/* Camera reaches the screen bottom (top-only SafeArea) — lift the
                overlay above the Android system nav bar. */}
            <View style={{ position: "absolute", bottom: 30 + insets.bottom, left: 0, right: 0, alignItems: "center" }}>
              <Text style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, overflow: "hidden", fontWeight: "700" }}>
                {busy ? "Checking in…" : "Point at the organiser's QR"}
              </Text>
              {error ? <Text style={{ color: "#fff", backgroundColor: "rgba(220,38,38,0.9)", marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: "hidden" }}>{error}</Text> : null}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
            <Ionicons name="camera-outline" size={40} color={colors.subtle} />
            <Text style={{ color: colors.muted, textAlign: "center" }}>Allow camera access to scan the check-in QR.</Text>
            <Tap onPress={() => void requestPermission()} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 }}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Enable camera</Text>
            </Tap>
            <Pressable onPress={() => setMode("code")} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "700" }}>Enter the code instead</Text>
            </Pressable>
          </View>
        )
      ) : (
        <View style={{ padding: 16, gap: 14 }}>
          <View style={[styles.card, { gap: 12, alignItems: "center", paddingVertical: 24 }]}>
            <Text style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>
              Enter the 6-digit code the organiser is showing.
            </Text>
            <TextInput
              style={{ fontSize: 36, fontWeight: "900", letterSpacing: 10, color: colors.text, textAlign: "center", borderBottomWidth: 2, borderBottomColor: colors.border, minWidth: 220, paddingVertical: 6 }}
              value={manual}
              onChangeText={(t) => setManual(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor={colors.subtle}
              autoFocus={!CameraView}
              maxLength={6}
            />
            {error ? <Text style={{ color: colors.danger, fontSize: 13, textAlign: "center" }}>{error}</Text> : null}
            <Tap
              onPress={() => void submit(manual)}
              disabled={busy || manual.length !== 6}
              style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 36, paddingVertical: 14, opacity: busy || manual.length !== 6 ? 0.5 : 1 }}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Check in</Text>}
            </Tap>
          </View>
          {!CameraView && (
            <Text style={{ color: colors.subtle, fontSize: 12, textAlign: "center" }}>
              📷 QR scanning turns on in the next app build — the code works for now.
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Tap haptic={false} onPress={onPress} style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999, backgroundColor: active ? colors.primary : colors.bg, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
      <Text style={{ color: active ? "#fff" : colors.muted, fontWeight: "800", fontSize: 13 }}>{label}</Text>
    </Tap>
  );
}
