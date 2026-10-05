import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createPrivateEvaluationAuthoritySnapshot,
  createPrivateEvaluationInspectionReceipt,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import {
  createLocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2Input,
} from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';
import { parseAnyLocalPrivateTradeEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationContracts';
import {
  createLocalPrivateTradeEvaluationGenerationV3,
  localPrivateTradeEvaluationGenerationV3Schema,
} from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV3';
import { createPrivateEvaluationTransitionIntent } from '@/server/aflTradeIntelligence/valuation/privateEvaluationTransitionContracts';

const generatedAt = '2026-08-18T01:03:00.000Z';
const evidence = createAflTradeCanonicalJsonArtifactRef(
  { evidence: 'retained-private-governed-parent' },
  '2026-08-18T00:59:00.000Z'
);
const selector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
};
const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };

function unavailable() {
  return {
    state: 'unavailable' as const,
    reasons: ['asset_values_incomplete' as const],
    evidenceRefs: [evidence],
  };
}

function projectionV2(workbookSha256 = '8'.repeat(64)) {
  const assets: LocalPrivateTradeEvaluationGenerationV2Input['assets'] = [
    {
      assetId: 'asset-player-a',
      assetKind: 'player',
      canonicalPlayerId: 'player:a',
      sendingClubId: 'club:a',
      receivingClubId: 'club:b',
      label: 'Player A',
      evidenceHorizons: [],
      views: {
        atTrade: unavailable(),
        realized: unavailable(),
        remaining: unavailable(),
        current: unavailable(),
      },
    },
    {
      assetId: 'asset-player-b',
      assetKind: 'player',
      canonicalPlayerId: 'player:b',
      sendingClubId: 'club:b',
      receivingClubId: 'club:a',
      label: 'Player B',
      evidenceHorizons: [],
      views: {
        atTrade: unavailable(),
        realized: unavailable(),
        remaining: unavailable(),
        current: unavailable(),
      },
    },
  ];
  return createLocalPrivateTradeEvaluationGenerationV2({
    valuationScopeKey: selector.valuationScopeKey,
    tradeId: selector.tradeId,
    workbookSha256,
    dependencyRefs: [evidence],
    confirmedResultArtifact: evidence,
    valueUnitId: 'fixed_horizon_pav',
    assets,
    clubTotals: ['club:a', 'club:b'].map(clubId => ({
      clubId,
      views: {
        atTrade: unavailable(),
        realized: unavailable(),
        remaining: unavailable(),
        current: unavailable(),
      },
    })),
    overallGrades: ['club:a', 'club:b'].map(clubId => ({ clubId, ...unavailable() })),
    tradeVerdict: unavailable(),
    generatedAt,
  });
}

function reviewedParents(action: 'construct_and_activate' | 'recover' = 'construct_and_activate') {
  const authoritySnapshot = createPrivateEvaluationAuthoritySnapshot({
    selector,
    promotedWorkbookSha256: '8'.repeat(64),
    capturedAt: '2026-08-18T01:00:00.000Z',
    validThrough: '2026-08-18T01:05:00.000Z',
    expectedHead,
    dependencies: [{ role: 'confirmed_result', artifact: evidence }],
  });
  const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
    selector,
    promotedWorkbookSha256: '8'.repeat(64),
    authoritySnapshotId: authoritySnapshot.snapshotId,
    inspectedAt: '2026-08-18T01:00:00.000Z',
    validThrough: '2026-08-18T01:05:00.000Z',
    expectedHead,
    observedDependencies: authoritySnapshot.content.dependencies,
    blockers: [],
  });
  const transitionIntent = createPrivateEvaluationTransitionIntent({
    action,
    selector,
    expectedHead,
    targetGenerationId: null,
    authoritySnapshotId: authoritySnapshot.snapshotId,
    inspectionReceiptId: inspectionReceipt.receiptId,
    reason: null,
    operator: {
      principalId: 'local-operator:robert',
      rationale: 'Construct the reviewed private evaluation.',
    },
    requestedAt: '2026-08-18T01:01:00.000Z',
  });
  return { authoritySnapshot, inspectionReceipt, transitionIntent };
}

describe('local private trade evaluation generation v3', () => {
  it('seals review, intent, and replayable calculation ancestry without a receipt cycle', () => {
    const projection = projectionV2();
    const parents = reviewedParents();
    const generation = createLocalPrivateTradeEvaluationGenerationV3({
      projection,
      ...parents,
      derivation: {
        calculationInputId: `governed-private-valuation-calculation-input:${'1'.repeat(64)}`,
        calculationInputArtifact: evidence,
        valuationCalculationId: `valuation-calculation:${'2'.repeat(64)}`,
        calculationArtifact: evidence,
        directionEvidenceId: evidence.artifactId,
        directionEvidenceArtifact: evidence,
        explanationArtifact: evidence,
        projectorVersion: 'governed-private-evaluation-projector/v3',
      },
    });

    expect(generation.content.schemaVersion).toBe(
      'local-private-trade-evaluation-generation/v3'
    );
    expect(generation.content.authorityReview).toMatchObject({
      authoritySnapshotId: parents.authoritySnapshot.snapshotId,
      inspectionReceiptId: parents.inspectionReceipt.receiptId,
      transitionIntentId: parents.transitionIntent.intentId,
    });
    expect(generation.content).not.toHaveProperty('transitionReceiptId');
    expect(generation.content.dependencyRefs).toEqual(
      expect.arrayContaining([
        generation.content.authorityReview.authoritySnapshotArtifact,
        generation.content.authorityReview.inspectionReceiptArtifact,
        generation.content.authorityReview.transitionIntentArtifact,
      ])
    );
    expect(localPrivateTradeEvaluationGenerationV3Schema.parse(generation)).toEqual(generation);
    expect(parseAnyLocalPrivateTradeEvaluationGeneration(generation)).toEqual(generation);
    expect(() =>
      parseAnyLocalPrivateTradeEvaluationGeneration({
        ...generation,
        content: {
          ...generation.content,
          schemaVersion: 'local-private-trade-evaluation-generation/v4',
        },
      })
    ).toThrow(/unsupported/i);
  });

  it('rejects review ancestry that does not match the projection selector and workbook', () => {
    const parents = reviewedParents();
    const projection = projectionV2('9'.repeat(64));

    expect(() =>
      createLocalPrivateTradeEvaluationGenerationV3({
        projection,
        ...parents,
        derivation: {
          calculationInputId: `governed-private-valuation-calculation-input:${'1'.repeat(64)}`,
          calculationInputArtifact: evidence,
          valuationCalculationId: `valuation-calculation:${'2'.repeat(64)}`,
          calculationArtifact: evidence,
          directionEvidenceId: evidence.artifactId,
          directionEvidenceArtifact: evidence,
          explanationArtifact: evidence,
          projectorVersion: 'governed-private-evaluation-projector/v3',
        },
      })
    ).toThrow(/review ancestry/i);
  });

  it('rejects a missing derivation parent from the sealed dependency set', () => {
    const projection = projectionV2();
    const parents = reviewedParents();
    const generation = createLocalPrivateTradeEvaluationGenerationV3({
      projection,
      ...parents,
      derivation: {
        calculationInputId: `governed-private-valuation-calculation-input:${'1'.repeat(64)}`,
        calculationInputArtifact: evidence,
        valuationCalculationId: `valuation-calculation:${'2'.repeat(64)}`,
        calculationArtifact: evidence,
        directionEvidenceId: evidence.artifactId,
        directionEvidenceArtifact: evidence,
        explanationArtifact: evidence,
        projectorVersion: 'governed-private-evaluation-projector/v3',
      },
    });
    const tampered = structuredClone(generation);
    tampered.content.dependencyRefs = [];

    expect(() => localPrivateTradeEvaluationGenerationV3Schema.parse(tampered)).toThrow();
  });

  it('allows fresh recovery construction to bind a new reviewed transition intent', () => {
    const parents = reviewedParents('recover');
    const generation = createLocalPrivateTradeEvaluationGenerationV3({
      projection: projectionV2(),
      ...parents,
      derivation: {
        calculationInputId: `governed-private-valuation-calculation-input:${'1'.repeat(64)}`,
        calculationInputArtifact: evidence,
        valuationCalculationId: `valuation-calculation:${'2'.repeat(64)}`,
        calculationArtifact: evidence,
        directionEvidenceId: evidence.artifactId,
        directionEvidenceArtifact: evidence,
        explanationArtifact: evidence,
        projectorVersion: 'governed-private-evaluation-projector/v3',
      },
    });

    expect(generation.content.authorityReview.transitionIntentId).toBe(
      parents.transitionIntent.intentId
    );
    expect(generation.content.authorityReview.transitionIntentArtifact).toEqual(
      createAflTradeCanonicalJsonArtifactRef(
        parents.transitionIntent,
        parents.transitionIntent.content.requestedAt
      )
    );
  });
});
