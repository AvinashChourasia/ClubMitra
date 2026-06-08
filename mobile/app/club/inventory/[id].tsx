// Chapter inventory manager (admin-only). List club gear, add items, and move
// stock (issue / return / restock). Reached from the club detail screen.

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../lib/auth";
import { ApiError } from "../../../lib/api";
import { listItems, createItem, deleteItem, move, type InventoryItem, type MoveType } from "../../../lib/inventory";
import { colors, styles } from "../../../lib/theme";

export default function ClubInventory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);

  // Add-item form
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // Stock-move modal
  const [moveItem, setMoveItem] = useState<InventoryItem | null>(null);
  const [moveType, setMoveType] = useState<MoveType>("issue");
  const [moveQty, setMoveQty] = useState("");
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (token) setItems(await listItems(token, id));
  }, [getAccessToken, id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await load();
        } catch {
          if (active) setItems([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* keep last good */
    }
    setRefreshing(false);
  }

  async function withToken(fn: (t: string) => Promise<unknown>) {
    try {
      const token = await getAccessToken();
      await fn(token!);
      await load();
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  async function onAdd() {
    if (!name.trim()) return Alert.alert("Name required", "Give the item a name.");
    const q = Number(qty || "0");
    if (!Number.isFinite(q) || q < 0) return Alert.alert("Invalid quantity", "Enter a starting quantity (0 or more).");
    setSaving(true);
    try {
      const token = await getAccessToken();
      await createItem(token!, id, {
        name: name.trim(),
        category: category.trim() || null,
        quantity: q,
        unit_price: price.trim() ? Number(price) : null,
      });
      setName("");
      setCategory("");
      setQty("");
      setPrice("");
      setAdding(false);
      await load();
    } catch (e) {
      Alert.alert("Couldn't add item", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function openMove(item: InventoryItem, type: MoveType) {
    setMoveItem(item);
    setMoveType(type);
    setMoveQty("");
  }

  async function confirmMove() {
    if (!moveItem) return;
    const q = Number(moveQty || "0");
    if (!Number.isFinite(q) || q <= 0) return Alert.alert("Invalid quantity", "Enter a quantity greater than zero.");
    setMoving(true);
    try {
      const token = await getAccessToken();
      await move(token!, id, moveItem.id, moveType, q);
      setMoveItem(null);
      await load();
    } catch (e) {
      Alert.alert("Couldn't update stock", e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setMoving(false);
    }
  }

  function confirmDelete(item: InventoryItem) {
    Alert.alert(item.name, "Remove this item? (soft delete — history is kept)", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => withToken((t) => deleteItem(t, id, item.id)) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Inventory</Text>

          {!adding ? (
            <Pressable onPress={() => setAdding(true)} style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>+ Add item</Text>
            </Pressable>
          ) : (
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.sectionTitle}>New item</Text>
              <TextInput style={styles.input} placeholder="Name (e.g. Club t-shirt)" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
              <TextInput style={styles.input} placeholder="Category (apparel, medals…)" placeholderTextColor={colors.muted} value={category} onChangeText={setCategory} />
              <TextInput style={styles.input} placeholder="Starting quantity" placeholderTextColor={colors.muted} keyboardType="number-pad" value={qty} onChangeText={setQty} />
              <TextInput style={styles.input} placeholder="Unit price ₹ (optional)" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setAdding(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontWeight: "700" }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={onAdd} disabled={saving} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {items === null ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : items.length === 0 ? (
            <View style={[styles.card, { alignItems: "center", paddingVertical: 28 }]}>
              <Ionicons name="cube-outline" size={30} color={colors.subtle} />
              <Text style={{ color: colors.muted, marginTop: 8 }}>No items yet.</Text>
            </View>
          ) : (
            items.map((it) => {
              const low = it.available_qty === 0;
              return (
                <View key={it.id} style={[styles.card, { gap: 10 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{it.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                        {it.category ? `${it.category} · ` : ""}
                        {it.unit_price != null ? `₹${it.unit_price}` : "no price"}
                      </Text>
                    </View>
                    <Pressable onPress={() => confirmDelete(it)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <Text style={{ color: low ? colors.warning : colors.success, fontWeight: "800" }}>
                      {it.available_qty} <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 12 }}>available</Text>
                    </Text>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>
                      {it.total_quantity} <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 12 }}>total</Text>
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["issue", "return", "restock"] as MoveType[]).map((t) => (
                      <Pressable
                        key={t}
                        onPress={() => openMove(it, t)}
                        style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 9, alignItems: "center" }}
                      >
                        <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 12, textTransform: "capitalize" }}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Stock-move modal */}
      <Modal visible={moveItem !== null} transparent animationType="fade" onRequestClose={() => setMoveItem(null)}>
        <Pressable onPress={() => setMoveItem(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 28 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 20, gap: 12 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17, textTransform: "capitalize" }}>
              {moveType} · {moveItem?.name}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Quantity"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              value={moveQty}
              onChangeText={setMoveQty}
              autoFocus
            />
            <Pressable onPress={confirmMove} disabled={moving} style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              {moving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", textTransform: "capitalize" }}>{moveType}</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
