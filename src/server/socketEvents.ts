import { EventEmitter } from 'events';

export interface DraftPick {
  team: number;
  player: string;
}

export const draftSocket = new EventEmitter();

export function emitDraftPick(pick: DraftPick) {
  draftSocket.emit('draftPick', pick);
}
