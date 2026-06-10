// Realtime chat client: one app-wide websocket to the backend hub. Events fan
// out to subscribers (thread screens, the chat list); outbound frames are
// typing signals (throttled per conversation). Reconnects with backoff and
// re-auths with a fresh token each attempt. Polling stays as the fallback, so
// a dropped socket degrades gracefully instead of breaking chat.

import { BASE_URL } from "./api";
import type { Message } from "./messaging";

export type RTEvent = {
  type: "message" | "update" | "typing";
  scope: "chapter" | "dm";
  id: string; // chapter id, or (for DMs) the peer's user id from YOUR side
  user_id?: string;
  name?: string;
  payload?: Message;
};

type Listener = (e: RTEvent) => void;

let ws: WebSocket | null = null;
let alive = false; // socket open and authenticated
let wanted = false; // should we keep a connection up?
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tokenGetter: (() => Promise<string | null>) | null = null;
const listeners = new Set<Listener>();
const lastTyping = new Map<string, number>(); // conversation key → last sent ms

function wsUrl(token: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
}

async function open() {
  if (!wanted || !tokenGetter || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  let token: string | null = null;
  try {
    token = await tokenGetter();
  } catch {
    /* retry below */
  }
  if (!token) {
    scheduleReconnect();
    return;
  }
  try {
    ws = new WebSocket(wsUrl(token));
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    alive = true;
    attempts = 0;
  };
  ws.onmessage = (ev) => {
    try {
      const e = JSON.parse(String(ev.data)) as RTEvent;
      listeners.forEach((f) => f(e));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onerror = () => {
    /* onclose follows */
  };
  ws.onclose = () => {
    alive = false;
    ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!wanted || reconnectTimer) return;
  const delay = Math.min(15000, 1000 * 2 ** Math.min(attempts, 4)); // 1s → 16s cap
  attempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void open();
  }, delay);
}

// ensureConnected starts (or keeps) the app-wide socket. Idempotent — call it
// from any chat surface on focus.
export function ensureConnected(getToken: () => Promise<string | null>): void {
  tokenGetter = getToken;
  wanted = true;
  void open();
}

// subscribe registers a listener for all events; returns the unsubscribe.
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// isLive reports whether the socket is currently open (used to slow the poll).
export function isLive(): boolean {
  return alive;
}

// sendTyping signals "I'm typing" for a conversation, throttled to one frame
// per 2.5s per conversation so keystrokes don't flood the socket.
export function sendTyping(scope: "chapter" | "dm", id: string): void {
  if (!alive || !ws) return;
  const key = `${scope}:${id}`;
  const now = Date.now();
  if (now - (lastTyping.get(key) ?? 0) < 2500) return;
  lastTyping.set(key, now);
  try {
    ws.send(JSON.stringify({ type: "typing", scope, id }));
  } catch {
    /* socket raced shut — reconnect loop handles it */
  }
}
