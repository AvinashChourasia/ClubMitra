// Payments client — the one money path for every paid surface (club membership,
// challenge join fee, gear purchase, club subscription). It mirrors the Strava
// integration: the backend prices + records the order, the in-app browser runs
// Razorpay's hosted Checkout, and the deep-link return (clubmitra://payment) is
// verified. The whole feature is dormant unless the backend has Razorpay keys
// (config.configured) — until then order creation returns 503.
//
// Hosted checkout (not the native SDK) is deliberate: it works in Expo Go and
// ships over OTA, and the backend webhook is the authoritative capture, so the
// payment settles even if the app closes before the verify call lands.

import * as WebBrowser from "expo-web-browser";

import { request, BASE_URL } from "./api";

export type PaymentConfig = {
  configured: boolean; // backend has Razorpay keys
  key_id: string;
  currency: string;
};

export function paymentConfig(token: string) {
  return request<PaymentConfig>("/payments/config", { token });
}

export type PaymentPurpose = "membership" | "challenge" | "inventory" | "subscription";

type OrderResponse = {
  payment_id: string;
  order_id: string;
  amount_paise: number;
  currency: string;
  key_id: string;
};

export type PayOutcome = "paid" | "cancelled" | "failed";

type PayArgs = {
  purpose: PaymentPurpose;
  targetId: string;
  quantity?: number;
  meta?: Record<string, string>;
  desc?: string; // shown on the checkout sheet
};

// pay runs the full checkout for one purchase and resolves once it's settled (or
// the user backed out). On "paid", refresh the relevant screen — the entitlement
// (membership/challenge/purchase/plan) is granted server-side on capture.
export async function pay(token: string, args: PayArgs): Promise<PayOutcome> {
  const order = await request<OrderResponse>("/payments/orders", {
    method: "POST",
    token,
    body: { purpose: args.purpose, target_id: args.targetId, quantity: args.quantity, meta: args.meta },
  });

  const desc = encodeURIComponent(args.desc ?? "ClubMitra payment");
  const url = `${BASE_URL}/public/payments/razorpay/checkout?order_id=${encodeURIComponent(order.order_id)}&desc=${desc}`;

  const res = await WebBrowser.openAuthSessionAsync(url, "clubmitra://payment");
  if (res.type !== "success") return "cancelled"; // user dismissed the sheet

  const p = parseReturn(res.url);
  if (p.status !== "success" || !p.payment_id || !p.signature) {
    return p.status === "cancelled" ? "cancelled" : "failed";
  }

  try {
    await request<{ status: string }>("/payments/verify", {
      method: "POST",
      token,
      body: { order_id: order.order_id, payment_id: p.payment_id, signature: p.signature },
    });
    return "paid";
  } catch {
    // Verify hiccup (network/timeout): the webhook still settles it server-side,
    // so treat as not-yet-confirmed and let the caller re-fetch shortly.
    return "failed";
  }
}

// parseReturn pulls the query params out of the clubmitra://payment?... deep link.
function parseReturn(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const qs = url.split("?")[1];
  if (!qs) return out;
  for (const pair of qs.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return out;
}

export type PaymentRecord = {
  id: string;
  purpose: PaymentPurpose;
  target_id: string;
  amount_paise: number;
  currency: string;
  status: "created" | "paid" | "failed" | "refunded";
  created_at: string;
  paid_at?: string | null;
};

export function paymentHistory(token: string) {
  return request<PaymentRecord[]>("/payments/history", { token });
}

// rupees formats integer paise as a ₹ amount (e.g. 74900 → "₹749").
export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
}
