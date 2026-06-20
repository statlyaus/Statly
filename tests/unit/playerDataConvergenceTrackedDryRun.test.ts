import { describe, expect, it } from 'vitest';

import { buildPlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import type { Player } from '@/types/players';

const tempDb = '/tmp/statly-verify-20260621020202.db';

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: 'caleb-daniel-north-melbourne',
    name: 'Caleb Daniel',
    team: 'North Melbourne',
    position: 'DEF',
    stats: {},
    ...overrides,
  } as Player;
}

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    Player: 'Caleb Daniel',
    Team: 'North Melbourne',
    G: 1,
    T: 2,
    I50: 3,
    ITC: 4,
    CM: 5,
    R50: 6,
    CP: 7,
    ED: 8,
    SI: 9,
    ...overrides,
  };
}

describe('tracked player data convergence dry-run report', () => {
  it('returns a UAT-ready report for tracked evidence and safe temp DB facts', () => {
    const report = buildPlayerDataConvergenceTrackedDryRunReport({
      players: [player()],
      rawStatRows: [rawRow()],
      statlyVerifyDb: tempDb,
      databaseUrl: `file://${tempDb}`,
      repositoryRoot: '/Users/robert/Developer/Statly',
      tempDatabaseFileExists: true,
    });

    expect(report).toMatchObject({
      mode: 'player-data-convergence-temp-db-dry-run-uat',
      status: 'readyForUat',
      diagnostic: {
        totalCanonicalPlayers: 1,
        totalSourceStatRecords: 1,
        matchedRecordsByNormalizedNameTeam: 1,
        severity: 'ok',
      },
      planner: {
        status: 'allClear',
        safeForNextReadOnlyDryRun: true,
        safeForWritePlanning: false,
        requiresProductDecision: false,
      },
      dryRunSummary: {
        status: 'readyForTempDbDryRun',
        safeForTempDbDryRun: true,
        safeForWritePlanning: false,
        safeForWriteApply: false,
        proposedRepairCount: 0,
      },
      dryRunPlan: {
        status: 'readyForTempDbDryRun',
        safeForTempDbDryRun: true,
        safeForWritePlanning: false,
        safeForWriteApply: false,
        evidence: {
          matchedRecordsByNormalizedNameTeam: 1,
          proposedRepairCount: 0,
        },
      },
      runtimeChecks: {
        tempDatabaseFileExists: true,
        blockers: [],
      },
    });
  });

  it('blocks UAT when the temp DB file has not been pre-created', () => {
    const report = buildPlayerDataConvergenceTrackedDryRunReport({
      players: [player()],
      rawStatRows: [rawRow()],
      statlyVerifyDb: tempDb,
      databaseUrl: `file://${tempDb}`,
      repositoryRoot: '/Users/robert/Developer/Statly',
      tempDatabaseFileExists: false,
    });

    expect(report.status).toBe('blocked');
    expect(report.runtimeChecks.blockers).toContainEqual(
      expect.objectContaining({ kind: 'tempDatabaseFileMissing' })
    );
  });

  it('keeps all-null tracked stat rows as skipped evidence, not repairs', () => {
    const report = buildPlayerDataConvergenceTrackedDryRunReport({
      players: [
        player({ id: 'tobie-travaglia-st-kilda', name: 'Tobie Travaglia', team: 'St Kilda' }),
      ],
      rawStatRows: [
        rawRow({
          Player: 'Tobie Travaglia',
          Team: 'St Kilda',
          G: null,
          T: null,
          I50: null,
          ITC: null,
          CM: null,
          R50: null,
          CP: null,
          ED: null,
          SI: null,
        }),
      ],
      statlyVerifyDb: tempDb,
      databaseUrl: `file://${tempDb}`,
      repositoryRoot: '/Users/robert/Developer/Statly',
      tempDatabaseFileExists: true,
    });

    expect(report.status).toBe('readyForUat');
    expect(report.skippedSourceEvidence).toMatchObject({
      kind: 'skippedNullStatSourceEvidence',
      count: 1,
      sourceIdentities: ['tobie travaglia|st kilda'],
    });
    expect(report.trackedDataWarnings).toMatchObject({
      allNullStatRowsAreSkippedSourceEvidence: 1,
      proposedRepairCount: 0,
      safeForWritePlanning: false,
      safeForWriteApply: false,
    });
  });

  it('blocks UAT when DATABASE_URL points at protected prisma/dev.db', () => {
    const report = buildPlayerDataConvergenceTrackedDryRunReport({
      players: [player()],
      rawStatRows: [rawRow()],
      statlyVerifyDb: tempDb,
      databaseUrl: 'file:///Users/robert/Developer/Statly/prisma/dev.db',
      repositoryRoot: '/Users/robert/Developer/Statly',
      tempDatabaseFileExists: true,
    });

    expect(report.status).toBe('blocked');
    expect(report.dryRunPlan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'protectedDevDatabasePath' }),
        expect.objectContaining({ kind: 'databaseUrlMustNotPointInsideRepository' }),
      ])
    );
  });
});
