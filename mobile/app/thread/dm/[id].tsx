// Direct (1:1) chat, keyed by the other person's user id. The conversation is
// found-or-created on first send. Header shows their name + profile photo. Read
// receipts use the other person's last-read time from the thread response.

import { useCallback, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import { useAuth } from "../../../lib/auth";
import { directThread, postDirect, deleteMessage as deleteMessageApi, setReaction, editMessage, type OtherUser, type OutMsg } from "../../../lib/messaging";
import { uploadChatImage, uploadChatFile } from "../../../lib/upload";
import { ChatThread } from "../../../components/ChatThread";

export default function DirectChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const [other, setOther] = useState<OtherUser | null>(null);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);

  // load fills the header (other) + read receipt time, and returns the messages.
  // load runs on every poll (~4s); only push state when it actually changed, so
  // we don't re-render the whole thread (and interrupt a swipe) for no reason.
  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return [];
    const thread = await directThread(token, id);
    setOther((prev) =>
      prev && prev.id === thread.other.id && prev.name === thread.other.name && prev.profile_photo === thread.other.profile_photo
        ? prev
        : thread.other
    );
    const lastRead = thread.other_last_read_at ?? null;
    setOtherLastReadAt((prev) => (prev === lastRead ? prev : lastRead));
    return thread.messages;
  }, [getAccessToken, id]);

  const send = useCallback(async (msg: OutMsg) => {
    const token = await getAccessToken();
    if (token) await postDirect(token, id, msg);
  }, [getAccessToken, id]);

  const uploadImage = useCallback(async (uri: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session expired — please log in again.");
    return uploadChatImage(token, uri);
  }, [getAccessToken]);

  const uploadFile = useCallback(async (uri: string, name: string, mime: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session expired — please log in again.");
    return uploadChatFile(token, uri, name, mime);
  }, [getAccessToken]);

  const removeMessage = useCallback(async (mid: string) => {
    const token = await getAccessToken();
    if (token) await deleteMessageApi(token, mid);
  }, [getAccessToken]);

  const react = useCallback(async (mid: string, emoji: string) => {
    const token = await getAccessToken();
    if (token) await setReaction(token, mid, emoji);
  }, [getAccessToken]);

  const edit = useCallback(async (mid: string, body: string) => {
    const token = await getAccessToken();
    if (token) await editMessage(token, mid, body);
  }, [getAccessToken]);

  return (
    <ChatThread
      title={other?.name ?? "Chat"}
      avatarName={other?.name ?? "?"}
      avatarUri={other?.profile_photo}
      meId={user?.id ?? ""}
      isDirect
      otherLastReadAt={otherLastReadAt}
      load={load}
      send={send}
      uploadImage={uploadImage}
      uploadFile={uploadFile}
      deleteMessage={removeMessage}
      react={react}
      edit={edit}
      realtime={{ scope: "dm", id }}
      getToken={getAccessToken}
    />
  );
}
