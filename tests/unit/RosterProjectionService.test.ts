import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

import {
  RosterPreferenceError,
  RosterProjectionService,
} from '@/server/rosters/RosterProjectionService';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('RosterProjectionService', () => {
  function makeTx(
    picks: Array<{ id: string; playerId: string; memberId: string; overall: number }>,
    existingPlayerIds: string[] = []
  ) {
    return {
      league: { findUnique: vi.fn().mockResolvedValue({ activeSeasonId: 'season-1' }) },
      pick: {
        findMany: vi.fn().mockResolvedValue(picks.map((pick) => ({ ...pick, draftId: 'draft-1' }))),
      },
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue(existingPlayerIds.map((playerId) => ({ playerId }))),
        createMany: vi.fn().mockResolvedValue({ count: picks.length }),
        update: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
      waiverPriority: {
        upsert: vi.fn().mockResolvedValue({ id: 'waiver-priority-1' }),
      },
    };
  }

  it('creates one league-wide ownership row per pick on the caller transaction', async () => {
    const tx = makeTx([
      { id: 'pick-1', playerId: 'player-1', memberId: 'member-1', overall: 1 },
      { id: 'pick-2', playerId: 'player-2', memberId: 'member-2', overall: 2 },
    ]);
    const waiverAvailabilityProjectionService = { projectLeague: vi.fn() };
    const service = new RosterProjectionService({} as never, waiverAvailabilityProjectionService);

    const result = await service.projectDraftInTx(tx as never, {
      leagueId: 'league-1',
      draftId: 'draft-1',
    });

    expect(tx.pick.findMany).toHaveBeenCalledWith({
      where: { draftId: 'draft-1' },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true, overall: true },
    });
    expect(tx.leagueRosterPlayer.createMany).toHaveBeenCalledWith({
      data: [
        {
          leagueId: 'league-1',
          memberId: 'member-1',
          draftId: 'draft-1',
          pickId: 'pick-1',
          playerId: 'player-1',
          acquiredBy: 'DRAFT',
        },
        {
          leagueId: 'league-1',
          memberId: 'member-2',
          draftId: 'draft-1',
          pickId: 'pick-2',
          playerId: 'player-2',
          acquiredBy: 'DRAFT',
        },
      ],
    });
    expect(tx.leagueRosterPlayer.update).not.toHaveBeenCalled();
    // Firestore availability is refreshed after the commit, never inside the transaction.
    expect(waiverAvailabilityProjectionService.projectLeague).not.toHaveBeenCalled();
    expect(result).toEqual({ projected: 2 });
  });

  it('reassigns ownership rows a previous draft of the league left behind', async () => {
    const tx = makeTx(
      [
        { id: 'pick-1', playerId: 'player-1', memberId: 'member-1', overall: 1 },
        { id: 'pick-2', playerId: 'player-2', memberId: 'member-2', overall: 2 },
      ],
      ['player-2']
    );
    const service = new RosterProjectionService({} as never, { projectLeague: vi.fn() });

    await service.projectDraftInTx(tx as never, { leagueId: 'league-1', draftId: 'draft-1' });

    expect(tx.leagueRosterPlayer.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ playerId: 'player-1', memberId: 'member-1' })],
    });
    expect(tx.leagueRosterPlayer.update).toHaveBeenCalledWith({
      where: { leagueId_playerId: { leagueId: 'league-1', playerId: 'player-2' } },
      data: { memberId: 'member-2', draftId: 'draft-1', pickId: 'pick-2', acquiredBy: 'DRAFT' },
    });
  });

  it('seeds waiver priority from reverse final draft pick order', async () => {
    const tx = makeTx([
      { id: 'pick-1', playerId: 'player-1', memberId: 'member-1', overall: 1 },
      { id: 'pick-2', playerId: 'player-2', memberId: 'member-2', overall: 2 },
      { id: 'pick-3', playerId: 'player-3', memberId: 'member-2', overall: 3 },
      { id: 'pick-4', playerId: 'player-4', memberId: 'member-1', overall: 4 },
    ]);
    const service = new RosterProjectionService({} as never, { projectLeague: vi.fn() });

    await service.projectDraftInTx(tx as never, { leagueId: 'league-1', draftId: 'draft-1' });

    expect(tx.waiverPriority.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        leagueId_seasonId_memberId: {
          leagueId: 'league-1',
          seasonId: 'season-1',
          memberId: 'member-1',
        },
      },
      update: { priority: 1 },
      create: {
        leagueId: 'league-1',
        seasonId: 'season-1',
        memberId: 'member-1',
        priority: 1,
      },
    });
    expect(tx.waiverPriority.upsert).toHaveBeenNthCalledWith(2, {
      where: {
        leagueId_seasonId_memberId: {
          leagueId: 'league-1',
          seasonId: 'season-1',
          memberId: 'member-2',
        },
      },
      update: { priority: 2 },
      create: {
        leagueId: 'league-1',
        seasonId: 'season-1',
        memberId: 'member-2',
        priority: 2,
      },
    });
  });

  it('refreshes waiver availability and tolerates a Firestore failure', async () => {
    const waiverAvailabilityProjectionService = {
      projectLeague: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
    };
    const service = new RosterProjectionService({} as never, waiverAvailabilityProjectionService);

    await expect(
      service.refreshWaiverAvailability({ leagueId: 'league-1', draftId: 'draft-1' })
    ).resolves.toBeUndefined();
    expect(waiverAvailabilityProjectionService.projectLeague).toHaveBeenCalledWith({
      leagueId: 'league-1',
    });
  });

  it('projects rosters inside the final pick transaction and refreshes availability after it', () => {
    const source = read('src/server/draft/services/DraftApplicationService.ts');

    expect(source).toContain('import { RosterProjectionService }');
    expect(source).toContain('private readonly rosterProjectionService');
    expect(source).toContain('rosterProjection.projectDraftInTx(tx');
    expect(source).toContain('if (result.isComplete)');
    expect(source).toContain('this.rosterProjectionService.refreshWaiverAvailability');
  });

  it('updates bench position on LeagueRosterPlayer when saving preferences', async () => {
    const tx = {
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue([
          { playerId: 'player-2', player: { id: 'player-2' }, updatedAt: new Date() },
          { playerId: 'player-1', player: { id: 'player-1' }, updatedAt: new Date() },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        update: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'ownership-1',
          leagueId: 'league-1',
          memberId: 'member-1',
          updatedAt: new Date(),
        }),
      },
    };
    const db = {
      $transaction: vi.fn((work) => work(tx)),
    };
    const service = new RosterProjectionService(db as never);

    await service.updateMemberPreferences({
      leagueId: 'league-1',
      memberId: 'member-1',
      submittedPlayerIds: ['player-1', 'player-2'],
      benchOrder: ['player-2'],
    });

    expect(tx.leagueRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', memberId: 'member-1' },
      data: { benchPosition: null },
    });
    expect(tx.leagueRosterPlayer.update).toHaveBeenCalledWith({
      where: {
        leagueId_memberId_playerId: {
          leagueId: 'league-1',
          memberId: 'member-1',
          playerId: 'player-2',
        },
      },
      data: { benchPosition: 0 },
    });
  });

  it('rejects a stale client roster without changing ownership or preferences', async () => {
    const tx = {
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue([{ playerId: 'player-1' }]),
        updateMany: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn((work) => work(tx)),
    };
    const service = new RosterProjectionService(db as never);

    await expect(
      service.updateMemberPreferences({
        leagueId: 'league-1',
        memberId: 'member-1',
        submittedPlayerIds: ['player-1', 'player-2'],
      })
    ).rejects.toMatchObject({
      code: 'ROSTER_CHANGED',
      status: 409,
    } satisfies Partial<RosterPreferenceError>);
    expect(tx.leagueRosterPlayer.updateMany).not.toHaveBeenCalled();
  });
});
