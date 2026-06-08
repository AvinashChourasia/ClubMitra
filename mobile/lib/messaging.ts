// Messaging client: chapter group chat + per-run event chat, plus admin
// announcements. Mirrors the backend /messaging routes. Delivery is
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

export async function chapterMessages(token: string, chapterId: string) {
  return (await request<Message[] | null>(`/messaging/chapter/${chapterId}`, { token })) ?? [];
}

export function postChapter(token: string, chapterId: string, body: string) {
  return request<Message>(`/messaging/chapter/${chapterId}`, { method: "POST", body: { body }, token });
}

export function announce(token: string, chapterId: string, body: string) {
  return request<Message>(`/messaging/chapter/${chapterId}/announce`, { method: "POST", body: { body }, token });
}

export async function runMessages(token: string, runId: string) {
  return (await request<Message[] | null>(`/messaging/run/${runId}`, { token })) ?? [];
}

export function postRun(token: string, runId: string, body: string) {
  return request<Message>(`/messaging/run/${runId}`, { method: "POST", body: { body }, token });
}
