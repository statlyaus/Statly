import { describe, expect, it, vi } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';

const digest = (character: string) => character.repeat(64);

function sourceBatch() {
  const capture = {
    captureId: `source-capture:${digest('a')}`,
    artifactId: `artifact:${digest('b')}`,
    contentSha256: digest('b'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/years/2025',
    capturedAt: '2026-08-10T00:02:00.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'draftguru-year/v1',
    fieldManifestSha256: digest('c'),
  };
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
    provider: 'draftguru',
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'selection:2025:national:1' },
    claim: {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 1,
      roundNumber: 1,
      player: { nativeId: null, recordedName: 'Example Player' },
      selectedByClub: { nativeId: null, recordedName: 'Example Club' },
    },
    publicationEligible: false,
  });
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: [evidence],
    finalizedAt: '2026-08-10T00:03:00.000Z',
    publicationEligible: false,
  });
}

describe('historical reconciliation preparation', () => {
  it('loads batches from the completion and persists a deterministic private review candidate', async () => {
    const batch = sourceBatch();
    const completionId = `external-historical-capture-completion:${digest('d')}`;
    const authority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId,
      completionSha256: digest('d'),
      planId: `external-historical-capture-plan:${digest('e')}`,
      planSha256: digest('e'),
      targetSetSha256: digest('f'),
      resultSetSha256: digest('1'),
      completionSourceBatchSetSha256: digest('2'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([batch.batchId]),
      completedAt: '2026-08-10T00:04:00.000Z',
    });
    const persistCandidate = vi.fn(async ({ candidate }: { candidate: unknown }) => ({
      candidateId: (candidate as { candidateId: string }).candidateId,
      status: 'finalized' as const,
      blockingIssueCount: 2,
      idempotentReplay: false,
    }));

    const result = await prepareAflTradeHistoricalReconciliation(
      { completionId },
      {
        source: {
          load: vi.fn(async () => ({
            environment: 'test_fixture' as const,
            competition: 'AFLM',
            anchorSeasonYear: 2025,
            sourceAuthority: authority,
            sourceBatches: [batch],
          })),
        },
        identityReviewRepository: { loadCurrentResolutions: vi.fn(async () => []) },
        candidateRepository: { persistCandidate },
      }
    );

    expect(result).toMatchObject({
      completionId,
      status: 'finalized',
      publicationEligible: false,
      promotionEligible: false,
    });
    const persisted = persistCandidate.mock.calls[0]![0] as {
      candidate: { content: { sourceAuthority: unknown; reconciledAt: string } };
    };
    expect(persisted.candidate.content.sourceAuthority).toEqual(authority);
    expect(persisted.candidate.content.reconciledAt).toBe(authority.completedAt);
  });

  it('fails closed when the loader returns a different completion identity', async () => {
    const batch = sourceBatch();
    const authority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${digest('d')}`,
      completionSha256: digest('d'),
      planId: `external-historical-capture-plan:${digest('e')}`,
      planSha256: digest('e'),
      targetSetSha256: digest('f'),
      resultSetSha256: digest('1'),
      completionSourceBatchSetSha256: digest('2'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([batch.batchId]),
      completedAt: '2026-08-10T00:04:00.000Z',
    });

    await expect(
      prepareAflTradeHistoricalReconciliation(
        {
          completionId: `external-historical-capture-completion:${digest('9')}`,
        },
        {
          source: {
            load: async () => ({
              environment: 'test_fixture',
              competition: 'AFLM',
              anchorSeasonYear: 2025,
              sourceAuthority: authority,
              sourceBatches: [batch],
            }),
          },
          identityReviewRepository: { loadCurrentResolutions: vi.fn(async () => []) },
          candidateRepository: { persistCandidate: vi.fn() },
        }
      )
    ).rejects.toThrow(/completion/i);
  });
});
