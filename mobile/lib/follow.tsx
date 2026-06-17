// FollowContext: one source of truth for "who the signed-in runner follows".
//
// Why a context? Follow buttons live all over the app (search results, club
// member lists, leaderboards, chat, profiles). Rather than each list endpoint
// carrying per-row follow state, we load the viewer's following-set ONCE here
// and let any <FollowButton> read/toggle it. Toggles are optimistic (the UI
// flips instantly, reverting only if the request fails) and update the set so
// every button for that runner stays in sync.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "./auth";
import { listFollowing, followRunner, unfollowRunner } from "./social";

type FollowCtx = {
  isFollowing: (id: string) => boolean;
  toggle: (id: string) => Promise<void>;
  // setKnown lets a screen that already has authoritative state (e.g. a profile
  // load) seed the set, so buttons elsewhere reflect it without a refetch.
  setKnown: (id: string, following: boolean) => void;
  refresh: () => void;
};

const Ctx = createContext<FollowCtx>({
  isFollowing: () => false,
  toggle: async () => {},
  setKnown: () => {},
  refresh: () => {},
});

export function FollowProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!user) {
      setIds(new Set());
      return;
    }
    const token = await getAccessToken();
    if (!token) return;
    try {
      const list = await listFollowing(token, user.id);
      setIds(new Set(list.map((c) => c.id)));
    } catch {
      /* keep last good set */
    }
  }, [user, getAccessToken]);

  // Load the following-set when the signed-in user changes (login/logout).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isFollowing = useCallback((id: string) => ids.has(id), [ids]);

  const setKnown = useCallback((id: string, following: boolean) => {
    setIds((prev) => {
      if (prev.has(id) === following) return prev; // no change
      const next = new Set(prev);
      if (following) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback(
    async (id: string) => {
      const token = await getAccessToken();
      if (!token) return;
      const wasFollowing = ids.has(id);
      setKnown(id, !wasFollowing); // optimistic
      try {
        if (wasFollowing) await unfollowRunner(token, id);
        else await followRunner(token, id);
      } catch {
        setKnown(id, wasFollowing); // revert on failure
      }
    },
    [ids, getAccessToken, setKnown]
  );

  return <Ctx.Provider value={{ isFollowing, toggle, setKnown, refresh }}>{children}</Ctx.Provider>;
}

export function useFollow() {
  return useContext(Ctx);
}
