import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  clearBloodsuckerOnDeparture,
  getLeagueFormatDraftBlockers,
  getLeagueFormatWaiverError,
  normalizeLeagueFormat,
  resolveBloodsuckerMemberId,
  splitDraftingMembers,
} from '@/server/leagues/leagueFormat';
import { removeLeagueMember } from '@/server/leagues/memberCommands';

const eightMembers = Array.from({ length: 8 }, (_, index) => `member-${index + 1}`);

describe('league format rules (epic #1275)', () => {
  it('reads only the three known formats and keeps the fallback otherwise', () => {
    expect(normalizeLeagueFormat('BLOODSUCKER')).toBe('BLOODSUCKER');
    expect(normalizeLeagueFormat('NO_LOSERS')).toBe('NO_LOSERS');
    expect(normalizeLeagueFormat('STANDARD', 'BLOODSUCKER')).toBe('STANDARD');
    expect(normalizeLeagueFormat('VAMPIRE', 'BLOODSUCKER')).toBe('BLOODSUCKER');
    expect(normalizeLeagueFormat(undefined)).toBe('STANDARD');
  });

  it.each([
    ['WEEKLY', null],
    ['ROLLING', 100],
    ['WEEKLY', 100],
  ])('refuses %s waivers with FAAB %s in a Bloodsucker league (BR-03)', (waiverRule, faab) => {
    expect(
      getLeagueFormatWaiverError({ leagueFormat: 'BLOODSUCKER', waiverRule, faabBudget: faab })
    ).toMatchObject({ code: 'BLOODSUCKER_REQUIRES_ROLLING' });
  });

  it('accepts rolling waivers with no FAAB, and any waivers in a standard league', () => {
    expect(
      getLeagueFormatWaiverError({
        leagueFormat: 'BLOODSUCKER',
        waiverRule: 'rolling',
        faabBudget: null,
      })
    ).toBeNull();
    expect(
      getLeagueFormatWaiverError({ leagueFormat: 'STANDARD', waiverRule: 'WEEKLY', faabBudget: 50 })
    ).toBeNull();
    expect(
      getLeagueFormatWaiverError({
        leagueFormat: 'NO_LOSERS',
        waiverRule: 'WEEKLY',
        faabBudget: 50,
      })
    ).toBeNull();
  });

  it('treats a Bloodsucker who is no longer active as unset', () => {
    const settings = { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-9' };
    expect(resolveBloodsuckerMemberId(settings, eightMembers)).toBeNull();
    expect(
      resolveBloodsuckerMemberId({ ...settings, bloodsuckerMemberId: 'member-2' }, eightMembers)
    ).toBe('member-2');
    expect(
      resolveBloodsuckerMemberId(
        { leagueFormat: 'STANDARD', bloodsuckerMemberId: 'member-2' },
        eightMembers
      )
    ).toBeNull();
  });

  it('blocks the draft with "Choose a Bloodsucker" and when fewer than 8 teams (BR-02, BR-06)', () => {
    expect(
      getLeagueFormatDraftBlockers({
        leagueFormat: 'BLOODSUCKER',
        bloodsuckerMemberId: null,
        activeMemberIds: eightMembers.slice(0, 7),
      })
    ).toEqual([
      { code: 'bloodsucker_missing', message: 'Choose a Bloodsucker.' },
      {
        code: 'bloodsucker_insufficient_teams',
        message: 'A Bloodsucker league needs at least 8 teams (12 recommended).',
      },
    ]);
    expect(
      getLeagueFormatDraftBlockers({
        leagueFormat: 'BLOODSUCKER',
        bloodsuckerMemberId: 'member-1',
        activeMemberIds: eightMembers,
      })
    ).toEqual([]);
    expect(
      getLeagueFormatDraftBlockers({
        leagueFormat: 'STANDARD',
        bloodsuckerMemberId: null,
        activeMemberIds: ['member-1', 'member-2'],
      })
    ).toEqual([]);
  });

  it('gives a No Losers league no Bloodsucker and no blockers of its own (No Losers BR-03)', () => {
    expect(
      resolveBloodsuckerMemberId(
        { leagueFormat: 'NO_LOSERS', bloodsuckerMemberId: 'member-2' },
        eightMembers
      )
    ).toBeNull();
    expect(
      getLeagueFormatDraftBlockers({
        leagueFormat: 'NO_LOSERS',
        bloodsuckerMemberId: null,
        activeMemberIds: ['member-1', 'member-2'],
      })
    ).toEqual([]);
  });
});

function departureTx(bloodsuckerMemberId: string | null) {
  return {
    leagueSettings: {
      findFirst: vi.fn(async ({ where }: { where: { bloodsuckerMemberId: string } }) =>
        where.bloodsuckerMemberId === bloodsuckerMemberId
          ? { id: 'settings-1', leagueFormat: 'BLOODSUCKER' }
          : null
      ),
      update: vi.fn(async () => ({})),
    },
    leagueCompetitionAudit: { create: vi.fn(async () => ({})) },
  };
}

describe('clearing the Bloodsucker when they leave (BR-07)', () => {
  it('clears and audits the setting when the Bloodsucker departs', async () => {
    const tx = departureTx('member-2');

    await expect(
      clearBloodsuckerOnDeparture(tx as never, {
        leagueId: 'league-1',
        memberId: 'member-2',
        actorMemberId: 'member-1',
      })
    ).resolves.toBe(true);

    expect(tx.leagueSettings.update).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { bloodsuckerMemberId: null },
    });
    expect(tx.leagueCompetitionAudit.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        actorMemberId: 'member-1',
        eventType: 'LEAGUE_FORMAT_CHANGED',
        payloadJson: {
          reason: 'BLOODSUCKER_LEFT',
          before: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
          after: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: null },
        },
      },
    });
  });

  it('leaves the setting alone when another member departs', async () => {
    const tx = departureTx('member-2');

    await expect(
      clearBloodsuckerOnDeparture(tx as never, {
        leagueId: 'league-1',
        memberId: 'member-3',
        actorMemberId: null,
      })
    ).resolves.toBe(false);
    expect(tx.leagueSettings.update).not.toHaveBeenCalled();
    expect(tx.leagueCompetitionAudit.create).not.toHaveBeenCalled();
  });

  it('clears the setting when the owner removes the Bloodsucker', async () => {
    const members = [
      { id: 'member-1', userId: 'owner-user', isActive: true, status: 'ACTIVE', draftSlot: 1 },
      { id: 'member-2', userId: 'biter-user', isActive: true, status: 'ACTIVE', draftSlot: 2 },
    ];
    const tx = {
      ...departureTx('member-2'),
      league: {
        findUnique: vi.fn(async () => ({
          id: 'league-1',
          ownerId: 'owner-user',
          members,
          drafts: [],
        })),
      },
      leagueMember: { update: vi.fn(async () => ({})) },
    };
    const client = {
      $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    };

    const result = await removeLeagueMember(
      { leagueId: 'league-1', actorUserId: 'owner-user', targetUserId: 'biter-user' },
      client as never
    );

    expect(result.ok).toBe(true);
    expect(tx.leagueSettings.update).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { bloodsuckerMemberId: null },
    });
    expect(tx.leagueCompetitionAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorMemberId: 'member-1' }),
    });
  });
});

describe('splitDraftingMembers (BR-09)', () => {
  const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('leaves the Bloodsucker out of the drafters, keeping their order', () => {
    expect(
      splitDraftingMembers(members, { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'b' })
    ).toEqual({ drafters: [{ id: 'a' }, { id: 'c' }], bloodsucker: { id: 'b' } });
  });

  it.each([
    ['a standard league', { leagueFormat: 'STANDARD', bloodsuckerMemberId: 'b' }],
    ['no Bloodsucker set', { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: null }],
    ['a Bloodsucker who left', { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'gone' }],
    ['no settings', null],
  ])('drafts everyone for %s', (_label, settings) => {
    expect(splitDraftingMembers(members, settings)).toEqual({
      drafters: members,
      bloodsucker: null,
    });
  });
});
