import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  consolidatePlayerIdentities,
  PlayerIdentityConsolidationBlockedError,
} from '@/server/players/playerIdentityConsolidation';
import { createPlayerIdentitySourceFingerprint } from '@/server/players/playerIdentityConsolidationCli';
import { planPlayerIdentityConsolidation } from '@/server/players/playerIdentityConsolidationPlanner';
import {
  AmbiguousPlayerIdentityError,
  resolveCanonicalPlayerId,
  upsertCanonicalPlayer,
} from '@/server/players/playerIdentityService';
import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const canonicalPlayerId = 'jack_ginnivan';
const aliasPlayerId = 'jack-ginnivan-hawthorn';
const conflictCanonicalId = 'same_player';
const conflictAliasId = 'same-player-club';
const now = new Date('2026-07-24T00:00:00.000Z');

const fixtureLeagueIds = ['league-a', 'league-b'];
const fixturePlayerIds = [
  canonicalPlayerId,
  aliasPlayerId,
  conflictCanonicalId,
  conflictAliasId,
  'autosub-history-alias',
  'autosub-history-replacement',
  'autosub_history_canonical',
  'draft-history-player-club',
  'draft_history_player',
  'fingerprint-guard-alias',
  'fingerprint_guard_canonical',
  'legacy-conflict-player-club',
  'legacy_conflict_player',
  'unrelated-roster-alias',
  'unrelated_roster_canonical',
];

async function deleteFixtures() {
  await prisma.queueItem.deleteMany({ where: { memberId: 'queue-member' } });
  await deleteLeagueFixtures(prisma, {
    leagueIds: fixtureLeagueIds,
    playerIds: fixturePlayerIds,
    settingsIds: ['settings-a', 'settings-b'],
    userIds: ['user-a', 'user-b', 'user-c'],
  });
}

async function seedTwoLeagueOwnerships() {
  await prisma.user.createMany({
    data: [
      {
        id: 'user-a',
        email: 'player-identity-a@example.test',
        passwordHash: 'test',
        displayName: 'Manager A',
      },
      {
        id: 'user-b',
        email: 'player-identity-b@example.test',
        passwordHash: 'test',
        displayName: 'Manager B',
      },
      {
        id: 'user-c',
        email: 'player-identity-c@example.test',
        passwordHash: 'test',
        displayName: 'Manager C',
      },
    ],
  });
  await prisma.leagueSettings.createMany({
    data: ['a', 'b'].map((suffix) => ({
      id: `settings-${suffix}`,
      rosterSize: 22,
      benchSize: 4,
      maxTeams: 12,
      pickSeconds: 60,
      draftType: 'SNAKE' as const,
      startAt: now,
    })),
  });
  await prisma.league.createMany({
    data: [
      {
        id: 'league-a',
        name: 'League A',
        inviteCode: 'IDENTITY-A',
        ownerId: 'user-a',
        settingsId: 'settings-a',
      },
      {
        id: 'league-b',
        name: 'League B',
        inviteCode: 'IDENTITY-B',
        ownerId: 'user-b',
        settingsId: 'settings-b',
      },
    ],
  });
  await prisma.leagueMember.createMany({
    data: [
      {
        id: 'member-a',
        leagueId: 'league-a',
        userId: 'user-a',
        role: 'OWNER',
        teamName: 'Team A',
      },
      {
        id: 'member-b',
        leagueId: 'league-b',
        userId: 'user-b',
        role: 'OWNER',
        teamName: 'Team B',
      },
      {
        id: 'member-c',
        leagueId: 'league-a',
        userId: 'user-c',
        role: 'MANAGER',
        teamName: 'Team C',
      },
    ],
  });
  await prisma.player.createMany({
    data: [
      {
        id: canonicalPlayerId,
        name: 'Jack Ginnivan',
        club: 'Hawthorn',
        position: 'FWD',
      },
      {
        id: aliasPlayerId,
        name: 'Jack Ginnivan',
        club: 'Hawthorn',
        position: 'FWD',
      },
    ],
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      {
        id: 'ownership-a',
        leagueId: 'league-a',
        memberId: 'member-a',
        playerId: aliasPlayerId,
      },
      {
        id: 'ownership-b',
        leagueId: 'league-b',
        memberId: 'member-b',
        playerId: canonicalPlayerId,
      },
    ],
  });
  await prisma.leagueRoster.createMany({
    data: [
      {
        id: 'legacy-roster-a',
        leagueId: 'league-a',
        memberId: 'member-a',
        playerIds: JSON.stringify([aliasPlayerId]),
      },
      {
        id: 'legacy-roster-b',
        leagueId: 'league-b',
        memberId: 'member-b',
        playerIds: JSON.stringify([canonicalPlayerId]),
      },
    ],
  });
  await prisma.playerExternalIdentity.createMany({
    data: [canonicalPlayerId, aliasPlayerId].map((playerId) => ({
      playerId,
      provider: 'statly-legacy',
      externalId: playerId,
    })),
  });
}

describe.sequential('player identity consolidation', () => {
  beforeAll(async () => {
    await deleteFixtures();
    await seedTwoLeagueOwnerships();
  });

  afterAll(async () => {
    await deleteFixtures();
  });

  it('consolidates an alias and preserves independent ownership in different leagues', async () => {
    await expect(resolveCanonicalPlayerId(' ', undefined, prisma)).resolves.toBeNull();

    await prisma.queueItem.createMany({
      data: [
        { id: 'canonical-queue', memberId: 'queue-member', playerId: canonicalPlayerId, rank: 2 },
        { id: 'alias-queue', memberId: 'queue-member', playerId: aliasPlayerId, rank: 1 },
      ],
    });
    await prisma.teamAction.create({
      data: {
        id: 'historical-alias-action',
        leagueId: 'league-a',
        memberId: 'member-a',
        actionType: 'WAIVER_CLAIM',
        status: 'PROCESSED',
        details: JSON.stringify({ playerId: aliasPlayerId }),
      },
    });

    const mapping = [{ aliasId: aliasPlayerId, canonicalPlayerId }];
    const plan = await planPlayerIdentityConsolidation(prisma, mapping);
    expect(plan.status).toBe('ready');
    expect(plan.references.rosterPlayers).toBe(1);

    await consolidatePlayerIdentities(prisma, mapping);

    await expect(
      prisma.player.findMany({
        where: { id: { in: [canonicalPlayerId, aliasPlayerId] } },
        orderBy: { id: 'asc' },
        select: { id: true },
      })
    ).resolves.toEqual([{ id: canonicalPlayerId }]);
    await expect(
      prisma.leagueRosterPlayer.findMany({
        where: { leagueId: { in: fixtureLeagueIds } },
        orderBy: { leagueId: 'asc' },
        select: { leagueId: true, memberId: true, playerId: true },
      })
    ).resolves.toEqual([
      { leagueId: 'league-a', memberId: 'member-a', playerId: canonicalPlayerId },
      { leagueId: 'league-b', memberId: 'member-b', playerId: canonicalPlayerId },
    ]);
    await expect(
      prisma.playerExternalIdentity.findUnique({
        where: {
          provider_externalId: { provider: 'statly-legacy', externalId: aliasPlayerId },
        },
        select: { playerId: true },
      })
    ).resolves.toEqual({ playerId: canonicalPlayerId });
    await expect(
      prisma.queueItem.findUnique({
        where: {
          memberId_playerId: { memberId: 'queue-member', playerId: canonicalPlayerId },
        },
        select: { rank: true },
      })
    ).resolves.toEqual({ rank: 1 });
    await expect(
      prisma.teamAction.findUnique({
        where: { id: 'historical-alias-action' },
        select: { details: true },
      })
    ).resolves.toEqual({ details: JSON.stringify({ playerId: aliasPlayerId }) });
    await expect(resolveCanonicalPlayerId(aliasPlayerId, undefined, prisma)).resolves.toBe(
      canonicalPlayerId
    );

    const importedPlayer = await upsertCanonicalPlayer(prisma, {
      provider: 'fixture-import',
      externalId: 'fixture-jack-ginnivan',
      name: 'Jack Ginnivan',
      club: 'Hawthorn',
      position: 'FWD',
      allowExactAttributeMatch: true,
    });
    expect(importedPlayer.id).toBe(canonicalPlayerId);
    await expect(
      prisma.player.count({ where: { name: 'Jack Ginnivan', club: 'Hawthorn' } })
    ).resolves.toBe(1);
    await expect(
      upsertCanonicalPlayer(prisma, {
        provider: 'future-weak-import',
        externalId: 'fixture-jack-ginnivan-new-club',
        name: 'Jack Ginnivan',
        club: 'New Club',
        position: 'FWD',
        allowExactAttributeMatch: true,
      })
    ).rejects.toBeInstanceOf(AmbiguousPlayerIdentityError);
    await expect(prisma.player.count({ where: { name: 'Jack Ginnivan' } })).resolves.toBe(1);

    const repeatedPlan = await consolidatePlayerIdentities(prisma, mapping);
    expect(repeatedPlan.mappings).toEqual([]);
  });

  it('blocks two different owners of aliases inside the same league', async () => {
    await prisma.player.createMany({
      data: [
        { id: conflictCanonicalId, name: 'Same Player', club: 'Club', position: 'MID' },
        { id: conflictAliasId, name: 'Same Player', club: 'Club', position: 'MID' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [conflictCanonicalId, conflictAliasId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    await prisma.leagueRosterPlayer.createMany({
      data: [
        {
          id: 'conflicting-owner-a',
          leagueId: 'league-a',
          memberId: 'member-a',
          playerId: conflictCanonicalId,
        },
        {
          id: 'conflicting-owner-c',
          leagueId: 'league-a',
          memberId: 'member-c',
          playerId: conflictAliasId,
        },
      ],
    });

    const mapping = [{ aliasId: conflictAliasId, canonicalPlayerId: conflictCanonicalId }];
    const plan = await planPlayerIdentityConsolidation(prisma, mapping);
    expect(plan.status).toBe('blocked');
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LEAGUE_OWNERSHIP_CONFLICT', scopeId: 'league-a' }),
      ])
    );
    await expect(consolidatePlayerIdentities(prisma, mapping)).rejects.toBeInstanceOf(
      PlayerIdentityConsolidationBlockedError
    );
    await expect(
      prisma.player.count({ where: { id: { in: [conflictCanonicalId, conflictAliasId] } } })
    ).resolves.toBe(2);
  });

  it('blocks duplicate draft history for two aliases of one player', async () => {
    const canonicalId = 'draft_history_player';
    const aliasId = 'draft-history-player-club';
    await prisma.player.createMany({
      data: [
        { id: canonicalId, name: 'Draft History', club: 'Club', position: 'DEF' },
        { id: aliasId, name: 'Draft History', club: 'Club', position: 'DEF' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [canonicalId, aliasId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    await prisma.draft.create({
      data: {
        id: 'duplicate-player-draft',
        leagueId: 'league-b',
        status: 'COMPLETED',
        currentPick: 2,
        totalPicks: 2,
      },
    });
    await prisma.pick.createMany({
      data: [
        {
          id: 'duplicate-player-pick-1',
          draftId: 'duplicate-player-draft',
          overall: 1,
          round: 1,
          slot: 1,
          memberId: 'member-b',
          playerId: canonicalId,
        },
        {
          id: 'duplicate-player-pick-2',
          draftId: 'duplicate-player-draft',
          overall: 2,
          round: 1,
          slot: 2,
          memberId: 'member-b',
          playerId: aliasId,
        },
      ],
    });

    const mapping = [{ aliasId, canonicalPlayerId: canonicalId }];
    const plan = await planPlayerIdentityConsolidation(prisma, mapping);
    expect(plan.status).toBe('blocked');
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DRAFT_PICK_COLLISION',
          scopeId: 'duplicate-player-draft',
        }),
      ])
    );
    await expect(consolidatePlayerIdentities(prisma, mapping)).rejects.toBeInstanceOf(
      PlayerIdentityConsolidationBlockedError
    );
    await expect(prisma.pick.count({ where: { draftId: 'duplicate-player-draft' } })).resolves.toBe(
      2
    );
  });

  it('blocks ownership conflicts that exist only in legacy roster JSON', async () => {
    const canonicalId = 'legacy_conflict_player';
    const aliasId = 'legacy-conflict-player-club';
    await prisma.player.createMany({
      data: [
        { id: canonicalId, name: 'Legacy Conflict', club: 'Club', position: 'MID' },
        { id: aliasId, name: 'Legacy Conflict', club: 'Club', position: 'MID' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [canonicalId, aliasId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    await prisma.leagueRosterPlayer.create({
      data: {
        id: 'legacy-conflict-normalized',
        leagueId: 'league-a',
        memberId: 'member-a',
        playerId: canonicalId,
      },
    });
    await prisma.leagueRoster.create({
      data: {
        id: 'legacy-conflict-json',
        leagueId: 'league-a',
        memberId: 'member-c',
        playerIds: JSON.stringify([aliasId]),
      },
    });

    const plan = await planPlayerIdentityConsolidation(prisma, [
      { aliasId, canonicalPlayerId: canonicalId },
    ]);
    expect(plan.status).toBe('blocked');
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'LEGACY_OWNERSHIP_CONFLICT',
          scopeId: 'league-a',
        }),
      ])
    );
  });

  it('leaves unrelated malformed legacy roster JSON untouched', async () => {
    const canonicalId = 'unrelated_roster_canonical';
    const aliasId = 'unrelated-roster-alias';
    await prisma.player.createMany({
      data: [
        { id: canonicalId, name: 'Unrelated Roster', club: 'Club', position: 'DEF' },
        { id: aliasId, name: 'Unrelated Roster', club: 'Club', position: 'DEF' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [canonicalId, aliasId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    await prisma.leagueRoster.update({
      where: { leagueId_memberId: { leagueId: 'league-b', memberId: 'member-b' } },
      data: { playerIds: 'unrelated malformed data', benchOrder: 'also malformed' },
    });

    const mapping = [{ aliasId, canonicalPlayerId: canonicalId }];
    await expect(planPlayerIdentityConsolidation(prisma, mapping)).resolves.toMatchObject({
      status: 'ready',
    });
    await expect(consolidatePlayerIdentities(prisma, mapping)).resolves.toMatchObject({
      status: 'ready',
    });
    await expect(
      prisma.leagueRoster.findUnique({
        where: { leagueId_memberId: { leagueId: 'league-b', memberId: 'member-b' } },
        select: { playerIds: true, benchOrder: true },
      })
    ).resolves.toEqual({
      playerIds: 'unrelated malformed data',
      benchOrder: 'also malformed',
    });
    await expect(prisma.player.findUnique({ where: { id: aliasId } })).resolves.toBeNull();
  });

  it('rechecks the reviewed player fingerprint inside the apply transaction', async () => {
    const canonicalId = 'fingerprint_guard_canonical';
    const aliasId = 'fingerprint-guard-alias';
    await prisma.player.createMany({
      data: [
        { id: canonicalId, name: 'Fingerprint Guard', club: 'Club', position: 'FWD' },
        { id: aliasId, name: 'Fingerprint Guard', club: 'Club', position: 'FWD' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [canonicalId, aliasId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    const reviewedPlayers = await prisma.player.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, club: true, position: true },
    });
    const reviewedFingerprint = createPlayerIdentitySourceFingerprint(reviewedPlayers);
    await prisma.player.update({
      where: { id: canonicalId },
      data: { club: 'Changed After Review' },
    });

    await expect(
      consolidatePlayerIdentities(prisma, [{ aliasId, canonicalPlayerId: canonicalId }], {
        expectedSourceFingerprint: reviewedFingerprint,
      })
    ).rejects.toThrow('generate and review a new manifest');
    await expect(prisma.player.findUnique({ where: { id: aliasId } })).resolves.not.toBeNull();
  });

  it('blocks alias retirement when immutable autosub history references it', async () => {
    const canonicalId = 'autosub_history_canonical';
    const aliasId = 'autosub-history-alias';
    const replacementId = 'autosub-history-replacement';
    await prisma.player.createMany({
      data: [
        { id: canonicalId, name: 'Autosub History', club: 'Club', position: 'MID' },
        { id: aliasId, name: 'Autosub History', club: 'Club', position: 'MID' },
        { id: replacementId, name: 'Autosub Replacement', club: 'Club', position: 'MID' },
      ],
    });
    await prisma.playerExternalIdentity.createMany({
      data: [canonicalId, aliasId, replacementId].map((playerId) => ({
        playerId,
        provider: 'statly-legacy',
        externalId: playerId,
      })),
    });
    await prisma.leagueLineup.create({
      data: { id: 'autosub-history-lineup', leagueId: 'league-b', memberId: 'member-b', round: 1 },
    });
    await prisma.leagueLineupAutosub.create({
      data: {
        id: 'autosub-history-record',
        lineupId: 'autosub-history-lineup',
        outgoingPlayerId: aliasId,
        replacementPlayerId: replacementId,
        outgoingSlot: 'MID',
        outgoingSlotIndex: 0,
        interchangeSlotIndex: 0,
        reason: 'DID_NOT_PLAY',
      },
    });

    const mapping = [{ aliasId, canonicalPlayerId: canonicalId }];
    const plan = await planPlayerIdentityConsolidation(prisma, mapping);
    expect(plan.status).toBe('blocked');
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AUTOSUB_REFERENCE',
          scopeId: 'autosub-history-record',
          aliasIds: [aliasId],
        }),
      ])
    );
    await expect(consolidatePlayerIdentities(prisma, mapping)).rejects.toBeInstanceOf(
      PlayerIdentityConsolidationBlockedError
    );
    await expect(prisma.player.findUnique({ where: { id: aliasId } })).resolves.not.toBeNull();
    await expect(
      prisma.leagueLineupAutosub.findUnique({
        where: { id: 'autosub-history-record' },
        select: { outgoingPlayerId: true, replacementPlayerId: true },
      })
    ).resolves.toEqual({ outgoingPlayerId: aliasId, replacementPlayerId: replacementId });
  });
});
