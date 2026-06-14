// Messaging client: a WhatsApp-style inbox (club groups + 1:1 DMs), the club +
// run group chats, direct chats, and people search to start a DM. Delivery is
// pull-on-open — screens fetch on entry, on refresh, and after sending.

import { request } from "./api";

export type Reaction = { emoji: string; count: number; mine: boolean };
export type ReplyRef = { id: string; sender_name: string; preview: string };

export type PollOption = { id: string; text: string; votes: number; mine: boolean };
export type Poll = { question: string; multi: boolean; total_votes: number; options: PollOption[] };

export type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  // "user" = normal message; "badge" = automatic achievement chip;
  // "poll" = a poll the client renders with its options + live tallies.
  kind: "user" | "badge" | "poll";
  body?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  is_announcement: boolean;
  is_pinned: boolean;
  reply_to?: ReplyRef | null;
  reactions?: Reaction[] | null;
  poll?: Poll | null;
  edited_at?: string | null;
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
  last_sender_id?: string | null; // who sent it — "You: " prefix when it's me
  last_at?: string | null;
  unread: number;
  muted: boolean;
  archived: boolean;
};

export type OtherUser = { id: string; name: string; profile_photo?: string | null };
export type DirectThread = { other: OtherUser; messages: Message[]; other_last_read_at?: string | null };
export type UserHit = { id: string; name: string; profile_photo?: string | null };

// OutMsg is the payload to send: text and/or an attachment, optionally quoting
// an earlier message (reply_to_id).
export type OutMsg = { body?: string; media_url?: string; media_type?: string; reply_to_id?: string };

// --- inbox ---
export async function inbox(token: string) {
  return (await request<InboxItem[] | null>("/messaging/conversations", { token })) ?? [];
}

// --- club group chat ---
export async function chapterMessages(token: string, chapterId: string) {
  return (await request<Message[] | null>(`/messaging/chapter/${chapterId}`, { token })) ?? [];
}
export function postChapter(token: string, chapterId: string, msg: OutMsg) {
  return request<Message>(`/messaging/chapter/${chapterId}`, { method: "POST", body: msg, token });
}

// --- polls (admin posts in a club chat; anyone in the club votes) ---
export function createPoll(token: string, chapterId: string, input: { question: string; options: string[]; multi: boolean }) {
  return request<Message>(`/messaging/chapter/${chapterId}/poll`, { method: "POST", body: input, token });
}
export function votePoll(token: string, messageId: string, optionId: string): Promise<void> {
  return request(`/messaging/messages/${messageId}/vote`, { method: "PUT", body: { option_id: optionId }, token });
}
export function announce(token: string, chapterId: string, body: string) {
  return request<Message>(`/messaging/chapter/${chapterId}/announce`, { method: "POST", body: { body }, token });
}

// --- direct (1:1) chat, keyed by the other user's id ---
export function directThread(token: string, userId: string) {
  return request<DirectThread>(`/messaging/dm/${userId}`, { token });
}
export function postDirect(token: string, userId: string, msg: OutMsg) {
  return request<Message>(`/messaging/dm/${userId}`, { method: "POST", body: msg, token });
}

// --- people search (to start a DM) ---
export async function searchUsers(token: string, q: string) {
  return (await request<UserHit[] | null>(`/users/search?q=${encodeURIComponent(q)}`, { token })) ?? [];
}

// deleteMessage soft-deletes a message you sent (delete for everyone).
export function deleteMessage(token: string, messageId: string) {
  return request<void>(`/messaging/messages/${messageId}`, { method: "DELETE", token });
}

// editMessage rewrites the text of a message you sent (shows an "edited" label).
export function editMessage(token: string, messageId: string, body: string) {
  return request<void>(`/messaging/messages/${messageId}`, { method: "PUT", body: { body }, token });
}

// Per-message info (sender-only): who has read it, out of how many.
export type MessageReader = { user_id: string; name: string; profile_photo?: string | null; read_at: string };
export type MessageInfo = { sent_at: string; recipients: number; readers: MessageReader[] };

export function getMessageInfo(token: string, messageId: string) {
  return request<MessageInfo>(`/messaging/messages/${messageId}/info`, { token });
}

// setReaction sets your one reaction on a message; "" clears it.
export function setReaction(token: string, messageId: string, emoji: string) {
  return request<void>(`/messaging/messages/${messageId}/reaction`, { method: "PUT", body: { emoji }, token });
}

// setChatPrefs mutes/archives a conversation for you only.
export function setChatPrefs(
  token: string,
  kind: "club" | "direct",
  id: string,
  prefs: { muted?: boolean; archived?: boolean }
) {
  return request<void>("/messaging/prefs", { method: "PUT", body: { kind, id, ...prefs }, token });
}
