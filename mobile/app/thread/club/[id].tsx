// Club group chat. The conversation includes every member of the club; admins
// can post announcements. Tapping someone's name opens a direct chat with them.

import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { useAuth } from "../../../lib/auth";
import { getChapter, myChapters, isChapterAdmin } from "../../../lib/clubs";
import { chapterMessages, postChapter, announce as announceApi, deleteMessage as deleteMessageApi, setReaction, editMessage, createPoll, votePoll, type OutMsg } from "../../../lib/messaging";
import { uploadChatImage, uploadChatFile } from "../../../lib/upload";
import { ChatThread } from "../../../components/ChatThread";

export default function ClubGroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, getAccessToken } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("Club chat");
  const [logo, setLogo] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const [ch, mine] = await Promise.all([getChapter(token, id), myChapters(token)]);
        if (!active) return;
        setTitle(ch.name);
        setLogo(ch.logo ?? null);
        setIsAdmin(isChapterAdmin(mine.find((c) => c.id === id)?.role));
      } catch {
        /* header stays default */
      }
    })();
    return () => {
      active = false;
    };
  }, [getAccessToken, id]);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    return token ? chapterMessages(token, id) : [];
  }, [getAccessToken, id]);

  const send = useCallback(async (msg: OutMsg) => {
    const token = await getAccessToken();
    if (token) await postChapter(token, id, msg);
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

  const announce = useCallback(async (body: string) => {
    const token = await getAccessToken();
    if (token) await announceApi(token, id, body);
  }, [getAccessToken, id]);

  const react = useCallback(async (mid: string, emoji: string) => {
    const token = await getAccessToken();
    if (token) await setReaction(token, mid, emoji);
  }, [getAccessToken]);

  const edit = useCallback(async (mid: string, body: string) => {
    const token = await getAccessToken();
    if (token) await editMessage(token, mid, body);
  }, [getAccessToken]);

  const makePoll = useCallback(async (input: { question: string; options: string[]; multi: boolean }) => {
    const token = await getAccessToken();
    if (token) await createPoll(token, id, input);
  }, [getAccessToken, id]);

  const vote = useCallback(async (mid: string, optionId: string) => {
    const token = await getAccessToken();
    if (token) await votePoll(token, mid, optionId);
  }, [getAccessToken]);

  return (
    <ChatThread
      title={title}
      subtitle="Club group"
      avatarName={title}
      avatarUri={logo}
      meId={user?.id ?? ""}
      isGroup
      load={load}
      send={send}
      uploadImage={uploadImage}
      uploadFile={uploadFile}
      deleteMessage={removeMessage}
      react={react}
      edit={edit}
      realtime={{ scope: "chapter", id }}
      getToken={getAccessToken}
      canAnnounce={isAdmin}
      announce={announce}
      createPoll={isAdmin ? makePoll : undefined}
      voteOnPoll={vote}
      onSenderPress={(senderId) => {
        if (senderId !== user?.id) router.push(`/u/${senderId}` as Href);
      }}
    />
  );
}
