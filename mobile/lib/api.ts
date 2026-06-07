// The API client: one place that knows how to talk to our Go backend.
//
// Every network call goes through `request()`, so concerns like the base URL,
// JSON headers, attaching the access token, and turning error responses into
// thrown JS errors live here once — not scattered across screens. This mirrors
// the backend's `httpx` package: shared transport logic in a single module.

import Constants from "expo-constants";

// Base URL resolution:
//   • Standalone / EAS builds (__DEV__ === false) → the public API from app
//     config (app.json → expo.extra.apiUrl). This is what a downloaded APK uses.
//   • Dev (Expo Go) → derive the Mac's LAN IP from the Metro host so a phone on
//     the same Wi-Fi reaches the local backend on :8090.
// An EXPO_PUBLIC_API_URL env var overrides everything (handy for staging).
function resolveBaseUrl(): string {
  const withV1 = (origin: string) => `${origin.replace(/\/+$/, "")}/api/v1`;

  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return withV1(envUrl);

  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;

  // Production build: always use the configured public URL.
  if (!__DEV__ && configured) return withV1(configured);

  // Dev: hostUri looks like "192.168.1.20:8081" (the Metro bundler host).
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return `http://${hostUri.split(":")[0]}:8090/api/v1`;

  // Last resort (e.g. a build with no config): configured URL, else localhost.
  return configured ? withV1(configured) : "http://localhost:8090/api/v1";
}

export const BASE_URL = resolveBaseUrl();

// ApiError carries the HTTP status plus the server's message so callers can
// react to specific cases (e.g. 401) and show the backend's error text.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
};

// request is the single entry point for all API calls.
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token } = opts;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects on network failure (server down, wrong IP, no Wi-Fi).
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }

  // 204 No Content (e.g. logout) has no body to parse.
  if (res.status === 204) return undefined as T;

  // Our backend always returns JSON; parse defensively in case it doesn't.
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
