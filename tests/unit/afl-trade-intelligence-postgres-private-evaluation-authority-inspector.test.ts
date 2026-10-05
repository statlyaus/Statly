import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import type { AflTradeWorkbookTransactionReviewDecisionV2 } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import { createAflTradePrivateValuationEvaluationDecision } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';
import { createPostgresPrivateEvaluationAuthorityInspector } from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationAuthorityInspector';
import { PostgresAflTradePrivateValuationAuthorityV3Registry } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationAuthorityV3Registry';
import { createAflTradeValuationSourceQualificationReport } from '@/server/aflTradeIntelligence/valuation/valuationSourceQualificationReport';

const trustedAt = '2026-08-18T01:00:00.000Z';
const selector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
} as const;

const fixtureArtifactRepository: AflTradeImmutableArtifactRepository = {
  assurance: 'fixture_memory',
  artifactClass: 'derived_private',
  custodyProfile: null,
  async putIfAbsent(reference) {
    return { status: 'stored', reference };
  },
  async loadExact() {
    return null;
  },
};

function createInspector() {
  return createPostgresPrivateEvaluationAuthorityInspector({
    v3Registry: new PostgresAflTradePrivateValuationAuthorityV3Registry(
      fixtureArtifactRepository,
      1_000_000
    ),
  });
}

function authorityRoots() {
  const decidedAt = '2026-08-18T00:30:00.000Z';
  const decisionContent: AflTradeWorkbookTransactionReviewDecisionV2['content'] = {
    schemaVersion: 'afl-trade-workbook-transaction-review-decision/v2',
    reviewSetId: `workbook-transaction-review-set:${'1'.repeat(64)}`,
    reviewSubjectId: `workbook-transaction-review-subject:${'2'.repeat(64)}`,
    reviewSubjectSha256: '3'.repeat(64),
    workbookTradeId: selector.tradeId,
    occurredOn: '2025-10-15',
    occurrencePrecision: 'date',
    revision: 1,
    supersedesDecisionId: null,
    outcome: 'approved',
    parties: [
      {
        stagingRowId: `workbook-row:${'4'.repeat(64)}`,
        canonicalClubId: 'local-afl-club:st-kilda',
        assets: [
          {
            assetId: 'asset-sam-flanders',
            sourceAssetText: 'Sam Flanders',
            assetKind: 'player',
            sendingClubId: 'local-afl-club:gold-coast',
            receivingClubId: 'local-afl-club:st-kilda',
            canonicalPlayerId: 'local-afl-player:sam-flanders',
            selection: null,
          },
        ],
      },
      {
        stagingRowId: `workbook-row:${'5'.repeat(64)}`,
        canonicalClubId: 'local-afl-club:gold-coast',
        assets: [
          {
            assetId: 'asset-future-first-round-pick',
            sourceAssetText: 'Future first-round pick',
            assetKind: 'future_pick',
            sendingClubId: 'local-afl-club:st-kilda',
            receivingClubId: 'local-afl-club:gold-coast',
            canonicalPlayerId: null,
            selection: {
              seasonYear: 2026,
              round: 1,
              number: null,
              originalClubId: 'local-afl-club:st-kilda',
            },
          },
        ],
      },
    ],
    reviewerId: 'local-reviewer:robert',
    rationale: 'Confirmed from the pinned private workbook transaction.',
    decidedAt,
    authority: 'private_workbook_canonical_transaction_review',
    publicationEligible: false,
    publicationProhibited: true,
  };
  const decision: AflTradeWorkbookTransactionReviewDecisionV2 = {
    decisionId: createAflTradeContentAddress(
      'workbook-transaction-review-decision',
      decisionContent
    ),
    content: decisionContent,
  };
  const eventId = createAflTradeContentAddress('event', { tradeId: selector.tradeId });
  const eventVersionId = createAflTradeContentAddress('event-version', { eventId, version: 1 });
  const canonicalTransaction = {
    eventId,
    eventVersionId,
    assets: decision.content.parties.flatMap((party) =>
      party.assets.map((asset) => ({
        assetId: asset.assetId,
        assetVersionId: createAflTradeContentAddress('event-asset-version', {
          eventVersionId,
          assetId: asset.assetId,
        }),
        acquisitionSpell: null,
      }))
    ),
  };
  const receipt = {
    schemaVersion: 'afl-trade-private-workbook-transaction-promotion/v2',
    workbookTradeId: selector.tradeId,
    reviewSetId: decision.content.reviewSetId,
    decisionId: decision.decisionId,
    decisionSha256: sha256AflTradeCanonicalJson(decision),
    canonicalTransaction,
    status: 'active' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  const promotionId = createAflTradeContentAddress(
    'private-workbook-transaction-promotion',
    receipt
  );
  const sourcePromotionId = `external-canonical-promotion:${'6'.repeat(64)}`;
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'non_production',
    competition: 'AFLM',
    createdAt: '2026-08-18T00:10:00.000Z',
    knowledgeCutoffAt: '2026-08-18T00:05:00.000Z',
    promotions: [
      {
        promotionId: sourcePromotionId,
        promotionSha256: '6'.repeat(64),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-18T00:00:00.000Z',
        promotionRecordCount: 1,
      },
    ],
    members: [
      {
        promotionId: sourcePromotionId,
        recordKind: 'transaction',
        sourceRecordId: selector.tradeId,
        canonicalRecordId: eventVersionId,
        recordSha256: '7'.repeat(64),
      },
    ],
  });
  const factual = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'private-afl-draft-trade-outcomes:AFLM:2025',
    createdAt: '2026-08-18T00:15:00.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:fixture-trade-1',
        sourceSnapshotId: `source-snapshot:${'8'.repeat(64)}`,
        rightsArtifactId: `source-rights:${'9'.repeat(64)}`,
        gateDecisionId: `gate-decision:${'a'.repeat(64)}`,
        recordSha256: 'b'.repeat(64),
        recordedAt: '2026-08-18T00:04:00.000Z',
      },
    ],
    promotionSources: [{ promotionId: sourcePromotionId, captureIds: ['capture:fixture-trade-1'] }],
    canonicalMembers: [
      {
        recordKind: 'transaction',
        canonicalRecordId: eventVersionId,
        canonicalRecordSha256: 'c'.repeat(64),
      },
    ],
  });
  const releaseArtifact = createAflTradeCanonicalJsonArtifactRef(
    factual.release,
    factual.release.content.createdAt
  );
  const membershipArtifact = createAflTradeCanonicalJsonArtifactRef(
    factual.release.content.canonicalMembers,
    factual.release.content.createdAt
  );
  const sourceRightsEvidenceRefs = [
    createAflTradeCanonicalJsonArtifactRef(
      { sourceRightsId: factual.release.content.sourceCaptures[0]!.rightsArtifactId },
      '2026-08-18T00:04:00.000Z'
    ),
  ];
  const qualification = createAflTradeValuationSourceQualificationReport({
    schemaVersion: 'afl-trade-valuation-source-qualification-report/v1',
    environment: 'non_production',
    operation: 'valuation_model_training_and_derived_feature_creation',
    valuationScopeKey: selector.valuationScopeKey,
    factualReleaseScopeKey: factual.release.content.scopeKey,
    factualReleaseId: factual.release.releaseId,
    factualReleaseArtifact: releaseArtifact,
    releaseMembershipArtifact: membershipArtifact,
    releaseTradeIds: [eventVersionId],
    sourceRightsEvidenceRefs,
    decision: { state: 'eligible_for_dataset_admission' },
    evaluatedAt: '2026-08-18T00:20:00.000Z',
    publicationEligible: false,
    limitation:
      'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.',
  });
  const privateDecision = createAflTradePrivateValuationEvaluationDecision({
    status: 'authorized',
    valuationScopeKey: selector.valuationScopeKey,
    factualReleaseScopeKey: factual.release.content.scopeKey,
    factualReleaseId: factual.release.releaseId,
    factualReleaseArtifact: releaseArtifact,
    releaseMembershipArtifact: membershipArtifact,
    sourceRightsEvidenceRefs,
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-authority-reviewer',
    rationale: 'Authorize exact retained evidence for private local calculation.',
    decidedAt: '2026-08-18T00:25:00.000Z',
  });
  return { decision, receipt, promotionId, factual, qualification, privateDecision };
}

function transactionFor(roots: ReturnType<typeof authorityRoots>, privateDecision: unknown) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('outcome_private_workbook_transaction_promotion')) {
        return {
          rows: [
            {
              promotion_id: roots.promotionId,
              review_set_id: roots.decision.content.reviewSetId,
              decision_id: roots.decision.decisionId,
              decision_json: roots.decision,
              receipt_json: roots.receipt,
              source_artifact_sha256: 'd'.repeat(64),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_valuation_source_qualification_report')) {
        return {
          rows: [
            {
              factual_release_id: roots.factual.release.releaseId,
              factual_release_scope_key: roots.factual.release.content.scopeKey,
              release_created_at: roots.factual.release.content.createdAt,
              release_manifest_json: roots.factual.release,
              qualification_report_json: roots.qualification,
              private_decision_json: privateDecision,
              private_decision_status: 'authorized',
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes('outcome_private_valuation_authority_bundle_v3')
      ) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } satisfies AflOutcomeSqlTransaction;
}

describe('PostgreSQL private evaluation authority inspector', () => {
  it('derives an absent head and confirmed-result blocker when no promotion exists', async () => {
    const transaction = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('outcome_local_private_trade_evaluation_head')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('outcome_private_workbook_transaction_promotion')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } satisfies AflOutcomeSqlTransaction;
    const inspect = createInspector();

    const result = await inspect(
      transaction,
      selector,
      trustedAt
    );

    expect(result).toEqual({
      promotedWorkbookSha256: null,
      expectedHead: { generationId: null, revision: 0, status: 'absent' },
      validThrough: null,
      evidence: [],
      blockers: [
        {
          code: 'confirmed_result_not_promoted',
          authorityClass: 'confirmed_result',
          classification: 'internal_evidence',
          assetId: null,
          message: 'No active confirmed transaction promotion exists for this trade.',
          evidenceRefs: [],
        },
      ],
    });
  });

  it('authenticates exact promoted release, source-use, and private-evaluation roots', async () => {
    const roots = authorityRoots();
    const inspect = createInspector();

    const result = await inspect(
      transactionFor(roots, roots.privateDecision),
      selector,
      trustedAt
    );

    expect(result.promotedWorkbookSha256).toBe('d'.repeat(64));
    expect(result.evidence.map(({ role }) => role)).toEqual([
      'transaction_promotion',
      'confirmed_result',
      'factual_release',
      'source_use',
      'private_evaluation',
    ]);
    expect(result.blockers.map(({ code }) => code)).toEqual([
      'evaluation_evidence_bundle_unavailable',
      'evaluation_evidence_gate3_not_approved',
      'player_model_run_not_authorized',
      'pick_model_run_not_authorized',
      'player_gate3_not_approved',
      'pick_gate3_not_approved',
      'valuation_bundle_not_authorized',
    ]);
  });

  it('rejects a tampered retained private-evaluation decision', async () => {
    const roots = authorityRoots();
    const tampered = structuredClone(roots.privateDecision);
    tampered.content.rationale = 'Changed after review.';
    const inspect = createInspector();

    await expect(inspect(transactionFor(roots, tampered), selector, trustedAt)).rejects.toThrow(
      'Private valuation evaluation decision failed exact authentication.'
    );
  });
});
