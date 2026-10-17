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
