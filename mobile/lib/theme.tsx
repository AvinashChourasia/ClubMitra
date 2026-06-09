// Shared design system with light + dark themes.
//
// HOW THEMING WORKS (no per-screen wiring): `colors` and `styles` are LIVE
// module bindings. ThemeProvider sits at the app root and, on every render,
// swaps those bindings to the active palette and re-renders the whole tree — so
// every screen's inline `colors.x` / `styles.card` picks up the new values
// automatically. Screens just `import { colors, styles }` as before. Only
// values computed OUTSIDE render (module-level constants) must avoid baking a
// color in.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export type Palette = {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  accent: string;
  accentDark: string;
  success: string;
  warning: string;
  ink: string;
  text: string;
  muted: string;
  subtle: string;
  border: string;
  divider: string;
  bg: string;
  bgSecondary: string;
  fieldBg: string;
  danger: string;
  bubbleMine: string; // own chat bubble (always pairs with white text)
};

const light: Palette = {
  primary: "#E11D2E",
  primaryDark: "#B3121F",
  primarySoft: "#FFE4E6",
  accent: "#2563EB",
  accentDark: "#1E3A8A",
  success: "#12B76A",
  warning: "#F59E0B",
  ink: "#0B1220",
  text: "#0F172A",
  muted: "#64748B",
  subtle: "#94A3B8",
  border: "#EAEDF1",
  divider: "#F1F3F6",
  bg: "#FFFFFF",
  bgSecondary: "#F4F5F7",
  fieldBg: "#F1F5F9",
  danger: "#E11D2E",
  bubbleMine: "#2563EB",
};

const dark: Palette = {
  primary: "#F43F5E",
  primaryDark: "#E11D2E",
  primarySoft: "#2A1620",
  accent: "#60A5FA",
  accentDark: "#93C5FD",
  success: "#34D399",
  warning: "#FBBF24",
  ink: "#06080F",
  text: "#F1F5F9",
  muted: "#94A3B8",
  subtle: "#64748B",
  border: "#242C3A",
  divider: "#1B2230",
  bg: "#151C29", // elevated card surface
  bgSecondary: "#0B1018", // app background
  fieldBg: "#1B2433",
  danger: "#F43F5E",
  bubbleMine: "#2F6FED",
};

// Theme-independent tokens.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, x2: 24, x3: 32, x4: 40 };
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, x2: 32, pill: 999 };

// Gradients. `red`/`ink` kept for back-compat; `gloss` is the white top-highlight
// overlay that gives heroes a lit, glassy look; `cool`/`sunset` add variety.
export const gradients = {
  red: ["#FF4D67", "#E11D2E"] as const,
  ink: ["#1E293B", "#0B1220"] as const,
  cool: ["#6366F1", "#4F46E5"] as const,
  sunset: ["#FB7185", "#F59E0B"] as const,
  gloss: ["rgba(255,255,255,0.14)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0)"] as const,
};

// Soft, layered elevation tiers (bigger radius + softer falloff = more depth).
// card/raised kept as aliases so existing callers don't break.
export const shadow = {
  sm: { shadowColor: "#0B1220", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  md: { shadowColor: "#0B1220", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  lg: { shadowColor: "#0B1220", shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 8 },
  xl: { shadowColor: "#0B1220", shadowOpacity: 0.18, shadowRadius: 44, shadowOffset: { width: 0, height: 24 }, elevation: 14 },
  card: { shadowColor: "#0B1220", shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  raised: { shadowColor: "#0B1220", shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 8 },
};

// glow returns a soft colored shadow under gradient heroes — kept subtle so it
// reads as quiet depth, not a neon halo.
export function glow(color: string, opacity = 0.22) {
  return { shadowColor: color, shadowOpacity: opacity, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8 };
}

// makeStyles builds the shared stylesheet for a palette. In dark mode cards get a
// hairline border (shadows are invisible on dark surfaces).
function makeStyles(c: Palette, isDark: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 24, justifyContent: "center", gap: 16 },
    formContent: { flexGrow: 1, backgroundColor: c.bg, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 96, gap: 14 },
    title: { fontSize: 30, fontWeight: "800", color: c.text, letterSpacing: -0.5 },
    subtitle: { fontSize: 15, color: c.muted, marginBottom: 8 },
    input: {
      backgroundColor: c.fieldBg,
      borderWidth: 1,
      borderColor: isDark ? c.border : "transparent",
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 13,
      fontSize: 16,
      color: c.text,
      fontFamily: "Inter_400Regular",
    },
    button: {
      backgroundColor: c.primary,
      borderRadius: radius.lg,
      paddingVertical: 16,
      alignItems: "center",
      shadowColor: c.primary,
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
    error: { color: c.danger, fontSize: 14, fontWeight: "500" },
    link: { color: c.accent, fontSize: 15, fontWeight: "600", textAlign: "center" },
    fieldLabel: { fontSize: 13, fontWeight: "700", color: c.text, marginTop: 6, marginBottom: 2 },
    card: {
      backgroundColor: c.bg,
      borderRadius: radius.xl,
      padding: 18,
      borderWidth: isDark ? 1 : 0,
      borderColor: c.border,
      shadowColor: "#0B1220",
      shadowOpacity: isDark ? 0 : 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: isDark ? 0 : 3,
    },
    sectionTitle: { fontSize: 17, fontWeight: "800", color: c.text, letterSpacing: -0.2 },
    statCard: { backgroundColor: c.bgSecondary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 8, alignItems: "center", minWidth: 0, flex: 1 },
    statValue: { fontSize: 17, fontWeight: "800", color: c.text },
    statLabel: { fontSize: 10, fontWeight: "700", color: c.muted, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 },
  });
}

// LIVE bindings — reassigned by the provider, read by every screen.
export let colors: Palette = light;
export let styles = makeStyles(light, false);

function applyScheme(scheme: "light" | "dark") {
  colors = scheme === "dark" ? dark : light;
  styles = makeStyles(colors, scheme === "dark");
}

// --- provider + hook ---

export type ThemeMode = "light" | "dark";
type ThemeCtx = { mode: ThemeMode; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<ThemeCtx>({ mode: "light", setMode: () => {} });
const MODE_KEY = "theme_mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // First-run default follows the device; after that, the user's saved choice.
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [saved, setSaved] = useState<ThemeMode | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY).then((v) => {
      if (v === "light" || v === "dark") setSaved(v);
    });
  }, []);

  const mode: ThemeMode = saved ?? system;
  // Swap the live bindings BEFORE children render this pass.
  applyScheme(mode);

  function setMode(m: ThemeMode) {
    setSaved(m);
    void SecureStore.setItemAsync(MODE_KEY, m);
  }

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

// useThemeMode reads the active mode + setter. Calling it ALSO subscribes the
// component to theme changes (so screens re-render instantly on toggle — React
// Navigation otherwise caches screens and a parent re-render won't reach them).
export function useThemeMode() {
  return useContext(ThemeContext);
}
