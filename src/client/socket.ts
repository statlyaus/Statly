import { io, type Socket } from 'socket.io-client';

interface DraftUpdate {
  draftId: string;
  currentPick: number;
  picks: Array<{
    playerId: string;
    memberid: string;
    round: number;
    pick: number;
  }>;
}

interface QueueUpdate {
  draftId: string;
  queue: Array<{
    playerId: string;
    memberId: string;
  }>;
}

interface DraftSocketHandlers {
  onDraftUpdate?: (data: DraftUpdate) => void;
  onQueueUpdate?: (data: QueueUpdate) => void;
  onError?: (error: Error) => void;
}

export function joinDraft(
  draftId: string,
  handlers: DraftSocketHandlers = {}
): { socket: Socket; cleanup: () => void } {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  const socket = io(`${baseUrl}/draft-${draftId}`);

  const { onDraftUpdate, onQueueUpdate, onError } = handlers;
  if (onDraftUpdate) socket.on("draft", onDraftUpdate);
  if (onQueueUpdate) socket.on("queue", onQueueUpdate);
  if (onError) socket.on("error", onError);

  const cleanup = () => {
    socket.disconnect();
  };

  return { socket, cleanup };
}