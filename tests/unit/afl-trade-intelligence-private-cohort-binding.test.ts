import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePostseasonYearContext } from '@/server/aflTradeIntelligence/domain/postseasonYearContext';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
  AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  aflTradePrivateValuationCohortBindingSchema,
  PostgresAflTradePrivateValuationCohortBinding,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCohortBinding';

const hash = 'a'.repeat(64);
const id = (prefix: string) => `${prefix}:${hash}`;
const selection = {
  requestId: id('private-valuation-dispatch'),
  claim: { claimId: id('private-valuation-dispatch-claim'), leaseToken: hash },
  lineageAdmissionId: id('corpus-factual-lineage-admission'),
};
const retained = {
  requestId: selection.requestId,
  factualOutputId: id('private-valuation-factual-output'),
  factualOperationId: id('current-valuation-factual-refresh-operation'),
  privateFactualCandidateId: id('private-factual-candidate'),
  privateFactualRevision: 1,
  lineageAdmissionId: selection.lineageAdmissionId,
  lineageId: id('corpus-factual-lineage'),
  corpusId: id('corpus'),
  cohortCandidateId: id('factual-release-candidate'),
  cohortReleaseId: id('outcome-release'),
  cohortScopeKey: 'afl-men:2025-trades',
  sourceMemberSetSha256: hash,
  canonicalMemberSetSha256: hash,
  sourceCaptureSetSha256: hash,
  promotionSourceSetSha256: hash,
  effectiveThrough: '2026-08-01T00:00:00.000Z',
  cohortTradeIds: ['event-version:2025-trade'],
};
const pilotEventVersionId = 'external-event-version:2020-jeremy-cameron';
const reviewDecisionId = 'review-decision:2020-jeremy-cameron';
const knowledgeCutoffAt = '2026-08-01T00:00:00.000Z';
const reviewEvidence = {
  artifactId: id('artifact'),
  contentSha256: hash,
  storageUri: `artifact://sha256/${hash}`,
  mediaType: 'application/json',
  byteLength: 42,
  createdAt: '2026-07-31T00:00:00.000Z',
};
const postseasonContext = createAflTradePostseasonYearContext({
  schemaVersion: 'afl-trade-postseason-year-context/v1',
  environment: 'non_production',
  competition: 'AFLM',
  tradeId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  promotionId: id('external-canonical-promotion'),
  eventVersionId: pilotEventVersionId,
  tradeYear: 2020,
  tradeDate: null,
  period: 'established_postseason',
  reviewDecisionId,
  reviewEvidence,
  recordedAt: '2026-07-31T12:00:00.000Z',
  knowledgeCutoffAt,
  knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
});
const historicalAuthorityContent = {
  schemaVersion: 'afl-trade-private-historical-factual-authority/v1',
  authorityBoundary: 'promotion_backed_postseason_factual_only',
  requestId: selection.requestId,
  cohortScopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
  lineageAdmissionId: selection.lineageAdmissionId,
  cohortReleaseId: id('outcome-release'),
  reviewDecisionId,
  postseasonContextId: postseasonContext.contextId,
  transactionId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  eventVersionId: pilotEventVersionId,
  tradeYear: 2020,
  revision: 1,
  knowledgeCutoffAt,
} as const;
const historicalRetained = {
  schemaVersion: 'afl-trade-private-valuation-cohort-binding/v2',
  requestId: selection.requestId,
  historicalFactualAuthority: {
    authorityId: createAflTradeContentAddress(
      'private-valuation-historical-factual-authority',
      historicalAuthorityContent
    ),
    content: historicalAuthorityContent,
  },
  lineageAdmissionId: selection.lineageAdmissionId,
  lineageId: id('corpus-factual-lineage'),
  corpusId: id('corpus'),
  cohortCandidateId: id('factual-release-candidate'),
  cohortReleaseId: historicalAuthorityContent.cohortReleaseId,
  cohortScopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
  sourceMemberSetSha256: hash,
  canonicalMemberSetSha256: hash,
  sourceCaptureSetSha256: hash,
  promotionSourceSetSha256: hash,
  effectiveThrough: knowledgeCutoffAt,
  cohortTransactionId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  tradeYear: 2020,
  cohortTradeIds: [pilotEventVersionId],
  postseasonYearContexts: [postseasonContext],
} as const;

function clientFor(binding: unknown): AflOutcomeSqlClient {
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string) {
      if (sql.startsWith('SET LOCAL ROLE') || sql.includes('dispatch_request_for_claim')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ binding_json: binding }] as Row[], rowCount: 1 };
    },
    async transaction(work) {
      return work(client);
    },
  };
  return client;
}

describe('private target-cohort binding adapter', () => {
  it('returns the exact authenticated independent cohort selection', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(clientFor(retained));
    await expect(binding.bind(selection)).resolves.toEqual(retained);
    await expect(binding.load(selection)).resolves.toEqual(retained);
    expect(aflTradePrivateValuationCohortBindingSchema.parse(retained)).not.toHaveProperty(
      'schemaVersion'
    );
  });
  it('rejects substitution of the selected lineage admission', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(
      clientFor({
        ...retained,
        lineageAdmissionId: `corpus-factual-lineage-admission:${'b'.repeat(64)}`,
      })
    );
    await expect(binding.bind(selection)).rejects.toThrow('another selected lineage admission');
  });
  it('reports an absent binding without treating it as cohort authority', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(clientFor(null));
    await expect(binding.load(selection)).resolves.toBeNull();
    await expect(binding.bind(selection)).rejects.toThrow('Cohort selection was not retained');
  });

  it('authenticates the exact historical pilot without relabeling legacy factual authority', async () => {
    const loader = async () => ({
      context: postseasonContext,
      acquisitionSpell: {} as never,
      release: {} as never,
      review: {} as never,
    });
    const binding = new PostgresAflTradePrivateValuationCohortBinding(
      clientFor(historicalRetained),
      { read: async () => Buffer.from('unused') },
      loader
    );
    const historicalSelection = {
      ...selection,
      reviewDecisionId,
      knowledgeCutoffAt,
    };
    await expect(binding.bindHistoricalPilot(historicalSelection)).resolves.toEqual(
      historicalRetained
    );
    await expect(binding.loadHistoricalPilot(historicalSelection)).resolves.toEqual(
      historicalRetained
    );
    expect(historicalRetained).not.toHaveProperty('factualOutputId');
    expect(historicalRetained).not.toHaveProperty('privateFactualCandidateId');
  });

  it('rejects substituted or internally inconsistent historical pilot authority', async () => {
    expect(() =>
      aflTradePrivateValuationCohortBindingSchema.parse({
        ...historicalRetained,
        cohortTradeIds: [AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID],
      })
    ).toThrow(/differ/);
    expect(() =>
      aflTradePrivateValuationCohortBindingSchema.parse({
        ...historicalRetained,
        historicalFactualAuthority: {
          ...historicalRetained.historicalFactualAuthority,
          content: {
            ...historicalAuthorityContent,
            revision: 2,
          },
        },
      })
    ).toThrow();
  });
});
