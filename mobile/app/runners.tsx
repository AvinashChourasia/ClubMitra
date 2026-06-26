// Find runners — the discovery surface for following. Search any runner by name;
// with the box empty, we suggest clubmates you don't follow yet ("runners you
// may know"). Each row links to the full profile and carries an inline Follow.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Redirect, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../lib/auth";
import { searchRunners, suggestedRunners, type RunnerCard } from "../lib/social";
import { colors, styles, useThemeMode } from "../lib/theme";
import { Avatar } from "../components/Avatar";
import { FollowButton } from "../components/FollowButton";

export default function FindRunners() {
  const { user, getAccessToken } = useAuth();
  const router = useRouter();
  useThemeMode();

  const [q, setQ] = useState("");
  const [results, setResults] = useState<RunnerCard[]>([]);
  const [suggestions, setSuggestions] = useState<RunnerCard[]>([]);
  const [loading, setLoading] = useState(false);

  // Suggestions load once on mount.
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (token) setSuggestions(await suggestedRunners(token).catch(() => []));
    })();
  }, [getAccessToken]);

  // Debounced search: re-query 300ms after the last keystroke.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        setResults(await searchRunners(token, query));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [q, getAccessToken]);

  const searching = q.trim().length >= 2;
  const data = searching ? results : suggestions;

  const renderRow = useCallback(
    ({ item }: { item: RunnerCard }) => (
      <Pressable
        onPress={() => router.push(`/u/${item.id}` as Href)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}
      >
        <Avatar name={item.name} uri={item.profile_photo} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{item.name}</Text>
          {item.city ? <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>{item.city}</Text> : null}
        </View>
        <FollowButton userId={item.id} size="sm" />
      </Pressable>
    ),
    [router]
  );

  if (!user) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: -4 }}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>Find runners</Text>
      </View>

      {/* Search box */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.fieldBg, borderRadius: 14, paddingHorizontal: 14, marginHorizontal: 16, marginVertical: 10 }}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          placeholder="Search runners by name"
          placeholderTextColor={colors.subtle}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text }}
        />
        {q !== "" && (
          <Pressable onPress={() => setQ("")} accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.subtle} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={data}
        keyExtractor={(c) => c.id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          !searching && suggestions.length > 0 ? (
            <Text style={[styles.sectionTitle, { marginTop: 4, marginBottom: 4 }]}>Runners you may know</Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 28, fontSize: 14 }}>
              {searching ? "No runners found." : "Join a club to see runners you may know — or search by name above."}
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}
