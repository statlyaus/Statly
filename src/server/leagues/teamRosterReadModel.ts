import 'server-only';

import { prisma } from '@/lib/prisma';

import { getLeagueMembershipAccess } from './membership';

export interface LeagueTeamRosterPlayer {
  id: string;
  name: string;
  club: string;
  position: string;
}

export interface LeagueTeamRoster {
  memberId: string;
  teamName: string;
  teamLogoUrl: string | null;
  players: LeagueTeamRosterPlayer[];
}

export type LeagueTeamRosterResult =
  | { ok: true; roster: LeagueTeamRoster }
  | { ok: false; status: 'unauthorized' | 'forbidden' | 'not-found' };

export async function loadAuthorizedLeagueTeamRoster({
  leagueId,
  memberId,
  viewerUserId,
}: {
  leagueId: string;
  memberId: string;
  viewerUserId: string | null;
}): Promise<LeagueTeamRosterResult> {
  if (!viewerUserId) return { ok: false, status: 'unauthorized' };

  const access = await getLeagueMembershipAccess(leagueId, viewerUserId);
  if (!access.isMember) return { ok: false, status: 'forbidden' };

  const member = await prisma.leagueMember.findFirst({
    where: { id: memberId, leagueId },
    select: {
      id: true,
      teamName: true,
      teamLogoUrl: true,
      rosterPlayers: {
        select: {
          player: { select: { id: true, name: true, club: true, position: true } },
        },
        orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!member) return { ok: false, status: 'not-found' };

  const players = member.rosterPlayers.map(({ player }) => player);
  if (players.length > 0) {
    return {
      ok: true,
      roster: {
        memberId: member.id,
        teamName: member.teamName,
        teamLogoUrl: member.teamLogoUrl,
        players,
      },
    };
  }

  const legacyRoster = await prisma.leagueRoster.findUnique({
    where: { leagueId_memberId: { leagueId, memberId } },
    select: { playerIds: true },
  });
  const legacyPlayerIds = parseLegacyPlayerIds(legacyRoster?.playerIds);
  const legacyPlayers = await loadPlayersByIds(legacyPlayerIds);

  return {
    ok: true,
    roster: {
      memberId: member.id,
      teamName: member.teamName,
      teamLogoUrl: member.teamLogoUrl,
      players: legacyPlayers,
    },
  };
}

export function parseLegacyPlayerIds(playerIdsJson: string | undefined): string[] {
  if (!playerIdsJson) return [];

  try {
    const parsed = JSON.parse(playerIdsJson);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.flatMap((playerId) => {
              if (typeof playerId !== 'string') return [];
              const normalizedPlayerId = playerId.trim();
              return normalizedPlayerId ? [normalizedPlayerId] : [];
            })
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

async function loadPlayersByIds(playerIds: readonly string[]): Promise<LeagueTeamRosterPlayer[]> {
  if (playerIds.length === 0) return [];

  const players = await prisma.player.findMany({
    where: { id: { in: [...playerIds] } },
    select: { id: true, name: true, club: true, position: true },
  });
  const playersById = new Map(players.map((player) => [player.id, player]));

  return playerIds.flatMap((playerId) => {
    const player = playersById.get(playerId);
    return player ? [player] : [];
  });
}
