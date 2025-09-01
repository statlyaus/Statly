import type { Socket } from 'socket.io-client';

export interface ServerToClientEvents {
  'dashboard:update': { timestamp: string };
  'leaderboard:update': { timestamp: string };
  'top-picks:update': { timestamp: string };
}

export interface ClientToServerEvents {
  'dashboard:refresh': void;
  'module:refresh': (moduleId: string) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
