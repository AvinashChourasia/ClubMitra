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
let opening = false; // single-flight guard: open() is mid-token-fetch
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tokenGetter: (() => Promise<string | null>) | null = null;
const listeners = new Set<Listener>();
const lastTyping = new Map<string, number>(); // conversation key → last sent ms

function wsUrl(token: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
}

async function open() {
  // CLOSING counts as busy too — its onclose will schedule the reconnect.
  if (!wanted || !tokenGetter || opening || (ws && ws.readyState !== WebSocket.CLOSED)) return;
  opening = true;
  const myGetter = tokenGetter;
  let token: string | null = null;
  try {
    token = await myGetter();
  } catch {
    /* retry below */
  }
  // Re-check after the await: disconnect()/re-login may have swapped state,
  // and a token minted for the previous account must never be used.
  if (!wanted || tokenGetter !== myGetter || (ws && ws.readyState !== WebSocket.CLOSED)) {
    opening = false;
    return;
  }
  if (!token) {
    opening = false;
    scheduleReconnect();
    return;
  }
  let sock: WebSocket;
  try {
    sock = new WebSocket(wsUrl(token));
  } catch {
    opening = false;
    scheduleReconnect();
    return;
  }
  ws = sock;
  opening = false;
  // Every handler checks it still owns the module socket, so a replaced or
  // orphaned socket can't clobber state or double-deliver events.
  sock.onopen = () => {
    if (sock !== ws) return;
    alive = true;
    attempts = 0;
  };
  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    try {
      const e = JSON.parse(String(ev.data)) as RTEvent;
      listeners.forEach((f) => f(e));
    } catch {
      /* ignore malformed frames */
    }
  };
  sock.onerror = () => {
    /* onclose follows */
  };
  sock.onclose = () => {
    if (sock !== ws) return;
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

// disconnect tears the socket down for good (logout / account switch): stop
// wanting a connection, cancel any pending reconnect, and close the socket so
// the next login can't ride the previous account's authenticated session.
export function disconnect(): void {
  wanted = false;
  tokenGetter = null;
  attempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const sock = ws;
  ws = null; // null first so sock's onclose is a no-op (identity check)
  alive = false;
  try {
    sock?.close();
  } catch {
    /* already closed */
  }
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
