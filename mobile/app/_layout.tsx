// The root layout: loads the Inter brand font, then wraps the app in
// ThemeProvider (light/dark) + AuthProvider and declares the top-level Stack.

import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";

import "../lib/applyFont"; // patch Text -> Inter (by weight), before any render
import "../lib/locationTask"; // register the background run-tracking task at launch
import { AuthProvider } from "../lib/auth";
import { ThemeProvider, useThemeMode, colors } from "../lib/theme";

SplashScreen.preventAutoHideAsync();

// Status bar contrast follows the active scheme.
function ThemedStatusBar() {
  const { mode } = useThemeMode();
  return <StatusBar style={mode === "dark" ? "light" : "dark"} />;
}

// Subscribes to the theme so the Stack's background re-renders on change.
function ThemedStack() {
  useThemeMode();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgSecondary } }} />;
}

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Deep-link when a push notification is tapped, based on its data payload.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      if (data.run_id) router.push(`/run/${data.run_id}`);
      else if (data.challenge_id) router.push(`/challenge/${data.challenge_id}`);
      else if (data.chapter_id) router.push(`/club/${data.chapter_id}`);
    });
    return () => sub.remove();
  }, [router]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedStatusBar />
            <ThemedStack />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
