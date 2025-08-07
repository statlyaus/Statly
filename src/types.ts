export interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  avg?: number;
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  hitouts?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s?: number;
  contestedPossessions?: number;
  injury?: string;
  games?: number;
  summary?: Record<string, number>;
}

export interface Team {
  id: string;
  name: string;
  players: string[]; // array of player IDs
}