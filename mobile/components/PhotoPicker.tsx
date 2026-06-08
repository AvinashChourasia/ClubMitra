// PhotoPicker: a circular avatar the user taps to pick an image from their
// library. Shared by the register, edit-profile, and create-club forms. The
// picked local URI is uploaded by the form on save (Cloudinary, Phase 2).

import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Linking, Pressable, Text, View } from "react-native";
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
