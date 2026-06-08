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

// isRemote tells an already-uploaded (http/https) URL from a freshly-picked
// local file URI, so we never re-upload an unchanged photo.
export function isRemote(uri: string | null | undefined): boolean {
  return !!uri && /^https?:\/\//.test(uri);
}

// uploadAvatar uploads a local image and returns its Cloudinary secure URL.
export async function uploadAvatar(token: string, localUri: string): Promise<string> {
  const sig = await request<SignatureResp>("/uploads/signature", { method: "POST", token, body: {} });

  const form = new FormData();
  // React Native's FormData accepts this {uri,type,name} shape for files.
  form.append("file", { uri: localUri, type: "image/jpeg", name: "avatar.jpg" } as unknown as Blob);
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
