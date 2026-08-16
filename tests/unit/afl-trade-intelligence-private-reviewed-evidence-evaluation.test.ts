import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

const digest = (character: string) => character.repeat(64);
const createdAt = '2026-08-16T02:00:00.000Z';

function fixture() {
  const reviewSets = [
    {
      reviewSetId: digest('1'),
      reviewSetDecisionId: `local-review:set:${digest('1')}`,
      reviewerId: 'local-five-season-evidence-reviewer',
      candidateCount: 48_769,
      decisionCount: 146_307,
      reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef({ set: 1 }, createdAt),
    },
    {
      reviewSetId: digest('2'),
      reviewSetDecisionId: `local-review:set:${digest('2')}`,
      reviewerId: 'local-workbook-evidence-reviewer',
      candidateCount: 12,
      decisionCount: 36,
      reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef({ set: 2 }, createdAt),
    },
  ];
  const sourceCaptures = [
    {
      captureId: `source-capture:${digest('3')}`,
      provider: 'afl_tables',
      capabilityId: 'afl-tables-player-stats',
      seasonYear: 2025,
      sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ source: 1 }, createdAt),
    },
    {
      captureId: `source-capture:${digest('4')}`,
      provider: 'official_afl',
      capabilityId: 'official-afl-player-stats',
      seasonYear: 2026,
      sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ source: 2 }, createdAt),
    },
  ];
  const bundle = createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [...reviewSets].reverse(),
    sourceCaptures: [...sourceCaptures].reverse(),
    sourceRightsEvidenceRefs: [
      createAflTradeCanonicalJsonArtifactRef({ rights: 2 }, createdAt),
      createAflTradeCanonicalJsonArtifactRef({ rights: 1 }, createdAt),
    ],
    createdAt,
  });
  return {
    bundle,
    decision: createAflTradePrivateReviewedEvidenceEvaluationDecision({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      evidenceBundle: bundle,
      evidenceBundleArtifact: createAflTradeCanonicalJsonArtifactRef(bundle, createdAt),
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Authorize exact reviewed evidence for private internal calculations.',
      decidedAt: createdAt,
    }),
  };
}

describe('private reviewed-evidence evaluation authority', () => {
  it('content-addresses the complete retained evidence bundle in canonical order', () => {
    const { bundle } = fixture();

    expect(bundle.evidenceBundleId).toBe(
      createAflTradeContentAddress('private-reviewed-evidence-bundle', bundle.content)
    );
    expect(bundle.content).toMatchObject({
      environment: 'non_production',
      evidenceKind: 'retained_private_review',
      candidateCount: 48_781,
      decisionCount: 146_343,
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(bundle.content.reviewSets.map(({ reviewSetId }) => reviewSetId)).toEqual([
      digest('1'),
      digest('2'),
    ]);
  });

  it('authorizes only private calculations and structurally excludes every broader use', () => {
    const { decision } = fixture();

    expect(decision.content).toMatchObject({
      evidenceKind: 'retained_private_review',
      operation: 'private_nonproduction_derived_calculation',
      permissions: {
        derivedCalculations: true,
        internalEvaluation: true,
        modelTraining: false,
        publicDisplay: false,
        redistribution: false,
        productionActivation: false,
        liveCapture: false,
      },
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(parseAflTradePrivateReviewedEvidenceEvaluationDecision(decision)).toEqual(decision);
    expect(createAflTradePrivateReviewedEvidenceEvaluationAdmission(decision)).toEqual({
      state: 'authorized',
      authority: {
        kind: 'private_nonproduction_derived_calculation',
        evidenceKind: 'retained_private_review',
        decisionId: decision.decisionId,
        valuationScopeKey: decision.content.valuationScopeKey,
        evidenceBundleId: decision.content.evidenceBundleId,
        evidenceBundleArtifact: decision.content.evidenceBundleArtifact,
        publicationEligible: false,
        publicationProhibited: true,
      },
    });
  });

  it('fails closed on withdrawal, permission tampering, and incomplete revision chains', () => {
    const { bundle, decision } = fixture();
    const withdrawn = createAflTradePrivateReviewedEvidenceEvaluationDecision({
      status: 'withdrawn',
      valuationScopeKey: decision.content.valuationScopeKey,
      evidenceBundle: bundle,
      evidenceBundleArtifact: decision.content.evidenceBundleArtifact,
      revision: 2,
      supersedesDecisionId: decision.decisionId,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Withdraw reviewed-evidence calculation authority.',
      decidedAt: '2026-08-16T03:00:00.000Z',
    });

    expect(createAflTradePrivateReviewedEvidenceEvaluationAdmission(withdrawn)).toEqual({
      state: 'blocked',
      reason: 'withdrawn',
      decisionId: withdrawn.decisionId,
    });
    expect(() =>
      parseAflTradePrivateReviewedEvidenceEvaluationDecision({
        ...decision,
        content: {
          ...decision.content,
          permissions: { ...decision.content.permissions, publicDisplay: true },
        },
      })
    ).toThrow('failed exact authentication');
    expect(() =>
      createAflTradePrivateReviewedEvidenceEvaluationDecision({
        status: 'authorized',
        valuationScopeKey: decision.content.valuationScopeKey,
        evidenceBundle: bundle,
        evidenceBundleArtifact: decision.content.evidenceBundleArtifact,
        revision: 2,
        supersedesDecisionId: null,
        reviewerId: 'local-factual-release-owner',
        rationale: 'Invalid chain.',
        decidedAt: '2026-08-16T04:00:00.000Z',
      })
    ).toThrow('revision chain');
  });
});
