export interface ServerToClientEvents {
  'dashboard:update': (payload: { timestamp: string }) => void;
  'leaderboard:update': (payload: { timestamp: string }) => void;
  'top-picks:update': (payload: { timestamp: string }) => void;
  'live-draft:update': (payload: { timestamp: string }) => void;
  'league-management:update': (payload: { timestamp: string }) => void;
}

export interface ClientToServerEvents {
  'dashboard:refresh': () => void;
  'module:refresh': (moduleId: string) => void;
}
