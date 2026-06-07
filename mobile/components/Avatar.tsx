// Avatar: a circular image or initials badge. Used for users and clubs.

import { Image, Text, View } from "react-native";
import { colors } from "../lib/theme";

type Props = {
  name: string;
  uri?: string | null;
  size?: number;
  bg?: string;
  color?: string;
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({ name, uri, size = 48, bg = colors.primary, color = "#fff" }: Props) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ color, fontSize: size * 0.38, fontWeight: "800" }}>{initialsOf(name)}</Text>
      )}
    </View>
  );
}
