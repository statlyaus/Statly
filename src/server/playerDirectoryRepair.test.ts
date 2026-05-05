import { describe, expect, it, vi } from 'vitest';

import {
  applyPlayerDirectoryRepairPlan,
  auditUnresolvedPlayerDirectory,
  validatePlayerDirectoryRepairPlan,
  type PlayerDirectoryRepairPlan,
} from '@/server/playerDirectoryRepair';
import { createTransactionClientMock } from '@/testUtils';

const repairEvidence = {
  source: 'footywire-unresolved-row' as const,
  sourceDocumentIds: ['doc-1'],
  sourcePlayerName: 'Jordan Croft',
  sourceTeam: 'Western Bulldogs',
  reviewedAt: '2026-04-26',
};

describe('playerDirectoryRepair', () => {
  it('audits unresolved rows as a derived grouped report', async () => {
    const prisma = createTransactionClientMock({
      unresolvedPlayerStatRow: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerName: 'Jordan Croft',
            normalizedPlayerName: 'jordan croft',
            team: 'Western Bulldogs',
            normalizedTeam: 'western bulldogs',
            round: 0,
            sourceDocumentId: 'doc-1',
          },
          {
            playerName: 'Jordan Croft',
            normalizedPlayerName: 'jordan croft',
            team: 'Western Bulldogs',
            normalizedTeam: 'western bulldogs',
            round: 1,
            sourceDocumentId: 'doc-2',
          },
        ]),
      },
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'aaron_naughton',
            name: 'Aaron Naughton',
            club: 'Western Bulldogs',
          },
        ]),
      },
    });

    const result = await auditUnresolvedPlayerDirectory(prisma, {
      season: 2026,
      rounds: [0, 1],
    });

    expect(result).toEqual([
      expect.objectContaining({
        normalizedPlayerName: 'jordan croft',
        normalizedTeam: 'western bulldogs',
        count: 2,
        rounds: [0, 1],
        sourceDocumentIds: ['doc-1', 'doc-2'],
        recommendedRepair: {
          action: 'candidate_player_or_registration',
          reason: 'no_directory_match',
        },
      }),
    ]);
  });

  it('validates entity and referential integrity before repair writes', async () => {
    const plan: PlayerDirectoryRepairPlan = {
      players: [
        {
          id: 'jordan_croft',
          name: 'Jordan Croft',
          club: 'Western Bulldogs',
          position: 'FWD',
          approvedBy: 'statly-data-review',
          notes: 'Approved from reviewed 2026 roster evidence.',
          evidence: repairEvidence,
        },
      ],
      aliases: [
        {
          playerId: 'jordan_croft',
          aliasName: 'J Croft',
          club: 'Western Bulldogs',
          seasonFrom: 2026,
          seasonTo: 2026,
          approvedBy: 'statly-data-review',
          notes: 'Source abbreviation observed in unresolved match rows.',
          evidence: repairEvidence,
        },
      ],
      registrations: [
        {
          playerId: 'jordan_croft',
          season: 2026,
          club: 'Western Bulldogs',
          position: 'FWD',
          listStatus: 'active',
          approvedBy: 'statly-data-review',
          notes: 'Approved 2026 list registration.',
          evidence: repairEvidence,
        },
      ],
      unresolvedDecisions: [],
    };
    const prisma = createTransactionClientMock({
      player: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      unresolvedPlayerStatRow: {
        count: vi.fn(),
      },
    });

    const result = await validatePlayerDirectoryRepairPlan(prisma, plan);

    expect(result.valid).toBe(true);
    expect(result.diff.playersToCreate).toHaveLength(1);
    expect(result.diff.aliasesToCreate).toHaveLength(1);
    expect(result.diff.registrationsToCreate).toHaveLength(1);
    expect(result.diff.aliasesToCreate[0]).toMatchObject({
      scopeKey: '2026:2026:western bulldogs',
    });
  });

  it('rejects repair entries without structured source evidence', async () => {
    const plan = {
      players: [
        {
          id: 'western-bulldogs-jordan-croft',
          name: 'Jordan Croft',
          club: 'Western Bulldogs',
          position: 'FWD',
          approvedBy: 'manual-review-2026-04-26',
          notes: 'Reviewed from unresolved Footywire 2026 rounds 0-1 audit.',
        },
      ],
      aliases: [],
      registrations: [],
      unresolvedDecisions: [],
    } as unknown as PlayerDirectoryRepairPlan;
    const prisma = createTransactionClientMock({
      player: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      unresolvedPlayerStatRow: {
        count: vi.fn(),
      },
    });

    const result = await validatePlayerDirectoryRepairPlan(prisma, plan);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Player western-bulldogs-jordan-croft is missing evidence.sourceDocumentIds'
    );
  });

  it('rejects ambiguous alias scopes and unknown alias targets', async () => {
    const plan: PlayerDirectoryRepairPlan = {
      players: [],
      aliases: [
        {
          playerId: 'missing_player',
          aliasName: 'J Smith',
          club: 'Carlton',
          seasonFrom: 2026,
          seasonTo: 2026,
          approvedBy: 'statly-data-review',
          notes: 'Invalid target for test.',
          evidence: repairEvidence,
        },
      ],
      registrations: [],
      unresolvedDecisions: [],
    };
    const prisma = createTransactionClientMock({
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jagga_smith',
            name: 'Jagga Smith',
            club: 'Carlton',
            position: 'MID',
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'jagga_smith',
            aliasName: 'J Smith',
            normalizedAliasName: 'j smith',
            club: 'Carlton',
            normalizedClub: 'carlton',
            scopeKey: '2026:2026:carlton',
            seasonFrom: 2026,
            seasonTo: 2026,
          },
        ]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      unresolvedPlayerStatRow: {
        count: vi.fn(),
      },
    });

    const result = await validatePlayerDirectoryRepairPlan(prisma, plan);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Alias J Smith -> missing_player targets unknown player',
        'Alias J Smith -> missing_player would create an ambiguous alias scope',
      ])
    );
  });

  it('rejects duplicate player-club-season identities and underspecified repairs', async () => {
    const plan: PlayerDirectoryRepairPlan = {
      players: [
        {
          id: 'jordan_croft_duplicate',
          name: 'Jordan Croft',
          club: 'Western Bulldogs',
          position: 'FWD',
          approvedBy: 'statly-data-review',
          notes: 'Approved from reviewed 2026 roster evidence.',
          evidence: repairEvidence,
        },
        {
          id: 'orphan_new_player',
          name: 'Orphan New Player',
          club: 'Carlton',
          position: 'MID',
          approvedBy: 'statly-data-review',
          notes: 'Approved from reviewed 2026 roster evidence.',
          evidence: {
            ...repairEvidence,
            sourceDocumentIds: ['doc-orphan'],
            sourcePlayerName: 'Orphan New Player',
            sourceTeam: 'Carlton',
          },
        },
      ],
      aliases: [
        {
          playerId: 'jordan_croft',
          aliasName: 'J Croft',
          club: 'Western Bulldogs',
          approvedBy: 'statly-data-review',
          notes: 'Source abbreviation observed in unresolved match rows.',
          evidence: repairEvidence,
        },
      ],
      registrations: [
        {
          playerId: 'jordan_croft_duplicate',
          season: 2026,
          club: 'Western Bulldogs',
          position: 'FWD',
          approvedBy: 'statly-data-review',
          notes: 'Approved 2026 list registration.',
          evidence: repairEvidence,
        },
      ],
      unresolvedDecisions: [
        {
          season: 2026,
          playerName: 'Source Mistake',
          team: 'Carlton',
          status: 'DISMISSED',
          approvedBy: 'statly-data-review',
          notes: 'Reviewed source row does not correspond to a canonical player.',
          evidence: {
            ...repairEvidence,
            sourceDocumentIds: ['bad-doc-1'],
            sourcePlayerName: 'Source Mistake',
            sourceTeam: 'Carlton',
          },
        },
      ],
    };
    const prisma = createTransactionClientMock({
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jordan_croft',
            name: 'Jordan Croft',
            club: 'Western Bulldogs',
            position: 'FWD',
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'jordan_croft',
            season: 2026,
            club: 'Western Bulldogs',
            normalizedClub: 'western bulldogs',
            player: {
              id: 'jordan_croft',
              name: 'Jordan Croft',
            },
          },
        ]),
      },
      unresolvedPlayerStatRow: {
        count: vi.fn().mockResolvedValue(1),
      },
    });

    const result = await validatePlayerDirectoryRepairPlan(prisma, plan);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Registration jordan_croft_duplicate 2026 Western Bulldogs duplicates a player-club-season identity',
        'Player orphan_new_player is missing same-season registration for Carlton',
        'Alias J Croft -> jordan_croft must include seasonFrom and seasonTo for source-row repair',
        'Unresolved decision Source Mistake 2026 dismissal notes must begin with "Dismissed:"',
      ])
    );
  });

  it('applies repair plans idempotently after validation', async () => {
    const plan: PlayerDirectoryRepairPlan = {
      players: [
        {
          id: 'jordan_croft',
          name: 'Jordan Croft',
          club: 'Western Bulldogs',
          position: 'FWD',
          active: true,
          approvedBy: 'statly-data-review',
          notes: 'Approved from reviewed 2026 roster evidence.',
          evidence: repairEvidence,
        },
      ],
      aliases: [],
      registrations: [
        {
          playerId: 'jordan_croft',
          season: 2026,
          club: 'Western Bulldogs',
          position: 'FWD',
          listStatus: 'active',
          approvedBy: 'statly-data-review',
          notes: 'Approved 2026 list registration.',
          evidence: repairEvidence,
        },
      ],
      unresolvedDecisions: [
        {
          season: 2026,
          playerName: 'Source Mistake',
          team: 'Carlton',
          status: 'DISMISSED',
          approvedBy: 'statly-data-review',
          notes: 'Dismissed: reviewed source row does not correspond to a canonical player.',
          evidence: {
            ...repairEvidence,
            sourceDocumentIds: ['bad-doc-1'],
            sourcePlayerName: 'Source Mistake',
            sourceTeam: 'Carlton',
          },
        },
      ],
    };
    const prisma = createTransactionClientMock({
      player: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(undefined),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(undefined),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      unresolvedPlayerStatRow: {
        count: vi.fn().mockResolvedValue(2),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    });

    const result = await applyPlayerDirectoryRepairPlan(prisma, plan, { dryRun: false });

    expect(result.valid).toBe(true);
    expect(result.applied).toBe(true);
    expect(prisma.player.create).toHaveBeenCalledWith({
      data: {
        id: 'jordan_croft',
        name: 'Jordan Croft',
        club: 'Western Bulldogs',
        position: 'FWD',
        active: true,
      },
    });
    expect(prisma.playerSeasonRegistration.create).toHaveBeenCalledWith({
      data: {
        playerId: 'jordan_croft',
        season: 2026,
        club: 'Western Bulldogs',
        normalizedClub: 'western bulldogs',
        position: 'FWD',
        listStatus: 'active',
        active: true,
        source: 'MANUAL',
        approvedBy: 'statly-data-review',
        notes:
          'Approved 2026 list registration. Evidence: {"source":"footywire-unresolved-row","sourceDocumentIds":["doc-1"],"sourcePlayerName":"Jordan Croft","sourceTeam":"Western Bulldogs","reviewedAt":"2026-04-26"}',
      },
    });
    expect(prisma.unresolvedPlayerStatRow.updateMany).toHaveBeenCalledOnce();
  });
});
