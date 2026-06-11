// Push notifications: register the device's Expo push token with the backend and
// show foreground notifications. Degrades gracefully — getting an Expo token
// fails in Expo Go on current SDKs (needs a dev/prod build), in which case we
// simply skip; the backend pipeline is ready for when a real build runs.

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { request } from "./api";

// Foreground behaviour: chat messages are handled by the in-app banner
// (components/MessageToast), so their OS notification stays silent while the
// app is open; everything else still banners + sounds.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const isChat = (n.request.content.data as Record<string, unknown> | undefined)?.type === "chat_message";
    return {
      shouldPlaySound: !isChat,
      shouldSetBadge: false,
      shouldShowBanner: !isChat,
      shouldShowList: true,
    };
  },
});

// The Expo token for this install, kept so we can unregister it on logout.
let currentToken: string | null = null;

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

// registerForPush asks permission, gets the Expo token, and saves it to the
// backend under the current user. Returns the token, or null if unavailable.
export async function registerForPush(authToken: string | null): Promise<string | null> {
  try {
    if (!Device.isDevice || !authToken) return null;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const pid = projectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    currentToken = tokenResp.data;

    await request("/push/token", { method: "POST", token: authToken, body: { token: currentToken, platform: Platform.OS } });
    return currentToken;
  } catch {
    // Expo Go / no projectId / permission denied — non-fatal.
    return null;
  }
}

// unregisterPush removes this device's token (called on logout).
export async function unregisterPush(authToken: string | null): Promise<void> {
  if (!authToken || !currentToken) return;
  try {
    await request("/push/token", { method: "DELETE", token: authToken, body: { token: currentToken } });
  } catch {
    // ignore
  }
  currentToken = null;
}
