import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
  createAflTradeReviewedBatchSetReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';

const digest = (character: string) => character.repeat(64);
const sourceBatchIds = [
  `external-evidence-batch:${digest('a')}`,
  `external-evidence-batch:${digest('b')}`,
];

describe('external reconciliation source authority', () => {
  it('binds a finalized historical completion and its exact source-batch set', () => {
    const authority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${digest('c')}`,
      completionSha256: digest('c'),
      planId: `external-historical-capture-plan:${digest('d')}`,
      planSha256: digest('e'),
      targetSetSha256: digest('f'),
      resultSetSha256: digest('1'),
      completionSourceBatchSetSha256: digest('2'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      completedAt: '2026-08-10T01:00:00.000Z',
    });

    expect(authority.kind).toBe('historical_plan_completion');
    expect(authority.candidateSourceBatchSetSha256).toBe(
      sha256AflTradeCanonicalJson(sourceBatchIds)
    );
  });

  it('rejects a completion identity that is not bound to its digest', () => {
    expect(() =>
      createAflTradeHistoricalCompletionReconciliationAuthority({
        schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
        kind: 'historical_plan_completion',
        completionId: `external-historical-capture-completion:${digest('c')}`,
        completionSha256: digest('d'),
        planId: `external-historical-capture-plan:${digest('e')}`,
        planSha256: digest('f'),
        targetSetSha256: digest('1'),
        resultSetSha256: digest('2'),
        completionSourceBatchSetSha256: digest('3'),
        candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
        completedAt: '2026-08-10T01:00:00.000Z',
      })
    ).toThrow(/completion/i);
  });

  it('keeps the reviewed ad-hoc batch lane explicit and decision-bound', () => {
    const authority = createAflTradeReviewedBatchSetReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'reviewed_batch_set',
      reviewDecisionId: `review-decision:${digest('a')}`,
      reviewDecisionSha256: digest('a'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      decidedAt: '2026-08-10T01:00:00.000Z',
    });

    expect(authority.kind).toBe('reviewed_batch_set');
  });

  it('requires version 2 candidates to bind their exact canonical source batches', () => {
    const authority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${digest('c')}`,
      completionSha256: digest('c'),
      planId: `external-historical-capture-plan:${digest('d')}`,
      planSha256: digest('e'),
      targetSetSha256: digest('f'),
      resultSetSha256: digest('1'),
      completionSourceBatchSetSha256: digest('2'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      completedAt: '2026-08-10T01:00:00.000Z',
    });
    const content = {
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
      environment: 'test_fixture' as const,
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatchIds,
      sourceAuthority: authority,
      identityResolutionIds: [],
      transactions: [],
      transfers: [],
      draftSelections: [
        {
          selectionId: `external-draft-selection:${digest('3')}`,
          draftYear: 2025,
          draftType: 'national',
          selectionNumber: 1,
          roundNumber: 1,
          pickId: `draft-pick:${digest('4')}`,
          playerId: null,
          clubId: null,
          status: 'unresolved' as const,
          supportingProviders: ['draftguru' as const],
          evidenceIds: [`external-evidence:${digest('5')}`],
        },
      ],
      pickCustody: [],
      pickLineage: [],
      issues: [],
      reconciledAt: '2026-08-10T01:01:00.000Z',
      publicationEligible: false as const,
    };

    expect(createAflTradeExternalReconciliationCandidate(content).content.sourceAuthority).toEqual(
      authority
    );
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...content,
        sourceBatchIds: sourceBatchIds.slice(0, 1),
      })
    ).toThrow(/batch set/i);
  });
});
