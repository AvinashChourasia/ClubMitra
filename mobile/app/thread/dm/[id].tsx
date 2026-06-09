// Direct (1:1) chat, keyed by the other person's user id. The conversation is
// found-or-created on open. Header shows their name + profile photo (read-only).

import { useCallback, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import { useAuth } from "../../../lib/auth";
import { directThread, postDirect, type OtherUser } from "../../../lib/messaging";
import { ChatThread } from "../../../components/ChatThread";

export default function DirectChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const [other, setOther] = useState<OtherUser | null>(null);

  // load both fills the header (other) and returns the messages for ChatThread.
  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return [];
    const thread = await directThread(token, id);
    setOther(thread.other);
    return thread.messages;
  }, [getAccessToken, id]);

  const send = useCallback(async (body: string) => {
    const token = await getAccessToken();
    if (token) await postDirect(token, id, body);
  }, [getAccessToken, id]);

  return (
    <ChatThread
      title={other?.name ?? "Chat"}
      avatarName={other?.name ?? "?"}
      avatarUri={other?.profile_photo}
      meId={user?.id ?? ""}
      load={load}
      send={send}
    />
  );
}
