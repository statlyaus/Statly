// Stable DTOs for roster flows

export type RosterPlayerDTO = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  injury?: string | null;
};

export type RosterTeamDTO = {
  teamId: string;
  teamName?: string;
  playerCount: number;
};

export type ListRostersResponse = {
  items: RosterTeamDTO[];
  nextCursor: string | null;
};

export type SingleRosterResponse = {
  teamId: string;
  teamName?: string;
  players: RosterPlayerDTO[];
  updatedAt?: string;
};
