import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PRIVATE_VALUATION_EVALUATION_DECISION_SCHEMA_VERSION,
  createAflTradePrivateValuationEvaluationDecision,
  parseAflTradePrivateValuationEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-16T01:00:00.000Z',
  };
}

function decisionInput() {
  return {
    status: 'authorized' as const,
    valuationScopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    sourceRightsEvidenceRefs: [artifact('5'), artifact('4')],
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-factual-release-owner',
    rationale:
      'Authorize exact retained evidence for private local non-production derived calculations.',
    decidedAt: '2026-08-16T02:00:00.000Z',
  };
}

describe('private AFL trade valuation evaluation decision', () => {
  it('authorizes only private local non-production derived calculations', () => {
    const decision = createAflTradePrivateValuationEvaluationDecision(decisionInput());

    expect(decision.decisionId).toBe(
      createAflTradeContentAddress('private-valuation-evaluation-decision', decision.content)
    );
    expect(decision.content).toMatchObject({
      schemaVersion: AFL_TRADE_PRIVATE_VALUATION_EVALUATION_DECISION_SCHEMA_VERSION,
      environment: 'non_production',
      operation: 'private_nonproduction_derived_calculation',
      status: 'authorized',
      sourceRightsEffect: 'supplemental_evaluation_authority_does_not_amend_source_rights',
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
    expect(decision.content.sourceRightsEvidenceRefs.map(({ artifactId }) => artifactId)).toEqual(
      [...decision.content.sourceRightsEvidenceRefs].map(({ artifactId }) => artifactId).sort()
    );
    expect(parseAflTradePrivateValuationEvaluationDecision(decision)).toEqual(decision);
  });

  it('creates an explicit append-only withdrawal that retains exact ancestry', () => {
    const authorized = createAflTradePrivateValuationEvaluationDecision(decisionInput());
    const withdrawn = createAflTradePrivateValuationEvaluationDecision({
      ...decisionInput(),
      status: 'withdrawn',
      revision: 2,
      supersedesDecisionId: authorized.decisionId,
      rationale: 'Withdraw private calculation authority and fail closed.',
      decidedAt: '2026-08-16T03:00:00.000Z',
    });

    expect(withdrawn.content.status).toBe('withdrawn');
    expect(withdrawn.content.supersedesDecisionId).toBe(authorized.decisionId);
    expect(withdrawn.content.factualReleaseId).toBe(authorized.content.factualReleaseId);
    expect(withdrawn.content.sourceRightsEvidenceRefs).toEqual(
      authorized.content.sourceRightsEvidenceRefs
    );
  });

  it('rejects tampering that grants training, display, redistribution, production, or capture', () => {
    const decision = createAflTradePrivateValuationEvaluationDecision(decisionInput());

    for (const permission of [
      'modelTraining',
      'publicDisplay',
      'redistribution',
      'productionActivation',
      'liveCapture',
    ] as const) {
      expect(() =>
        parseAflTradePrivateValuationEvaluationDecision({
          ...decision,
          content: {
            ...decision.content,
            permissions: { ...decision.content.permissions, [permission]: true },
          },
        })
      ).toThrow('failed exact authentication');
    }
  });

  it('rejects duplicate source evidence and malformed revision chains', () => {
    expect(() =>
      createAflTradePrivateValuationEvaluationDecision({
        ...decisionInput(),
        sourceRightsEvidenceRefs: [artifact('4'), artifact('4')],
      })
    ).toThrow('unique');
    expect(() =>
      createAflTradePrivateValuationEvaluationDecision({
        ...decisionInput(),
        revision: 2,
        supersedesDecisionId: null,
      })
    ).toThrow('revision chain');
  });
});
