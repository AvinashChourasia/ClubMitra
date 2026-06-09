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

// payMembership: mock-pay the fee for the caller's own membership (first payment
// or renewal). Returns the new fee_paid_until.
export function payMembership(token: string, chapterId: string) {
  return request<{ status: string; fee_paid_until: string }>(`/chapters/${chapterId}/pay`, { method: "POST", token });
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

// Is this role one that can manage a chapter (see invite code, add members)?
export function isChapterAdmin(role?: string | null): boolean {
  return role === "org_admin" || role === "chapter_admin" || role === "co_admin";
}
