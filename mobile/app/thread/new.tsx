// Start a new direct chat: search people by name/email, tap to open a 1:1 chat.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { searchUsers, type UserHit } from "../../lib/messaging";
import { Avatar } from "../../components/Avatar";
import { colors, styles } from "../../lib/theme";

export default function NewChat() {
  const { getAccessToken } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserHit[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search: query 300ms after typing stops (min 2 chars).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        if (token) setResults(await searchUsers(token, term));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [q, getAccessToken]);

  const openChat = useCallback((u: UserHit) => router.replace(`/thread/dm/${u.id}`), [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>New chat</Text>
      </View>

      {/* Search box */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            style={[styles.input, { flex: 1, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 }]}
            placeholder="Search people by name or email"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            autoFocus
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : q.trim().length < 2 ? (
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40, paddingHorizontal: 32 }}>
            Type at least 2 characters to search.
          </Text>
        ) : results.length === 0 ? (
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>No people found.</Text>
        ) : (
          results.map((u, i) => (
            <Pressable
              key={u.id}
              onPress={() => openChat(u)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i === results.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
            >
              <Avatar name={u.name} uri={u.profile_photo} size={44} bg={colors.accent} />
              <Text style={{ color: colors.text, fontWeight: "600", fontSize: 16 }}>{u.name}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
