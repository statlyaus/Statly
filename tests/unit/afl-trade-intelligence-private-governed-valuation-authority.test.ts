import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { resolvePrivateGovernedValuationAuthority } from '@/server/aflTradeIntelligence/valuation/privateGovernedValuationAuthority';

const evaluatedAt = '2026-08-18T01:00:00.000Z';
const immutable = (character: string) => `artifact:${character.repeat(64)}`;
const addressed = (prefix: string, character: string) => `${prefix}:${character.repeat(64)}`;
const artifact = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, evaluatedAt);

type AffectedArtifact = {
  kind: 'model_protocol' | 'model_run' | 'valuation_bundle';
  artifactId: string;
};

function proposal(decisionKey: string, affectedArtifacts: AffectedArtifact[]) {
  const content = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_3_model_validity' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope: {
      scopeKey: 'afl-men:2021-trades',
      description: 'Private local non-production AFL trade valuation authority.',
      dimensions: [{ name: 'lane', values: ['private_local'] }],
      exclusions: ['Production and publication'],
    },
    proposal: 'Approve one exact retained non-production valuation artifact set.',
    alternativesConsidered: ['Keep the exact artifact set unavailable.'],
    accountableOwner: 'afl-trade-model-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [immutable('a')],
    affectedArtifacts,
    proposedAt: '2026-08-17T00:00:00.000Z',
    proposedBy: 'afl-trade-model-owner',
    proposalOrigin: 'human_authored' as const,
  };
  return aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', content),
    content,
  });
}

function approve(source: AflTradeGateDecisionProposal) {
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: source.proposalId,
    gate: source.content.gate,
    decisionKey: source.content.decisionKey,
    version: source.content.version,
    environment: source.content.environment,
    scope: source.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: source.content.accountableOwner,
    decidedBy: 'afl-trade-model-owner',
    reviewers: [],
    authorityEvidenceIds: [immutable('b')],
    conditionResults: [],
    rationale: 'The exact non-production artifact set is approved for private local evaluation.',
    limitations: ['No production or publication authority.'],
    decidedAt: '2026-08-17T01:00:00.000Z',
    effectiveAt: '2026-08-17T01:00:00.000Z',
    revalidateAt: '2027-08-17T01:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: source.content.affectedArtifacts,
    withdrawalActions: [],
  };
  return aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
}

function fixture() {
  const player = {
    role: 'player_contribution_and_availability' as const,
    modelKind: 'player_contribution_and_availability' as const,
    protocolId: addressed('model-protocol', '1'),
    runId: addressed('model-run', '2'),
    datasetId: addressed('dataset', '3'),
    decisionKey: 'private-player-model-v1',
    runArtifact: artifact('player-run'),
  };
  const pick = {
    role: 'draft_pick_and_future_pick_distribution' as const,
    modelKind: 'draft_pick_and_future_pick_distribution' as const,
    protocolId: addressed('model-protocol', '4'),
    runId: addressed('model-run', '5'),
    datasetId: addressed('dataset', '6'),
    decisionKey: 'private-pick-model-v1',
    runArtifact: artifact('pick-run'),
  };
  const valuationBundle = {
    bundleId: addressed('valuation-bundle', '7'),
    decisionKey: 'private-valuation-bundle-v1',
    bundleArtifact: artifact('valuation-bundle'),
  };
  const playerProposal = proposal(player.decisionKey, [
    { kind: 'model_protocol', artifactId: player.protocolId },
    { kind: 'model_run', artifactId: player.runId },
  ]);
  const pickProposal = proposal(pick.decisionKey, [
    { kind: 'model_protocol', artifactId: pick.protocolId },
    { kind: 'model_run', artifactId: pick.runId },
  ]);
  const bundleProposal = proposal(valuationBundle.decisionKey, [
    { kind: 'valuation_bundle', artifactId: valuationBundle.bundleId },
  ]);
  const decisions = [approve(playerProposal), approve(pickProposal), approve(bundleProposal)];
  const ledger: AflTradeGateDecisionLedger = {
    proposals: [playerProposal, pickProposal, bundleProposal],
    decisions,
  };
  return {
    input: {
      baseAuthority: {
        kind: 'governed_private_nonproduction' as const,
        confirmedFacts: {
          resultId: addressed('private-confirmed-valuation-result', '8'),
          resultArtifact: artifact('confirmed-result'),
          valuationScopeKey: 'afl-men:2021-trades',
          transactionPromotionId: addressed('private-workbook-transaction-promotion', '9'),
          tradeId: 'trade:fixture',
          valueUnitId: 'season_pav',
          assetIds: ['asset:pick', 'asset:player'],
        },
        sourceUseAssessments: [
          {
            assessmentId: addressed('hpn-private-source-use-assessment', 'a'),
            assessmentArtifact: artifact('source-use'),
            state: 'permitted_private_calculation' as const,
            operation: 'derived_feature_creation' as const,
            valuationScopeKey: 'afl-men:2021-trades',
            modelTraining: 'blocked' as const,
            evidenceRefs: [artifact('source-use-evidence')],
          },
        ],
        privateEvaluation: {
          decisionId: addressed('private-valuation-evaluation-decision', 'b'),
          decisionArtifact: artifact('private-evaluation'),
          state: 'authorized_private_calculation' as const,
          environment: 'non_production' as const,
          modelTrainingAuthorized: false as const,
          liveCaptureAuthorized: false as const,
          publicationAuthorized: false as const,
          evidenceRefs: [artifact('private-evaluation-evidence')],
        },
        factualRelease: {
          releaseId: addressed('outcome-release', 'c'),
          releaseArtifact: artifact('factual-release'),
          state: 'active' as const,
          evidenceRefs: [artifact('factual-release-evidence')],
        },
        publicationProhibited: true as const,
      },
      components: [player, pick],
      valuationBundle,
      gateLedger: ledger,
      gateDecisionArtifacts: decisions.map((decision) => ({
        decisionId: decision.decisionId,
        artifact: createAflTradeCanonicalJsonArtifactRef(decision, evaluatedAt),
      })),
      evaluatedAt,
    },
    playerProposal,
    pickProposal,
    bundleProposal,
  };
}

describe('private governed valuation authority', () => {
  it('resolves exact current component and bundle Gate 3 authority', () => {
    const { input } = fixture();
    const result = resolvePrivateGovernedValuationAuthority(input);

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected governed authority.');
    expect(result.authority.components).toMatchObject([
      { role: 'player_contribution_and_availability', gate3State: 'approved' },
      { role: 'draft_pick_and_future_pick_distribution', gate3State: 'approved' },
    ]);
    expect(result.authority.valuationBundle).toMatchObject({
      bundleId: addressed('valuation-bundle', '7'),
      environment: 'non_production',
      gate3State: 'approved',
    });
  });

  it('reports the exact missing pick Gate 3 authority without fabricating approval', () => {
    const { input, pickProposal } = fixture();
    input.gateLedger = {
      proposals: input.gateLedger.proposals.filter(
        ({ proposalId }) => proposalId !== pickProposal.proposalId
      ),
      decisions: input.gateLedger.decisions.filter(
        ({ content }) => content.decisionKey !== pickProposal.content.decisionKey
      ),
    };

    expect(resolvePrivateGovernedValuationAuthority(input)).toMatchObject({
      state: 'unavailable',
      blockers: [
        {
          code: 'component_gate3_unavailable',
          subject: 'draft_pick_and_future_pick_distribution',
          gateBlocker: 'decision_absent',
        },
      ],
    });
  });
});
