// Bottom tab navigator. Clean modern bar with vector icons (Ionicons), a brand
// active tint, a subtle top hairline, and a WhatsApp-style unread badge on Chat.

import { useEffect } from "react";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { refreshUnread, useUnreadTotal } from "../../lib/unread";
import { colors } from "../../lib/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

function tab(name: IoniconName, outline: IoniconName) {
  return ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
    <Ionicons name={focused ? name : outline} size={size ?? 24} color={color} />
  );
}

export default function TabsLayout() {
  const { user, getAccessToken } = useAuth();
  const unread = useUnreadTotal();
  const insets = useSafeAreaInsets();

  // Keep the Chat badge fresh in the background; the chat list also pushes
  // exact counts whenever it loads.
  useEffect(() => {
    if (!user) return;
    void refreshUnread(getAccessToken);
    const timer = setInterval(() => void refreshUnread(getAccessToken), 45000);
    return () => clearInterval(timer);
  }, [user, getAccessToken]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtle,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: -2 },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // A fixed height must ADD the bottom inset: bottom-tabs pads the bar
          // by insets.bottom (Android 3-button nav ≈ 48dp), and a flat height
          // would leave too little room for the icons + labels.
          height: 60 + insets.bottom,
          paddingTop: 8,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: tab("home", "home-outline") }} />
      <Tabs.Screen name="events" options={{ title: "Events", tabBarIcon: tab("calendar", "calendar-outline") }} />
      <Tabs.Screen name="clubs" options={{ title: "Clubs", tabBarIcon: tab("people", "people-outline") }} />
      <Tabs.Screen name="challenges" options={{ title: "Challenges", tabBarIcon: tab("trophy", "trophy-outline") }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: tab("chatbubbles", "chatbubbles-outline"),
          tabBarBadge: user && unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.success, color: "#fff", fontSize: 11, fontWeight: "800" },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: tab("person-circle", "person-circle-outline") }} />
      {/* Settings is reached from the gear icon on the Profile tab (app/settings.tsx),
          so it's intentionally not a bottom-bar tab. */}
    </Tabs>
  );
}
