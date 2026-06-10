// Tiny shared store for the total unread-message count, so the tab bar badge
// stays in sync with whatever screen last learned the truth (the chat list on
// load/refresh, the tab layout's background refresh). No context provider — a
// module-level value + subscribers is all this needs.

import { useEffect, useState } from "react";

import { inbox } from "./messaging";

let total = 0;
const subs = new Set<(n: number) => void>();

export function setUnreadTotal(n: number): void {
  total = n;
  subs.forEach((f) => f(n));
}

// sumUnread folds an inbox response into the badge number.
export function sumUnread(items: { unread: number }[]): number {
  return items.reduce((s, it) => s + it.unread, 0);
}

// refreshUnread fetches the inbox just to update the badge (cheap, best-effort).
export async function refreshUnread(getToken: () => Promise<string | null>): Promise<void> {
  try {
    const token = await getToken();
    if (!token) return;
    setUnreadTotal(sumUnread(await inbox(token)));
  } catch {
    /* badge keeps its last value */
  }
}

// useUnreadTotal subscribes a component (the tab bar) to the count.
export function useUnreadTotal(): number {
  const [n, setN] = useState(total);
  useEffect(() => {
    const f = (v: number) => setN(v);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return n;
}
