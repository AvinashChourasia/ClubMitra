// Shared state between the chat surfaces and the in-app message banner:
// which thread the user is currently reading (so neither the banner nor the
// OS notification fires for the conversation on screen).

export type ThreadKey = `chapter:${string}` | `dm:${string}`;

let activeThread: string | null = null;

export function setActiveThread(key: ThreadKey | null): void {
  activeThread = key;
}

export function getActiveThread(): string | null {
  return activeThread;
}
