import { describe, expect, it } from 'vitest';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { aflTradeCanonicalTargetRecordSchema } from '@/server/aflTradeIntelligence/source/providerResolutionContracts';

describe('reviewed canonical target registration', () => {
  it('preserves unknown canonical metadata rather than inventing values', () => {
    expect(
      aflTradeCanonicalTargetRecordSchema.parse({
        entityKind: 'player',
        canonicalId: 'player:one',
        displayName: 'Source Player',
        birthDate: null,
      })
    ).toMatchObject({ birthDate: null });
    expect(
      aflTradeCanonicalTargetRecordSchema.parse({
        entityKind: 'club',
        canonicalId: 'club:one',
        currentName: 'Source Club',
        abbreviation: null,
        activeFromYear: null,
        activeThroughYear: null,
      })
    ).toMatchObject({ abbreviation: null, activeFromYear: null, activeThroughYear: null });
  });
  it('accepts an explicit calendar-date encoding without asserting kickoff', () => {
    const match = {
      entityKind: 'match',
      canonicalId: 'match:one',
      competition: 'AFLM',
      seasonYear: 2025,
      roundLabel: 'Round 1',
      sourceDateText: '2025-03-10',
      dateInterpretation: 'source_calendar_date_as_utc_midnight',
      matchDate: '2025-03-10T00:00:00.000Z',
      homeClubId: 'club:home',
      awayClubId: 'club:away',
    };
    expect(aflTradeCanonicalTargetRecordSchema.parse(match)).toEqual(match);
    expect(
      aflTradeCanonicalTargetRecordSchema.safeParse({
        ...match,
        dateInterpretation: 'source_instant',
      }).success
    ).toBe(false);
    expect(
      aflTradeCanonicalTargetRecordSchema.safeParse({
        ...match,
        matchDate: '2025-03-10T19:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradeCanonicalTargetRecordSchema.safeParse({ ...match, dateInterpretation: undefined })
        .success
    ).toBe(false);
  });
  it('refuses a missing retained creation decision without writing canonical records', async () => {
    const statements: string[] = [];
    const sql: AflOutcomeSqlClient = {
      async query(statement) {
        statements.push(statement);
        return { rows: [], rowCount: 0 };
      },
      async transaction(work) {
        return work(sql);
      },
    };
    const repository = new PostgresAflTradeProviderResolutionRepository(sql);
    await expect(
      repository.registerCanonicalTarget(
        {
          registrationDecisionId: `canonical-target-registration:${'a'.repeat(64)}`,
          targetSnapshotReferenceId: `canonical-target-snapshot:${'b'.repeat(64)}`,
        },
        { principalRef: 'actual-reviewer', environment: 'non_production' }
      )
    ).rejects.toMatchObject({
      code: 'EVIDENCE_MISSING',
    });
    expect(statements.some((statement) => /\b(INSERT|UPDATE|DELETE)\b/u.test(statement))).toBe(
      false
    );
  });
});
