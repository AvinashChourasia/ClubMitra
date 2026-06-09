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

// uploadToCloudinary signs a request for the given kind, then uploads the local
// file DIRECTLY to Cloudinary and returns the hosted secure URL. resource is the
// Cloudinary endpoint: "image" for photos, "auto" for arbitrary files (pdf/doc).
// The signature only covers folder + timestamp, so the same signature works for
// either endpoint.
async function uploadToCloudinary(
  token: string,
  kind: ImageKind,
  file: { uri: string; type: string; name: string },
  resource: "image" | "auto"
): Promise<string> {
  const sig = await request<SignatureResp>("/uploads/signature", { method: "POST", token, body: { kind } });

  const form = new FormData();
  // React Native's FormData accepts this {uri,type,name} shape for files.
  form.append("file", file as unknown as Blob);
  form.append("api_key", sig.api_key);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/${resource}/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  const data = (await res.json()) as { secure_url?: string };
  if (!data.secure_url) throw new Error("Upload succeeded but no URL returned");
  return data.secure_url;
}

// uploadImage uploads a photo (JPEG) to the given folder.
export function uploadImage(token: string, localUri: string, kind: ImageKind): Promise<string> {
  return uploadToCloudinary(token, kind, { uri: localUri, type: "image/jpeg", name: `${kind}.jpg` }, "image");
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

// uploadChatFile uploads a chat document attachment (pdf/doc/etc) via Cloudinary
// "auto" so non-image files are accepted and get a downloadable URL.
export function uploadChatFile(token: string, localUri: string, name: string, mimeType: string): Promise<string> {
  return uploadToCloudinary(token, "chat", { uri: localUri, type: mimeType || "application/octet-stream", name }, "auto");
}
