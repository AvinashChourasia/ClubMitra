// Bottom tab navigator. Clean modern bar with vector icons (Ionicons), a brand
// active tint, and a subtle top hairline.

import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../lib/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

function tab(name: IoniconName, outline: IoniconName) {
  return ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
    <Ionicons name={focused ? name : outline} size={size ?? 24} color={color} />
  );
}

export default function TabsLayout() {
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
          height: 88,
          paddingTop: 8,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: tab("home", "home-outline") }} />
      <Tabs.Screen name="clubs" options={{ title: "Clubs", tabBarIcon: tab("people", "people-outline") }} />
      <Tabs.Screen name="challenges" options={{ title: "Challenges", tabBarIcon: tab("trophy", "trophy-outline") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: tab("chatbubbles", "chatbubbles-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: tab("person-circle", "person-circle-outline") }} />
      {/* Settings is reached from the gear icon on the Profile tab (app/settings.tsx),
          so it's intentionally not a bottom-bar tab. */}
    </Tabs>
  );
}
