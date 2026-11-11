import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  calculateDraftCompletionPct,
  getDraftHistoryDetail,
  getDraftHistoryList,
  groupPicksByRound,
  parseDraftHistoryLimit,
  type DraftHistoryPick,
} from '@/server/draft/readModels/draftHistoryReadModel';

const basePick = {
  id: 'pick-1',
  slot: 1,
  auto: false,
  madeAt: '2026-06-13T00:00:00.000Z',
  player: {
    id: 'player-1',
    name: 'Caleb Daniel',
    position: 'DEF',
    club: 'North Melbourne',
  },
  member: {
    id: 'member-1',
    userId: 'user-1',
    displayName: 'Statly Dev Tester',
    teamName: 'Statly Dev Tester',
    role: 'OWNER',
    slot: 1,
  },
} satisfies Omit<DraftHistoryPick, 'overall' | 'round'>;

describe('draft history read model helpers', () => {
  it('groups picks into ordered round buckets without losing pick order', () => {
    const rounds = groupPicksByRound([
      { ...basePick, id: 'pick-3', overall: 3, round: 2 },
      { ...basePick, id: 'pick-1', overall: 1, round: 1 },
      { ...basePick, id: 'pick-2', overall: 2, round: 1 },
    ]);

    expect(rounds).toEqual([
      {
        round: 1,
        picks: [
          expect.objectContaining({ id: 'pick-1', overall: 1 }),
          expect.objectContaining({ id: 'pick-2', overall: 2 }),
        ],
      },
      {
        round: 2,
        picks: [expect.objectContaining({ id: 'pick-3', overall: 3 })],
      },
    ]);
  });

  it('bounds API history limits so archive loading stays deliberate', () => {
    expect(parseDraftHistoryLimit(null)).toBe(25);
    expect(parseDraftHistoryLimit('0')).toBe(1);
    expect(parseDraftHistoryLimit('12')).toBe(12);
    expect(parseDraftHistoryLimit('999')).toBe(50);
    expect(parseDraftHistoryLimit('not-a-number')).toBe(25);
  });

  it('calculates completion percentage defensively', () => {
    expect(calculateDraftCompletionPct(0, 0)).toBe(0);
    expect(calculateDraftCompletionPct(2, 4)).toBe(50);
    expect(calculateDraftCompletionPct(5, 4)).toBe(100);
  });

  it('lists only the teams in the draft order, not members who left before it', async () => {
    const user = (id: string) => ({ id, displayName: id, email: null });
    const member = (id: string, draftSlot: number) => ({
      id,
      userId: `user-${id}`,
      teamName: `Team ${id}`,
      role: 'MANAGER',
      draftSlot,
      user: user(`user-${id}`),
    });
    const record = {
      id: 'draft-1',
      leagueId: 'league-1',
      status: 'COMPLETED',
      totalPicks: 2,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      startedAt: new Date('2026-06-01T00:00:00.000Z'),
      completedAt: new Date('2026-06-01T01:00:00.000Z'),
      league: {
        name: 'AFL Legends',
        categoriesJson: [],
        settings: { rosterSize: 1, benchSize: 0 },
        members: [member('member-1', 1), member('member-gone', 2), member('member-2', 3)],
      },
      orders: [
        { memberId: 'member-1', slot: 1 },
        { memberId: 'member-2', slot: 2 },
      ],
      picks: [],
    };
    const db = {
      draft: { findFirst: vi.fn().mockResolvedValue(record), findMany: vi.fn() },
    };
    db.draft.findMany.mockResolvedValue([record]);

    const detail = await getDraftHistoryDetail(db as never, 'user-member-1', 'draft-1');
    const list = await getDraftHistoryList(db as never, 'user-member-1');

    expect(detail?.participants.map((participant) => participant.id)).toEqual([
      'member-1',
      'member-2',
    ]);
    expect(detail?.teamCount).toBe(2);
    expect(list.metrics.teamCount).toBe(2);
  });

  it('supports selected-league scoping at the Prisma read boundary', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/readModels/draftHistoryReadModel.ts'),
      'utf8'
    );

    expect(source).toContain('leagueId?: string');
    expect(source).toContain('options.leagueId');
    expect(source).toContain('...(leagueId ? { leagueId } : {})');
    expect(source).toContain('some: { userId, isActive: true }');
  });
});
