import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { aflTradeExternalIdentityReviewDecisionSchema } from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';

const sha = (character: string) => character.repeat(64);

/** A later completion: the same 2025 selection plus one 2026 observation of the same player. */
function laterSource(recordedName = 'Harry Kyle') {
  const base = source();
  const capture = {
    captureId: `source-capture:${sha('a')}`,
    artifactId: `artifact:${sha('a')}`,
    contentSha256: sha('a'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/years/2026',
    capturedAt: '2026-11-21T00:00:01.000Z',
    effectiveAt: '2026-11-20T00:00:00.000Z',
    parserVersion: 'draftguru-year/v1',
    fieldManifestSha256: sha('2'),
  } as const;
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: 'afl-trade-external-evidence-batch/v1',
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'draftguru',
        capture,
        sourceRow: { ordinal: 1, sourceKey: 'selection-3' },
        claim: {
          kind: 'draft_selection',
          draftYear: 2026,
          draftType: 'national',
          selectionNumber: 3,
          roundNumber: 1,
          player: { nativeId: 'player-14', recordedName },
          selectedByClub: { nativeId: 'club-wb', recordedName: 'Western Bulldogs' },
        },
        publicationEligible: false,
      }),
    ],
    finalizedAt: '2026-11-21T00:00:02.000Z',
    publicationEligible: false,
  });
  const sourceBatches = [...base.sourceBatches, batch];
  const sourceBatchIds = sourceBatches.map(({ batchId }) => batchId).sort();
  return {
    ...base,
    anchorSeasonYear: 2026,
    sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
      ...base.sourceAuthority,
      completionId: `external-historical-capture-completion:${sha('b')}`,
      completionSha256: sha('b'),
      completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      completedAt: '2026-11-21T00:00:03.000Z',
    }),
    sourceBatches,
  };
}

function source() {
  const capture = {
    captureId: `source-capture:${sha('1')}`,
    artifactId: `artifact:${sha('1')}`,
    contentSha256: sha('1'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/years/2025',
    capturedAt: '2026-08-10T00:00:01.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'draftguru-year/v1',
    fieldManifestSha256: sha('2'),
  } as const;
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: 'afl-trade-external-evidence/v1',
    provider: 'draftguru',
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'selection-14' },
    claim: {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
      roundNumber: 1,
      player: { nativeId: 'player-14', recordedName: 'Harry Kyle' },
      selectedByClub: { nativeId: 'club-wb', recordedName: 'Western Bulldogs' },
    },
    publicationEligible: false,
  });
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: 'afl-trade-external-evidence-batch/v1',
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: [evidence],
    finalizedAt: '2026-08-10T00:00:02.000Z',
    publicationEligible: false,
  });
  const sourceBatchIds = [batch.batchId];
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${sha('3')}`,
      completionSha256: sha('3'),
      planId: `external-historical-capture-plan:${sha('4')}`,
      planSha256: sha('4'),
      targetSetSha256: sha('5'),
      resultSetSha256: sha('6'),
      completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      completedAt: '2026-08-10T00:00:03.000Z',
    }),
    sourceBatches: [batch],
  };
}

describe('external identity review service', () => {
  it('builds an exhaustive queue with explicit unresolved status', async () => {
    const loaded = source();
    const queue = await loadAflTradeExternalIdentityReviewQueue(
      { completionId: loaded.sourceAuthority.completionId },
      {
        source: { load: async () => loaded },
        reviewRepository: {
          loadCurrentDecisions: async () => [],
          loadCurrentDecision: async () => null,
          loadCanonicalTargetSnapshot: async () => {
            throw new Error('not used');
          },
          persistDecision: async () => {
            throw new Error('not used');
          },
        },
      }
    );

    expect(queue.items).toHaveLength(2);
    expect(queue.items.every(({ status }) => status === 'unresolved')).toBe(true);
    expect(queue.unresolvedCount).toBe(2);
    expect(queue.promotionEligible).toBe(false);
  });

  it('derives revision, predecessor, and canonical snapshot before persistence', async () => {
    const loaded = source();
    let persisted: unknown;
    const queue = await loadAflTradeExternalIdentityReviewQueue(
      { completionId: loaded.sourceAuthority.completionId },
      {
        source: { load: async () => loaded },
        reviewRepository: {
          loadCurrentDecisions: async () => [],
          loadCurrentDecision: async () => null,
          loadCanonicalTargetSnapshot: async ({ entityKind, canonicalId }) => ({
            entityKind,
            canonicalId,
            recordedLabel: 'Harry Kyle',
            status: 'approved' as const,
            snapshotSha256: sha256AflTradeCanonicalJson({
              entityKind,
              canonicalId,
              recordedLabel: 'Harry Kyle',
              status: 'approved',
            }),
          }),
          persistDecision: async (input) => {
            persisted = input;
            return {
              subjectId: queue.items[0]!.subjectId,
              decisionId: `review-decision:${sha('9')}`,
              revision: 1,
              status: 'approved' as const,
              idempotentReplay: false,
            };
          },
        },
      }
    );
    const player = queue.items.find(({ entityKind }) => entityKind === 'player')!;

    const result = await recordAflTradeExternalIdentityReviewDecision(
      {
        completionId: loaded.sourceAuthority.completionId,
        subjectId: player.subjectId,
        decision: 'approved',
        canonicalId: 'player:harry-kyle',
        rationale: 'Reviewed against the official player record.',
        authorityEvidenceId: `reviewer-authority-evidence:${sha('8')}`,
        decidedBy: 'reviewer:fixture',
        decidedAt: '2026-08-10T00:00:04.000Z',
      },
      {
        source: { load: async () => loaded },
        reviewRepository: {
          loadCurrentDecisions: async () => [],
          loadCurrentDecision: async () => null,
          loadCanonicalTargetSnapshot: async ({ entityKind, canonicalId }) => ({
            entityKind,
            canonicalId,
            recordedLabel: 'Harry Kyle',
            status: 'approved' as const,
            snapshotSha256: sha256AflTradeCanonicalJson({
              entityKind,
              canonicalId,
              recordedLabel: 'Harry Kyle',
              status: 'approved',
            }),
          }),
          persistDecision: async (input) => {
            persisted = input;
            const decision = aflTradeExternalIdentityReviewDecisionSchema.parse(input.decision);
            return {
              subjectId: player.subjectId,
              decisionId: decision.decisionId,
              revision: 1,
              status: 'approved' as const,
              idempotentReplay: false,
            };
          },
        },
      }
    );

    expect(result.revision).toBe(1);
    expect(persisted).toMatchObject({
      decision: {
        content: {
          revision: 1,
          supersedesDecisionId: null,
          canonicalTarget: { canonicalId: 'player:harry-kyle' },
        },
      },
    });
  });

  describe('reuse in a later completion', () => {
    /** The approved player decision recorded against the first completion. */
    async function approvedPlayerDecision() {
      const loaded = source();
      let decision: unknown;
      const repository = {
        loadCurrentDecisions: async () => [],
        loadCurrentDecision: async () => null,
        loadCanonicalTargetSnapshot: async ({
          entityKind,
          canonicalId,
        }: {
          entityKind: 'club' | 'player';
          canonicalId: string;
        }) => ({
          entityKind,
          canonicalId,
          recordedLabel: 'Harry Kyle',
          status: 'approved' as const,
          snapshotSha256: sha256AflTradeCanonicalJson({
            entityKind,
            canonicalId,
            recordedLabel: 'Harry Kyle',
            status: 'approved',
          }),
        }),
        persistDecision: async (input: { decision: unknown }) => {
          decision = input.decision;
          return {
            subjectId: '',
            decisionId: `review-decision:${sha('9')}`,
            revision: 1,
            status: 'approved' as const,
            idempotentReplay: false,
          };
        },
      };
      const queue = await loadAflTradeExternalIdentityReviewQueue(
        { completionId: loaded.sourceAuthority.completionId },
        { source: { load: async () => loaded }, reviewRepository: repository }
      );
      const player = queue.items.find(({ entityKind }) => entityKind === 'player')!;
      await recordAflTradeExternalIdentityReviewDecision(
        {
          completionId: loaded.sourceAuthority.completionId,
          subjectId: player.subjectId,
          decision: 'approved',
          canonicalId: 'player:harry-kyle',
          rationale: 'Reviewed against the official player record.',
          authorityEvidenceId: `reviewer-authority-evidence:${sha('8')}`,
          decidedBy: 'reviewer:fixture',
          decidedAt: '2026-08-10T00:00:04.000Z',
        },
        { source: { load: async () => loaded }, reviewRepository: repository }
      );
      return aflTradeExternalIdentityReviewDecisionSchema.parse(decision);
    }

    const queueFor = async (
      loaded: ReturnType<typeof laterSource>,
      current: Awaited<ReturnType<typeof approvedPlayerDecision>>
    ) =>
      loadAflTradeExternalIdentityReviewQueue(
        { completionId: loaded.sourceAuthority.completionId },
        {
          source: { load: async () => loaded },
          reviewRepository: {
            loadCurrentDecisions: async () => [current],
            loadCurrentDecision: async () => current,
            loadCanonicalTargetSnapshot: async () => {
              throw new Error('not used');
            },
            persistDecision: async () => {
              throw new Error('not used');
            },
          },
        }
      );

    it('reuses an approved decision when the later work item only adds seasons and evidence', async () => {
      const current = await approvedPlayerDecision();
      const queue = await queueFor(laterSource(), current);
      const player = queue.items.find(({ entityKind }) => entityKind === 'player')!;

      expect(player.workItemId).not.toBe(current.content.workItemId);
      expect(player).toMatchObject({
        status: 'approved',
        currentDecisionId: current.decisionId,
        canonicalTarget: { canonicalId: 'player:harry-kyle' },
        validThroughSeason: 2026,
      });
    });

    it('still asks for review when the later work item adds a new spelling', async () => {
      const current = await approvedPlayerDecision();
      const queue = await queueFor(laterSource('Harrison Kyle'), current);
      const player = queue.items.find(({ entityKind }) => entityKind === 'player')!;

      expect(player).toMatchObject({ status: 'unresolved', canonicalTarget: null });
    });
  });
});
