import { DraftStatus, LeagueRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { loadCommissionerLeagues } from './commissionerReadModel';

const joinedAt = new Date('2026-02-01T00:00:00.000Z');

function member(overrides: Record<string, unknown>) {
  return {
    userId: 'user',
    teamName: 'Team',
    role: LeagueRole.MANAGER,
    isActive: true,
    status: 'ACTIVE',
    draftSlot: 1,
    joinedAt,
    user: { displayName: 'Manager' },
    ...overrides,
  };
}

describe('loadCommissionerLeagues', () => {
  it('lists only leagues the user owns, with active members and whether removal is still open', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'league-open',
        name: 'Open League',
        inviteCode: 'OPEN1',
        settings: { maxTeams: 8 },
        drafts: [
          {
            status: DraftStatus.SCHEDULED,
            startedAt: null,
            lobbyStatus: 'COUNTDOWN',
            _count: { picks: 0 },
          },
        ],
        members: [
          member({ userId: 'owner', teamName: 'Owner FC', role: LeagueRole.OWNER, draftSlot: 1 }),
          member({ userId: 'gone', teamName: 'Gone FC', isActive: false, status: 'removed' }),
          member({ userId: 'alpha', teamName: 'Alpha FC', draftSlot: 2, user: null }),
        ],
      },
      {
        id: 'league-drafted',
        name: 'Drafted League',
        inviteCode: 'DRAFT1',
        settings: { maxTeams: 4 },
        drafts: [
          {
            status: DraftStatus.LIVE,
            startedAt: joinedAt,
            lobbyStatus: 'LIVE',
            _count: { picks: 3 },
          },
        ],
        members: [member({ userId: 'owner', role: LeagueRole.OWNER })],
      },
    ]);

    const leagues = await loadCommissionerLeagues('owner', { league: { findMany } });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'owner' } }));
    expect(leagues).toEqual([
      {
        id: 'league-open',
        name: 'Open League',
        inviteCode: 'OPEN1',
        maxTeams: 8,
        memberRemovalOpen: true,
        members: [
          {
            userId: 'owner',
            teamName: 'Owner FC',
            managerName: 'Manager',
            isOwner: true,
            joinedAt: joinedAt.toISOString(),
          },
          {
            userId: 'alpha',
            teamName: 'Alpha FC',
            managerName: null,
            isOwner: false,
            joinedAt: joinedAt.toISOString(),
          },
        ],
      },
      {
        id: 'league-drafted',
        name: 'Drafted League',
        inviteCode: 'DRAFT1',
        maxTeams: 4,
        memberRemovalOpen: false,
        members: [
          {
            userId: 'owner',
            teamName: 'Team',
            managerName: 'Manager',
            isOwner: true,
            joinedAt: joinedAt.toISOString(),
          },
        ],
      },
    ]);
  });
});
