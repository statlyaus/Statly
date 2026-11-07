/**
 * View shapes for the waivers panel. The data comes from the Prisma-backed
 * `/api/leagues/[id]/waivers` route; these types only describe what the
 * client renders.
 */

export interface LeagueRoster {
  id: string;
  userId: string;
  teamName: string;
  playerIds: string[];
  bench: string[];
  emergencies: string[];
  leagueId: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface LeagueWaiverClaim {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  processingAt: Date;
  processedAt?: Date;
  reason?: string;
  createdAt: Date;
  bidAmount?: number;
}

export interface LeagueActivityItem {
  id: string;
  leagueId: string;
  type: 'waiver-submitted' | 'waiver-successful' | 'waiver-failed' | 'waiver-cancelled' | string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string;
  bidAmount?: number;
  priority?: number;
  claimId?: string;
  reason?: string;
  timestamp: Date;
}
