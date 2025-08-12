import { io, Socket } from 'socket.io-client';
import type { Pick as DraftPick, Queue } from '@prisma/client';

export interface DraftSocketHandlers {
  onConnect?: (socket: Socket) => void;
  onDisconnect?: () => void;
  onPick?: (pick: DraftPick) => void;
  onQueueUpdate?: (queue: Queue[]) => void;
  onError?: (err: string) => void;
}

/**
 * Connects to the draft namespace and wires up provided event handlers.
 */
export function joinDraft(draftId: string, handlers: DraftSocketHandlers = {}): { socket: Socket; cleanup: () => void } {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
  const socket = io(`${baseUrl}/draft-${draftId}`);

  const { onConnect, onDisconnect, onPick, onQueueUpdate, onError } = handlers;

  if (onConnect) socket.on('connect', () => onConnect(socket));
  if (onDisconnect) socket.on('disconnect', onDisconnect);
  if (onPick) socket.on('pick', onPick);
  if (onQueueUpdate) socket.on('queue', onQueueUpdate);
  if (onError) socket.on('error', onError);

  const cleanup = () => {
    socket.disconnect();
  };

  return { socket, cleanup };
}

