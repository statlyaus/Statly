import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

import { RosterProjectionService } from '@/server/rosters/RosterProjectionService';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('RosterProjectionService', () => {
  it('projects each pick into one league-wide player ownership row', async () => {
    const db = {
      pick: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pick-1',
            draftId: 'draft-1',
            playerId: 'player-1',
            memberId: 'member-1',
            overall: 1,
          },
        ]),
      },
      leagueRoster: {
        upsert: vi.fn().mockResolvedValue({ id: 'roster-1', playerIds: '[]' }),
      },
      leagueRosterPlayer: {
        upsert: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
      waiverPriority: {
        upsert: vi.fn().mockResolvedValue({ id: 'waiver-priority-1' }),
      },
    };
    const waiverAvailabilityProjectionService = {
      projectLeague: vi.fn().mockResolvedValue({ owned: 1, available: 0 }),
    };

    const service = new RosterProjectionService(db as never, waiverAvailabilityProjectionService);
    const result = await service.projectDraft({ leagueId: 'league-1', draftId: 'draft-1' });

    expect(db.pick.findMany).toHaveBeenCalledWith({
      where: { draftId: 'draft-1' },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true, overall: true },
    });
    expect(db.leagueRoster.upsert).toHaveBeenCalledWith({
      where: { leagueId_memberId: { leagueId: 'league-1', memberId: 'member-1' } },
      update: {},
      create: {
        leagueId: 'league-1',
        memberId: 'member-1',
        playerIds: '[]',
      },
    });
    expect(db.leagueRosterPlayer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId_playerId: { leagueId: 'league-1', playerId: 'player-1' } },
        update: expect.objectContaining({
          memberId: 'member-1',
          draftId: 'draft-1',
          pickId: 'pick-1',
          acquiredBy: 'DRAFT',
        }),
        create: expect.objectContaining({
          leagueId: 'league-1',
          memberId: 'member-1',
          draftId: 'draft-1',
          pickId: 'pick-1',
          playerId: 'player-1',
          acquiredBy: 'DRAFT',
        }),
      })
    );
    expect(waiverAvailabilityProjectionService.projectLeague).toHaveBeenCalledWith({
      leagueId: 'league-1',
    });
    expect(db.waiverPriority.upsert).toHaveBeenCalledWith({
      where: { leagueId_memberId: { leagueId: 'league-1', memberId: 'member-1' } },
      update: { priority: 1 },
      create: {
        leagueId: 'league-1',
        memberId: 'member-1',
        priority: 1,
      },
    });
    expect(result).toEqual({ projected: 1 });
  });

  it('keeps completed draft roster projection successful when waiver availability projection is unavailable', async () => {
    const db = {
      pick: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pick-1',
            draftId: 'draft-1',
            playerId: 'player-1',
            memberId: 'member-1',
            overall: 1,
          },
        ]),
      },
      leagueRoster: {
        upsert: vi.fn().mockResolvedValue({ id: 'roster-1', playerIds: '[]' }),
      },
      leagueRosterPlayer: {
        upsert: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
      waiverPriority: {
        upsert: vi.fn().mockResolvedValue({ id: 'waiver-priority-1' }),
      },
    };
    const waiverAvailabilityProjectionService = {
      projectLeague: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
    };

    const service = new RosterProjectionService(db as never, waiverAvailabilityProjectionService);
    const result = await service.projectDraft({ leagueId: 'league-1', draftId: 'draft-1' });

    expect(db.leagueRosterPlayer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId_playerId: { leagueId: 'league-1', playerId: 'player-1' } },
      })
    );
    expect(waiverAvailabilityProjectionService.projectLeague).toHaveBeenCalledWith({
      leagueId: 'league-1',
    });
    expect(result).toEqual({ projected: 1 });
  });

  it('seeds waiver priority from reverse final draft pick order', async () => {
    const db = {
      pick: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pick-1',
            draftId: 'draft-1',
            playerId: 'player-1',
            memberId: 'member-1',
            overall: 1,
          },
          {
            id: 'pick-2',
            draftId: 'draft-1',
            playerId: 'player-2',
            memberId: 'member-2',
            overall: 2,
          },
          {
            id: 'pick-3',
            draftId: 'draft-1',
            playerId: 'player-3',
            memberId: 'member-2',
            overall: 3,
          },
          {
            id: 'pick-4',
            draftId: 'draft-1',
            playerId: 'player-4',
            memberId: 'member-1',
            overall: 4,
          },
        ]),
      },
      leagueRoster: {
        upsert: vi.fn().mockResolvedValue({ id: 'roster-1', playerIds: '[]' }),
      },
      leagueRosterPlayer: {
        upsert: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
      waiverPriority: {
        upsert: vi.fn().mockResolvedValue({ id: 'waiver-priority-1' }),
      },
    };
    const waiverAvailabilityProjectionService = {
      projectLeague: vi.fn().mockResolvedValue({ owned: 4, available: 0 }),
    };

    const service = new RosterProjectionService(db as never, waiverAvailabilityProjectionService);

    await service.projectDraft({ leagueId: 'league-1', draftId: 'draft-1' });

    expect(db.waiverPriority.upsert).toHaveBeenNthCalledWith(1, {
      where: { leagueId_memberId: { leagueId: 'league-1', memberId: 'member-1' } },
      update: { priority: 1 },
      create: {
        leagueId: 'league-1',
        memberId: 'member-1',
        priority: 1,
      },
    });
    expect(db.waiverPriority.upsert).toHaveBeenNthCalledWith(2, {
      where: { leagueId_memberId: { leagueId: 'league-1', memberId: 'member-2' } },
      update: { priority: 2 },
      create: {
        leagueId: 'league-1',
        memberId: 'member-2',
        priority: 2,
      },
    });
  });

  it('projects rosters after completed draft command results', () => {
    const source = read('src/server/draft/services/DraftApplicationService.ts');

    expect(source).toContain("import { RosterProjectionService }");
    expect(source).toContain('private readonly rosterProjectionService');
    expect(source).toContain('if (result.isComplete)');
    expect(source).toContain('this.rosterProjectionService.projectDraft');
  });
});
