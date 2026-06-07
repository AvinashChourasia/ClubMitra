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

import { request } from "./api";
import { flush } from "./runQueue";
import { registerForPush, unregisterPush } from "./push";

// Keys under which we persist the tokens in the secure store.
const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

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

  // On launch, try to restore a session: if we have a saved access token and it
  // still works, fetch the user. If anything fails, we simply stay logged out.
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(ACCESS_KEY);
        if (token) {
          const me = await request<User>("/users/me", { token });
          setUser(me);
          // Logged back in — drain any runs recorded while offline last time,
          // and (re)register this device for push.
          void flush(() => SecureStore.getItemAsync(ACCESS_KEY));
          void registerForPush(token);
        }
      } catch {
        // Token missing/expired/invalid — clear it and start logged out.
        // (Refresh-token rotation will be wired up in a later step.)
        await clearTokens();
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  async function persistAuth(res: AuthResponse) {
    await SecureStore.setItemAsync(ACCESS_KEY, res.access_token);
    await SecureStore.setItemAsync(REFRESH_KEY, res.refresh_token);
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
    const token = await SecureStore.getItemAsync(ACCESS_KEY);
    const updated = await request<User>("/users/me", { method: "PUT", body: input, token });
    setUser(updated);
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

  function getAccessToken() {
    return SecureStore.getItemAsync(ACCESS_KEY);
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
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

// useAuth is the hook screens call to read auth state and trigger actions.
// It throws if used outside the provider — a clear error beats a silent null.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
