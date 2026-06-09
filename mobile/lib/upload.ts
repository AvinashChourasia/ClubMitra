// Image upload via Cloudinary, using a server-signed request: the backend signs
// the params (its secret never leaves the server), and the phone uploads the
// file DIRECTLY to Cloudinary (it doesn't transit our API). Returns the hosted
// secure URL to store on the profile.

import { request } from "./api";

type SignatureResp = {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
};

// ImageKind picks which allowlisted Cloudinary folder the server signs.
type ImageKind = "avatar" | "club" | "chat";

// isRemote tells an already-uploaded (http/https) URL from a freshly-picked
// local file URI, so we never re-upload an unchanged photo.
export function isRemote(uri: string | null | undefined): boolean {
  return !!uri && /^https?:\/\//.test(uri);
}

// uploadImage signs a request for the given kind, then uploads the local file
// DIRECTLY to Cloudinary and returns the hosted secure URL.
export async function uploadImage(token: string, localUri: string, kind: ImageKind): Promise<string> {
  const sig = await request<SignatureResp>("/uploads/signature", { method: "POST", token, body: { kind } });

  const form = new FormData();
  // React Native's FormData accepts this {uri,type,name} shape for files.
  form.append("file", { uri: localUri, type: "image/jpeg", name: `${kind}.jpg` } as unknown as Blob);
  form.append("api_key", sig.api_key);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Image upload failed (${res.status})`);
  }
  const data = (await res.json()) as { secure_url?: string };
  if (!data.secure_url) throw new Error("Upload succeeded but no URL returned");
  return data.secure_url;
}

// uploadAvatar uploads a profile photo. Thin wrapper kept for existing callers.
export function uploadAvatar(token: string, localUri: string): Promise<string> {
  return uploadImage(token, localUri, "avatar");
}

// uploadClubImage uploads a club logo or banner.
export function uploadClubImage(token: string, localUri: string): Promise<string> {
  return uploadImage(token, localUri, "club");
}

// uploadChatImage uploads a chat image attachment.
export function uploadChatImage(token: string, localUri: string): Promise<string> {
  return uploadImage(token, localUri, "chat");
}
