// Messaging client: a WhatsApp-style inbox (club groups + 1:1 DMs), the club +
// run group chats, direct chats, and people search to start a DM. Delivery is
// pull-on-open — screens fetch on entry, on refresh, and after sending.

import { request } from "./api";

export type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  body?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  is_announcement: boolean;
  is_pinned: boolean;
  created_at: string;
};

// One row in the chat list — a club group or a direct chat.
export type InboxItem = {
  kind: "club" | "direct";
  chapter_id?: string | null;
  user_id?: string | null; // the other person, for a direct chat
  title: string;
  photo_url?: string | null;
  last_message?: string | null;
  last_at?: string | null;
};

export type OtherUser = { id: string; name: string; profile_photo?: string | null };
export type DirectThread = { other: OtherUser; messages: Message[] };
export type UserHit = { id: string; name: string; profile_photo?: string | null };

// --- inbox ---
export async function inbox(token: string) {
  return (await request<InboxItem[] | null>("/messaging/conversations", { token })) ?? [];
}

// --- club group chat ---
export async function chapterMessages(token: string, chapterId: string) {
  return (await request<Message[] | null>(`/messaging/chapter/${chapterId}`, { token })) ?? [];
}
export function postChapter(token: string, chapterId: string, body: string) {
  return request<Message>(`/messaging/chapter/${chapterId}`, { method: "POST", body: { body }, token });
}
export function announce(token: string, chapterId: string, body: string) {
  return request<Message>(`/messaging/chapter/${chapterId}/announce`, { method: "POST", body: { body }, token });
}

// --- direct (1:1) chat, keyed by the other user's id ---
export function directThread(token: string, userId: string) {
  return request<DirectThread>(`/messaging/dm/${userId}`, { token });
}
export function postDirect(token: string, userId: string, body: string) {
  return request<Message>(`/messaging/dm/${userId}`, { method: "POST", body: { body }, token });
}

// --- people search (to start a DM) ---
export async function searchUsers(token: string, q: string) {
  return (await request<UserHit[] | null>(`/users/search?q=${encodeURIComponent(q)}`, { token })) ?? [];
}
