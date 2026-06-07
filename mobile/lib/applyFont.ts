// Make Inter the app's font GLOBALLY without editing every <Text>.
//
// Custom fonts ignore numeric fontWeight (each weight is a separate family), so
// we patch Text.render once to translate the resolved fontWeight into the right
// Inter family. Importing this module applies the patch (before any render).

import { createElement } from "react";
import { Text, StyleSheet } from "react-native";

const familyForWeight: Record<string, string> = {
  "100": "Inter_400Regular",
  "200": "Inter_400Regular",
  "300": "Inter_400Regular",
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  bold: "Inter_700Bold",
  "800": "Inter_800ExtraBold",
  "900": "Inter_800ExtraBold",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = Text as any;
if (T.render && !T.__interPatched) {
  const original = T.render;
  T.render = function patched(...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = original.apply(this, args);
    const flat = StyleSheet.flatten(el.props.style) || {};
    const weight = flat.fontWeight != null ? String(flat.fontWeight) : "400";
    const family = flat.fontFamily ?? familyForWeight[weight] ?? "Inter_400Regular";
    // Map weight -> family; strip fontWeight so it can't fight the family.
    return createElement(el.type, {
      ...el.props,
      style: [{ fontFamily: family }, el.props.style, { fontWeight: undefined }],
    });
  };
  T.__interPatched = true;
}
