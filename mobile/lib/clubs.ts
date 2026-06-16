// API client for the club core: organisations, chapters, membership. Mirrors the
// backend's /organisations and /chapters routes. Every call takes the caller's
// access token (the screens get it from the auth context).

import { request } from "./api";

export type Chapter = {
  id: string;
  org_id: string;
  name: string;
  city: string;
  description: string;
  logo?: string | null;
  banner?: string | null;
  is_public: boolean;
  invite_code: string;
  join_policy: "open" | "invite";
  requires_approval: boolean;
  membership_fee_enabled: boolean;
  membership_fee_amount?: number | null;
  membership_period?: "monthly" | "annual" | null;
  renewal_window_days: number;
  created_at: string;
  updated_at: string;
};

// Editable club config (media + fee/approval), set on create/update.
export type ClubSettings = {
  logo?: string | null;
  banner?: string | null;
  join_policy?: "open" | "invite";
  requires_approval?: boolean;
  membership_fee_enabled?: boolean;
  membership_fee_amount?: number;
  membership_period?: "monthly" | "annual";
  renewal_window_days?: number;
};

// A chapter the user belongs to or administers, with their status/role and
// headline counts for the club card.
export type MyChapter = Chapter & {
  status?: string | null;
  role?: string | null;
  member_count: number;
  active_challenge_count: number;
};

export type Member = {
  user_id: string;
  name: string;
  email: string;
  status: string;
  joined_at: string;
};

// MemberDetail is the admin-facing profile of one member (mirrors the backend).
export type MemberDetail = {
  user_id: string;
  name: string;
  email: string;
  phone?: string | null;
  age?: number | null;
  tshirt_size?: string | null;
  city?: string | null;
  status: string;
  joined_at: string;
  fee_paid_until?: string | null;
};

// getMemberDetail: admin-only profile of a member (403 for non-admins).
export function getMemberDetail(token: string, chapterId: string, userId: string) {
  return request<MemberDetail>(`/chapters/${chapterId}/members/${userId}`, { token });
}

export type Organisation = { id: string; name: string; description: string };

// myChapters: the clubs the signed-in user belongs to or admins.
// (List endpoints coerce null -> [] so an empty list can't crash a .map/.length.)
export async function myChapters(token: string) {
  return (await request<MyChapter[] | null>("/chapters/mine", { token })) ?? [];
}

export function getChapter(token: string, id: string) {
  return request<Chapter>(`/chapters/${id}`, { token });
}

export async function listMembers(token: string, chapterId: string) {
  return (await request<Member[] | null>(`/chapters/${chapterId}/members`, { token })) ?? [];
}

// joinByInvite: start a membership; the returned status tells the next step
// (pending = await approval, pending_payment = pay, active = done).
export type JoinResult = { chapter: Chapter; status: string };
export function joinByInvite(token: string, inviteCode: string) {
  return request<JoinResult>("/chapters/join", { method: "POST", body: { invite_code: inviteCode }, token });
}

// approveMember: admin moves a pending request forward. Returns the new status.
export function approveMember(token: string, chapterId: string, userId: string) {
  return request<{ status: string }>(`/chapters/${chapterId}/members/${userId}/approve`, { method: "POST", token });
}

// Membership fees are paid through the payments engine (lib/payments → pay()),
// not a mock endpoint — see app/club/[id].tsx payOrRenew.

// --- club → platform subscription plan (admin billing) ---
export type PlanTier = {
  name: string;
  price_rupees: number; // per month, INR
  member_limit: number;
  purchasable: boolean;
};

export type PlanStatus = {
  tier: string;
  subscription_until?: string | null;
  member_count: number;
  member_limit: number;
  tiers: PlanTier[];
};

// getPlan returns a club's subscription status + the tier catalog (admin-only).
export function getPlan(token: string, chapterId: string) {
  return request<PlanStatus>(`/chapters/${chapterId}/plan`, { token });
}

export function createOrg(token: string, name: string, description: string) {
  return request<Organisation>("/organisations", { method: "POST", body: { name, description }, token });
}

export function createChapter(
  token: string,
  orgId: string,
  name: string,
  city: string,
  description: string,
  settings?: ClubSettings
) {
  return request<Chapter>(`/organisations/${orgId}/chapters`, {
    method: "POST",
    body: { name, city, description, ...settings },
    token,
  });
}

export function updateChapter(
  token: string,
  chapterId: string,
  body: { name: string; city: string; description: string; is_public: boolean } & ClubSettings
) {
  return request<Chapter>(`/chapters/${chapterId}`, { method: "PUT", body, token });
}

// Soft delete — the row is kept (deleted_at set); it just stops showing in app.
export function deleteChapter(token: string, chapterId: string) {
  return request<void>(`/chapters/${chapterId}`, { method: "DELETE", token });
}

export function setMemberStatus(token: string, chapterId: string, userId: string, status: string) {
  return request<void>(`/chapters/${chapterId}/members/${userId}`, { method: "PUT", body: { status }, token });
}

// Soft delete of a membership.
export function removeMember(token: string, chapterId: string, userId: string) {
  return request<void>(`/chapters/${chapterId}/members/${userId}`, { method: "DELETE", token });
}

// MEMBER_STATUSES are the states an admin can set a member to.
export const MEMBER_STATUSES = ["active", "lapsed", "suspended", "on_leave", "injured", "alumni"];

// setOwnStatus is the member self-service: set your own membership on_leave or
// back to active (no admin needed).
export function setOwnStatus(token: string, chapterId: string, status: "active" | "on_leave") {
  return request<void>(`/chapters/${chapterId}/members/me/status`, { method: "PUT", body: { status }, token });
}

// assignRole grants an admin role to a member, scoped to this chapter. Only an
// org admin may call it (the backend enforces this).
export function assignRole(token: string, orgId: string, userId: string, role: string, chapterId: string) {
  return request<void>(`/organisations/${orgId}/roles`, {
    method: "POST",
    body: { user_id: userId, role, chapter_id: chapterId },
    token,
  });
}

// Is this role one that can manage the club (see invite code, add members)?
export function isChapterAdmin(role?: string | null): boolean {
  return role === "org_admin" || role === "chapter_admin" || role === "co_admin";
}

// roleLabel renders a backend role for the flat one-club model: the org creator
// reads as the Owner; the others are admins. Members get no badge ("").
export function roleLabel(role?: string | null): string {
  switch (role) {
    case "org_admin":
      return "Owner";
    case "chapter_admin":
      return "Admin";
    case "co_admin":
      return "Co-admin";
    default:
      return "";
  }
}
