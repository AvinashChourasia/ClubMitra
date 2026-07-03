// The root layout: loads the Inter brand font, then wraps the app in
// ThemeProvider (light/dark) + AuthProvider and declares the top-level Stack.

import { useEffect, useRef } from "react";
import { Stack, useRootNavigationState, useRouter, type Href } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
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
import { FollowProvider } from "../lib/follow";
import { MessageToast } from "../components/MessageToast";
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
  // Navigating before the root navigator mounts THROWS — and in a production
  // build an uncaught throw kills the app. That's exactly what a notification
  // tap does on cold start (the listener fires during boot), so deep links are
  // queued until the navigator reports ready, then pushed.
  const rootState = useRootNavigationState();
  const navReady = !!rootState?.key;
  const navReadyRef = useRef(false);
  navReadyRef.current = navReady;
  const pendingHref = useRef<Href | null>(null);
  // The response that LAUNCHED the app is REPLAYED to fresh listeners on every
  // mount — without this guard the same tap re-navigates (and used to re-crash)
  // on each reopen. Handle each physical tap exactly once.
  const handledTap = useRef<string | null>(null);
  // getInitialURL replays the launching URL on every reopen — handle a given
  // shared .gpx exactly once (else it re-imports and errors on each reopen).
  const handledFile = useRef<string | null>(null);
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

  // Flush a queued deep link once the navigator exists (small delay so the
  // initial route finishes mounting first).
  useEffect(() => {
    if (!navReady || !pendingHref.current) return;
    const href = pendingHref.current;
    pendingHref.current = null;
    const t = setTimeout(() => {
      try {
        router.push(href);
      } catch {
        /* never crash over a deep link */
      }
    }, 150);
    return () => clearTimeout(t);
  }, [navReady, router]);

  // Deep-link when a push notification is tapped, based on its data payload.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const tapId = `${response.notification.request.identifier}:${response.notification.date ?? ""}`;
      if (handledTap.current === tapId) return;
      handledTap.current = tapId;

      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;
      let href: string | null = null;
      if (data.type === "chat_message" && data.scope && data.id) {
        // Straight into the conversation the push came from.
        href = data.scope === "chapter" ? `/thread/club/${data.id}` : `/thread/dm/${data.id}`;
      } else if (data.type === "follow" && data.user_id) {
        href = `/u/${data.user_id}`; // open the new follower's profile
      } else if (data.run_id) href = `/run/${data.run_id}`;
      else if (data.challenge_id) href = `/challenge/${data.challenge_id}`;
      else if (data.type === "join_request" && data.chapter_id) href = `/club/${data.chapter_id}?tab=members`; // land the admin on the pending request
      else if (data.chapter_id) href = `/club/${data.chapter_id}`;
      if (!href) return;

      if (navReadyRef.current) {
        try {
          router.push(href as Href);
        } catch {
          pendingHref.current = href as Href; // navigator raced us — queue it
        }
      } else {
        pendingHref.current = href as Href; // cold start — queue until mounted
      }
    });
    return () => sub.remove();
  }, [router]);

  // Open-in / share-to-app: a .gpx handed to us by the OS (Strava export, Files,
  // Garmin) arrives as a file:// or content:// URL — route it to the import
  // screen. Queued like push taps so it never navigates before the navigator is
  // ready. App deep links (clubmitra://, https) are left to the router/OAuth.
  useEffect(() => {
    function route(url: string | null) {
      if (!url) return;
      const low = url.toLowerCase();
      if (!low.startsWith("file://") && !low.startsWith("content://")) return;
      if (handledFile.current === url) return; // already routed this file (reopen replay)
      handledFile.current = url;
      const href = `/activity/import?src=${encodeURIComponent(url)}` as Href;
      if (navReadyRef.current) {
        try {
          router.push(href);
        } catch {
          pendingHref.current = href;
        }
      } else {
        pendingHref.current = href;
      }
    }
    Linking.getInitialURL().then(route).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => route(e.url));
    return () => sub.remove();
  }, [router]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <FollowProvider>
              <ThemedStatusBar />
              <ThemedStack />
              <MessageToast />
            </FollowProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
