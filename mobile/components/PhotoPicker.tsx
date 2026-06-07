// PhotoPicker: a circular avatar the user taps to pick an image from their
// library. Shared by the register, edit-profile, and create-club forms.
//
// NOTE: for now the picked image is LOCAL ONLY — there is no upload backend yet
// (profile photos / club logos land in Phase 2 via Cloudinary). The forms keep
// the local URI in state and preview it; it isn't persisted to the server. This
// gives us the feature and the UI without faking storage.

import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, Text, View } from "react-native";
import { colors } from "../lib/theme";

type Props = {
  uri: string | null;
  onChange: (uri: string | null) => void;
  label?: string;
  size?: number;
};

export function PhotoPicker({ uri, onChange, label = "Add photo", size = 96 }: Props) {
  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!result.canceled) onChange(result.assets[0].uri);
  }

  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Pressable
        onPress={pick}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.bgSecondary,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size }} />
        ) : (
          <Text style={{ color: colors.muted, fontSize: 28 }}>＋</Text>
        )}
      </Pressable>
      <Pressable onPress={pick}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>{uri ? "Change photo" : label}</Text>
      </Pressable>
    </View>
  );
}
