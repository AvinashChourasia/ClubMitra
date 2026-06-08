// Trust score client: a runner's credibility (0–100) and tier, from
// GET /users/me/trust-score. The tier decides whether submitted activity proof
// auto-approves or goes to admin review.

import { request } from "./api";

export type TrustTier = "basic" | "trusted" | "verified";

export type TrustSnapshot = {
  trust_score: number;
  trust_tier: TrustTier;
  submission_rate: number; // 0..1
  approval_rate: number; // 0..1
  account_age_days: number;
  total_proofs: number;
};

export function getTrustScore(token: string) {
  return request<TrustSnapshot>("/users/me/trust-score", { token });
}

// Display metadata per tier: label, accent colour key, and a one-line meaning.
export const TIER_META: Record<TrustTier, { label: string; explain: string }> = {
  basic: { label: "Basic", explain: "Your activities go to admin review." },
  trusted: { label: "Trusted", explain: "Screenshots & Strava auto-approve; manual entries are reviewed." },
  verified: { label: "Verified", explain: "All your activities auto-approve." },
};
