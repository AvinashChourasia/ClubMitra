// Auth state for the whole app, exposed via React Context.
//
// Why Context (and not Redux/Zustand)? Auth state is small — a user, a token,
// and a few actions. Context is the built-in, zero-dependency tool that fits.
// We'll reach for a heavier state library only when state genuinely outgrows
// this (e.g. cached activity lists), not before.
//
// Tokens are stored in expo-secure-store (the iOS Keychain), NOT plain storage,
// because they are credentials. The access token also lives in memory for fast
// access on each request.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

import { ApiError, request } from "./api";
import { flush } from "./runQueue";
import { registerForPush, unregisterPush } from "./push";

// Keys under which we persist the tokens in the secure store.
const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
// The signed-in user's profile, cached so a relaunch shows their identity
// instantly even while the (free-tier, sleepy) backend is still waking up.
const USER_KEY = "cached_user";

// --- access-token lifecycle -------------------------------------------------
// Access tokens live 15 minutes; the refresh token (30 days, rotating) renews
// them. freshAccessToken() is what every API call goes through: it returns the
// stored token while it's still valid and transparently rotates it otherwise.

// decode base64url (JWT segments) without atob — tiny and dependency-free.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  let out = "";
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buf >> bits) & 0xff);
    }
  }
  return out;
}

// jwtExpMs reads a JWT's expiry (ms epoch); 0 when unreadable (treat as expired).
function jwtExpMs(token: string): number {
  try {
    const payload = JSON.parse(b64decode(token.split(".")[1] ?? ""));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

// Single-flight: refresh tokens ROTATE server-side, so two parallel refreshes
// would burn the same token twice — the second one fails and can trip theft
// detection, killing the session. All concurrent callers share one rotation.
let refreshInFlight: Promise<string | null> | null = null;

// In-memory copy of the access token so the hot path costs zero SecureStore
// reads (those are a native round trip per call). SecureStore stays the
// durable source; this is just the L1.
let memAccess: string | null = null;

// freshAccessToken returns a valid access token, rotating via /auth/refresh
// when the stored one is expired (or about to). Failure semantics matter:
//   • refresh rejected with 401/403 → the session is truly dead → clear tokens
//   • network error / sleeping backend → KEEP the session; return the stale
//     token and let the one request fail — never sign the user out for that.
async function freshAccessToken(): Promise<string | null> {
  if (memAccess && jwtExpMs(memAccess) - Date.now() > 60_000) return memAccess;

  const access = memAccess ?? (await SecureStore.getItemAsync(ACCESS_KEY));
  if (access && jwtExpMs(access) - Date.now() > 60_000) {
    memAccess = access;
    return access;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refresh) return access;
        const pair = await request<{ access_token: string; refresh_token: string }>("/auth/refresh", {
          method: "POST",
          body: { refresh_token: refresh },
        });
        await SecureStore.setItemAsync(ACCESS_KEY, pair.access_token);
        await SecureStore.setItemAsync(REFRESH_KEY, pair.refresh_token);
        memAccess = pair.access_token;
        return pair.access_token;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          await clearTokens();
          return null; // revoked/expired refresh — a real sign-out
        }
        return access; // transient failure: fail soft, session survives
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  age?: number | null;
  tshirt_size?: string | null;
  city?: string | null;
  running_level?: string | null;
  profile_photo?: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
};

// What the register screen collects. Everything except t-shirt size is required
// (the backend enforces this too).
export type RegisterParams = {
  name: string;
  email: string;
  password: string;
  phone: string;
  city: string;
  age: number;
  running_level: string;
  tshirt_size?: string;
};

// The editable profile (email + password are managed elsewhere).
export type ProfileInput = {
  name: string;
  phone: string;
  age: number;
  city: string;
  running_level: string;
  tshirt_size?: string;
  profile_photo?: string; // Cloudinary URL; omit to leave unchanged
};

// The server's response shape for register/login (mirrors the Go authResponse).
type AuthResponse = {
  access_token: string;
  refresh_token: string;
  user: User;
};

type AuthContextValue = {
  user: User | null;
  // initializing = we're still checking secure storage on app launch. The UI
  // shows a splash/loading state until this is false, so we don't flash the
  // login screen at an already-logged-in user.
  initializing: boolean;
  // ClubMitra owns identity now: accounts are created in-app via register,
  // and login verifies the email/password against our backend.
  register: (params: RegisterParams) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  // Edit the signed-in user's own profile (PUT /users/me) and refresh state.
  updateProfile: (input: ProfileInput) => Promise<void>;
  logout: () => Promise<void>;
  // Returns the current access token for making authenticated API calls.
  // Lives here because the tokens are this module's responsibility; screens
  // ask the auth layer for a token rather than touching SecureStore directly.
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  // On launch: restore the session WITHOUT a network round trip. If tokens
  // exist, show the cached identity instantly and verify in the background —
  // a sleeping free-tier backend must never look like a sign-out.
  useEffect(() => {
    (async () => {
      try {
        const access = await SecureStore.getItemAsync(ACCESS_KEY);
        const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!access && !refresh) return; // genuinely logged out
        const cached = await SecureStore.getItemAsync(USER_KEY);
        if (cached) {
          try {
            setUser(JSON.parse(cached) as User);
          } catch {
            /* unreadable cache — verify will repopulate it */
          }
        }
        void verifySession();
      } finally {
        setInitializing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // verifySession confirms the stored session against the server, retrying
  // patiently while a cold backend wakes (Render free tier sleeps). It only
  // signs the user out on a DEFINITIVE 401 — never on a network failure.
  async function verifySession(attempt = 0) {
    try {
      const token = await freshAccessToken();
      if (!token) {
        // refresh was rejected — session revoked/expired for real
        setUser(null);
        return;
      }
      const me = await request<User>("/users/me", { token });
      setUser(me);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me));
      // Session confirmed — drain offline-recorded runs + (re)register push.
      void flush(() => freshAccessToken());
      void registerForPush(token);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await clearTokens();
        setUser(null);
        return;
      }
      if (attempt < 8) setTimeout(() => void verifySession(attempt + 1), 8000);
    }
  }

  async function persistAuth(res: AuthResponse) {
    await SecureStore.setItemAsync(ACCESS_KEY, res.access_token);
    await SecureStore.setItemAsync(REFRESH_KEY, res.refresh_token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user));
    memAccess = res.access_token;
    setUser(res.user);
    // Register this device for push under the freshly logged-in user.
    void registerForPush(res.access_token);
  }

  async function register(params: RegisterParams) {
    const res = await request<AuthResponse>("/auth/register", {
      method: "POST",
      body: params,
    });
    await persistAuth(res);
  }

  async function login(email: string, password: string) {
    const res = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await persistAuth(res);
  }

  async function updateProfile(input: ProfileInput) {
    const token = await freshAccessToken();
    const updated = await request<User>("/users/me", { method: "PUT", body: input, token });
    setUser(updated);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
  }

  async function logout() {
    // Best-effort server-side revoke; the local sign-out must happen regardless.
    try {
      // Unregister this device's push token first (while we still have a token).
      await unregisterPush(await SecureStore.getItemAsync(ACCESS_KEY));
      const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
      if (refresh) {
        await request("/auth/logout", { method: "POST", body: { refresh_token: refresh } });
      }
    } catch {
      // Ignore: even if the network call fails, we still clear local state.
    }
    await clearTokens();
    setUser(null);
  }

  // getAccessToken hands screens a VALID token — silently rotating an expired
  // one first. Returns null (and drops the user) only when the refresh token
  // itself was rejected, i.e. the session is truly over.
  async function getAccessToken() {
    const token = await freshAccessToken();
    if (!token && user) setUser(null);
    return token;
  }

  return (
    <AuthContext.Provider
      value={{ user, initializing, register, login, updateProfile, logout, getAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function clearTokens() {
  memAccess = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

// useAuth is the hook screens call to read auth state and trigger actions.
// It throws if used outside the provider — a clear error beats a silent null.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
