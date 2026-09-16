import { afterEach, expect, it, vi } from 'vitest';
import {
  PostgresAflTradeHpnPrivateClearanceApplication,
  privateClearanceSupportSchema,
} from '@/server/aflTradeIntelligence/modeling/postgresHpnPrivateClearanceApplication';
import { PostgresAflTradeHpnStatisticalAdjudicationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalAdjudicationRepository';
import * as sources from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSourceAuthentication';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { fixture } from '../testUtils/hpnStatisticalAdjudicationFixture';

afterEach(() => vi.restoreAllMocks());
function setup(head: Record<string, unknown> | null, supersedes: string | null = null) {
  const decision = { ...fixture().result, supersedesDecisionId: supersedes };
  vi.spyOn(
    PostgresAflTradeHpnStatisticalAdjudicationRepository.prototype,
    'loadUnverified'
  ).mockResolvedValue({
    decision,
    registeredAt: decision.decidedAt,
    status: 'retained_unverified',
    calculationEligible: false,
    publicationEligible: false,
  });
  vi.spyOn(sources, 'authenticateAflTradeHpnStatisticalSources').mockResolvedValue({
    identities: [],
  } as unknown as Awaited<ReturnType<typeof sources.authenticateAflTradeHpnStatisticalSources>>);
  const statements: string[] = [];
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string) {
      statements.push(sql);
      const rows =
        sql.includes('FROM outcome_hpn_statistical_current_selection') && head ? [head] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
  };
  const client: AflOutcomeSqlClient = {
    ...transaction,
    transaction: async (callback) => callback(transaction),
  };
  return {
    owner: new PostgresAflTradeHpnPrivateClearanceApplication(client),
    decision,
    statements,
    execution: { environment: 'non_production' as const, principalRef: decision.reviewerId },
    reader: { read: async () => new Uint8Array() },
  };
}
it('supersedes the existing head through an update and increments its revision', async () => {
  const f = setup({ decision_id: 'previous', revision: 1 }, 'previous');
  expect(
    await f.owner.apply(f.decision.decisionId, 'support', f.execution, f.reader)
  ).toMatchObject({ revision: 2, idempotentReplay: false, calculationEligible: false });
  expect(
    f.statements.some((sql) => sql.startsWith('UPDATE outcome_hpn_statistical_current_selection'))
  ).toBe(true);
  expect(f.statements.some((sql) => sql.startsWith('INSERT'))).toBe(false);
});
it.each([
  { support_review_id: 'replacement', current: true },
  { support_review_id: 'support', current: false },
])('rejects replay with a changed or unavailable supporting review: %j', async (state) => {
  const f = setup({ decision_id: fixture().result.decisionId, revision: 1, ...state });
  await expect(
    f.owner.apply(f.decision.decisionId, 'support', f.execution, f.reader)
  ).rejects.toThrow('Exact replay');
});
it('permits exact current replay without updating the head', async () => {
  const f = setup({
    decision_id: fixture().result.decisionId,
    revision: 1,
    support_review_id: 'support',
    current: true,
  });
  expect(
    await f.owner.apply(f.decision.decisionId, 'support', f.execution, f.reader)
  ).toMatchObject({ revision: 1, idempotentReplay: true });
  expect(f.statements.some((sql) => sql.startsWith('UPDATE') || sql.startsWith('INSERT'))).toBe(
    false
  );
});
it('locks the selected head through source reauthentication during readback', async () => {
  const f = setup({ support_review_id: 'support', revision: 1 });
  expect(await f.owner.loadCurrent(f.decision.decisionId, f.reader)).toMatchObject({
    status: 'current_private_selection',
    calculationEligible: false,
    publicationEligible: false,
  });
  expect(
    f.statements.find((sql) => sql.includes('FROM outcome_hpn_statistical_current_selection'))
  ).toContain('FOR SHARE');
});

it.each([undefined, null, 'https://example.com/afl/matches/1474#player-stats'])(
  'rejects absent or nonofficial supporting source URL: %s',
  (sourceUrl) => {
    expect(
      privateClearanceSupportSchema.safeParse({
        schemaVersion: 'afl-trade-hpn-private-clearance-support/v1',
        evidenceKind: 'transcribed_official_browser_observation',
        decisionId: `hpn-statistical-decision:${'a'.repeat(64)}`,
        authorityEvidenceId: `reviewer-authority-evidence:${'b'.repeat(64)}`,
        reviewerId: 'reviewer',
        reviewedAt: '2026-09-16T00:00:00.000Z',
        artifactBytesBase64: 'e30=',
        sourceUrl,
        rowIndex: 0,
        columnIndex: 0,
        publicationEligible: false,
        independentCollectionEstablished: false,
      }).success
    ).toBe(false);
  }
);
