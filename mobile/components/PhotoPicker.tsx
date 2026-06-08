// PhotoPicker: tap to pick an image from the library. Two shapes — a circular
// avatar (profile photo, club logo) and a wide "banner" rectangle (club hero).
// Shared by the register, edit-profile, and create/edit-club forms. The picked
// local URI is uploaded by the form on save (Cloudinary).

import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Linking, Pressable, Text, View } from "react-native";
import { colors } from "../lib/theme";

type Props = {
  uri: string | null;
  onChange: (uri: string | null) => void;
  label?: string;
  size?: number; // circle diameter / banner height
  shape?: "circle" | "banner";
};

export function PhotoPicker({ uri, onChange, label = "Add photo", size = 96, shape = "circle" }: Props) {
  const banner = shape === "banner";

  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access needed",
        perm.canAskAgain
          ? "ClubMitra needs access to your photos to set a picture."
          : "Enable photo access for ClubMitra in Settings to pick a picture.",
        perm.canAskAgain
          ? [{ text: "OK" }]
          : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: banner ? [16, 9] : [1, 1],
      quality: 0.6,
    });
    if (!result.canceled) onChange(result.assets[0].uri);
  }

  const box = banner
    ? { width: "100%" as const, height: size, borderRadius: 16 }
    : { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={{ alignItems: banner ? "stretch" : "center", gap: 6, alignSelf: "stretch" }}>
      <Pressable
        onPress={pick}
        style={{
          ...box,
          backgroundColor: colors.bgSecondary,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <Text style={{ color: colors.muted, fontSize: banner ? 22 : 28 }}>{banner ? "＋ banner" : "＋"}</Text>
        )}
      </Pressable>
      <Pressable onPress={pick} style={{ alignItems: "center" }}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
          {uri ? (banner ? "Change banner" : "Change photo") : label}
        </Text>
      </Pressable>
    </View>
  );
}
