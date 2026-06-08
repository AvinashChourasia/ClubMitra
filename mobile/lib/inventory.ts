// Inventory client (chapter managers): club gear + stock movements. Mirrors the
// backend /inventory/{chapterID}/items* routes.

import { request } from "./api";

export type InventoryItem = {
  id: string;
  chapter_id: string;
  name: string;
  category?: string | null;
  total_quantity: number;
  available_qty: number;
  unit_price?: number | null;
  currency: string;
  image_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type MoveType = "issue" | "return" | "restock";

export async function listItems(token: string, chapterId: string) {
  return (await request<InventoryItem[] | null>(`/inventory/${chapterId}/items`, { token })) ?? [];
}

export function createItem(
  token: string,
  chapterId: string,
  body: { name: string; category?: string | null; quantity: number; unit_price?: number | null }
) {
  return request<InventoryItem>(`/inventory/${chapterId}/items`, { method: "POST", body, token });
}

export function deleteItem(token: string, chapterId: string, itemId: string) {
  return request<void>(`/inventory/${chapterId}/items/${itemId}`, { method: "DELETE", token });
}

// move applies a stock movement (issue / return / restock) and returns the item
// with its updated counts.
export function move(token: string, chapterId: string, itemId: string, type: MoveType, quantity: number, notes?: string) {
  return request<InventoryItem>(`/inventory/${chapterId}/items/${itemId}/${type}`, {
    method: "POST",
    body: { quantity, notes },
    token,
  });
}
