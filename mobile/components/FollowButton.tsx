// FollowButton: the one follow/unfollow control used everywhere (search results,
// club member lists, leaderboards, chat). State + toggling come from FollowContext,
// so it works on any runner row without that list carrying follow state. Renders
// nothing for your own row.

import { Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../lib/auth";
import { useFollow } from "../lib/follow";
import { colors } from "../lib/theme";
import { Tap } from "./Tap";

export function FollowButton({ userId, size = "md" }: { userId: string; size?: "sm" | "md" }) {
  const { user } = useAuth();
  const { isFollowing, toggle } = useFollow();
  if (!user || user.id === userId) return null; // never follow yourself

  const following = isFollowing(userId);
  const sm = size === "sm";
  return (
    <Tap
      onPress={() => void toggle(userId)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingVertical: sm ? 7 : 11,
        paddingHorizontal: sm ? 14 : 18,
        borderRadius: 999,
        backgroundColor: following ? colors.bg : colors.primary,
        borderWidth: 1,
        borderColor: following ? colors.border : colors.primary,
      }}
    >
      <Ionicons name={following ? "checkmark" : "person-add"} size={sm ? 13 : 15} color={following ? colors.text : "#fff"} />
      <Text style={{ color: following ? colors.text : "#fff", fontWeight: "800", fontSize: sm ? 12 : 14 }}>
        {following ? "Following" : "Follow"}
      </Text>
    </Tap>
  );
}
