import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  createDraftguruTradeCaptureCommand,
  createDraftguruTradeGateRequest,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeCaptureCommand';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { evaluateAflTradeGate0AAgainstDecision } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';

const digest = (character: string) => character.repeat(64);
const evaluatedAt = '2026-09-25T00:00:00.000Z';

function authority(capabilityId: DraftguruTradeCapability) {
  return createDraftguruTradeAuthorityProposal({
    capabilityId,
    seasons: Array.from({ length: 15 }, (_, index) => 2011 + index),
    evidenceIds: {
      productOwnerAuthorization: `artifact:${digest('1')}`,
      boundedCapturePlan: `artifact:${digest('2')}`,
      publicAccessReview: `artifact:${digest('3')}`,
      fieldBoundaryReview: `artifact:${digest('4')}`,
    },
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-09-24T00:00:00.000Z',
      proposalProposedAt: '2026-09-24T00:00:01.000Z',
    },
  });
}

/** Stands in for the owner's decision, which the builder deliberately never records itself. */
function approve({ sourceRights, proposal }: ReturnType<typeof authority>) {
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-product-owner',
    decidedBy: 'statly-product-owner',
    reviewers: [] as never[],
    authorityEvidenceIds: [`artifact:${digest('1')}`],
    conditionResults: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'Test approval.',
    })),
    rationale: 'Test approval of the exact narrow proposal.',
    limitations: [...proposal.content.scope.exclusions],
    decidedAt: '2026-09-24T01:00:00.000Z',
    effectiveAt: '2026-09-24T01:00:00.000Z',
    revalidateAt: '2027-09-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [] as string[],
  };
  return aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
}

describe('Draftguru trade capture command', () => {
  it.each(['draftguru-trade-index', 'draftguru-trade-detail'] as const)(
    'builds a %s Gate request that an approved narrow decision admits',
    (capabilityId) => {
      const trade = authority(capabilityId);
      const result = evaluateAflTradeGate0AAgainstDecision(
        approve(trade),
        trade.sourceRights,
        createDraftguruTradeGateRequest(trade, 2013, { evaluatedAt })
      );

      expect(result).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    }
  );

  it('is refused by the narrow decision if training or derived uses are requested', () => {
    const trade = authority('draftguru-trade-detail');
    const request = createDraftguruTradeGateRequest(trade, 2013, { evaluatedAt });
    const result = evaluateAflTradeGate0AAgainstDecision(approve(trade), trade.sourceRights, {
      ...request,
      operations: [...request.operations, 'model_training'],
      fieldUses: [
        ...request.fieldUses,
        { sourceField: request.fieldUses[0]!.sourceField, use: 'model_training' },
      ],
    });

    expect(result.status).toBe('blocked');
  });

  it('matches the capture request to the rights record exactly, per capability', () => {
    for (const [capabilityId, parserVersion] of [
      ['draftguru-trade-index', 'draftguru-trade-index-parser/v1'],
      ['draftguru-trade-detail', 'draftguru-trade-parser/v1'],
    ] as const) {
      const trade = authority(capabilityId);
      const { request, gateRequest } = createDraftguruTradeCaptureCommand(trade, {
        season: 2013,
        ...(capabilityId === 'draftguru-trade-index' ? { discoveryFromSeason: 2011 } : {}),
        sourceUrl: 'https://www.draftguru.com.au/trades/2013-example',
        capturedAt: evaluatedAt,
        effectiveAt: evaluatedAt,
        maximumBytes: 2 * 1024 * 1024,
      });
      const rights = trade.sourceRights.content;

      expect(request.parserVersion).toBe(parserVersion);
      expect(rights.acquisition.kind === 'provider_web' && rights.acquisition.clientVersion).toBe(
        parserVersion
      );
      expect(request).toMatchObject({
        capabilityId,
        dataset: rights.dataset,
        datasetVersion: rights.datasetVersion,
        anchorSeasonYear: gateRequest.season,
      });
    }
  });

  it('refuses seasons outside the authority and a discovery range on the detail capability', () => {
    const detail = authority('draftguru-trade-detail');

    expect(() => createDraftguruTradeGateRequest(detail, 2010, { evaluatedAt })).toThrow(
      /2011 through 2025/
    );
    expect(() =>
      createDraftguruTradeCaptureCommand(detail, {
        season: 2013,
        discoveryFromSeason: 2011,
        sourceUrl: 'https://www.draftguru.com.au/trades/2013-example',
        capturedAt: evaluatedAt,
        effectiveAt: evaluatedAt,
        maximumBytes: 1024,
      })
    ).toThrow(/only for the trade index/);
  });
});
