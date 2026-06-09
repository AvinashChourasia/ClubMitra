// Direct (1:1) chat, keyed by the other person's user id. The conversation is
// found-or-created on first send. Header shows their name + profile photo. Read
// receipts use the other person's last-read time from the thread response.

import { useCallback, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import { useAuth } from "../../../lib/auth";
import { directThread, postDirect, deleteMessage as deleteMessageApi, type OtherUser, type OutMsg } from "../../../lib/messaging";
import { uploadChatImage, uploadChatFile } from "../../../lib/upload";
import { ChatThread } from "../../../components/ChatThread";

export default function DirectChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const [other, setOther] = useState<OtherUser | null>(null);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);

  // load fills the header (other) + read receipt time, and returns the messages.
  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return [];
    const thread = await directThread(token, id);
    setOther(thread.other);
    setOtherLastReadAt(thread.other_last_read_at ?? null);
    return thread.messages;
  }, [getAccessToken, id]);

  const send = useCallback(async (msg: OutMsg) => {
    const token = await getAccessToken();
    if (token) await postDirect(token, id, msg);
  }, [getAccessToken, id]);

  const uploadImage = useCallback(async (uri: string) => {
    const token = await getAccessToken();
    return uploadChatImage(token!, uri);
  }, [getAccessToken]);

  const uploadFile = useCallback(async (uri: string, name: string, mime: string) => {
    const token = await getAccessToken();
    return uploadChatFile(token!, uri, name, mime);
  }, [getAccessToken]);

  const removeMessage = useCallback(async (mid: string) => {
    const token = await getAccessToken();
    if (token) await deleteMessageApi(token, mid);
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
    />
  );
}
