import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeValuationInputBundleCandidate } from '@/server/aflTradeIntelligence/valuation/valuationInputBundleCandidate';

const digest = (character: string) => character.repeat(64);
const artifact = (character: string, createdAt = '2026-08-15T01:00:00.000Z') => ({
  artifactId: `artifact:${digest(character)}`,
  contentSha256: digest(character),
  storageUri: `artifact://sha256/${digest(character)}`,
  mediaType: 'application/json',
  byteLength: 128,
  createdAt,
});

function componentRun(input: {
  readonly role:
    | 'player_contribution_and_availability'
    | 'draft_pick_and_future_pick_distribution';
  readonly character: string;
}) {
  const isPlayer = input.role === 'player_contribution_and_availability';
  const content = {
    schemaVersion: 'governed-valuation-component-run/v2' as const,
    environment: 'non_production' as const,
    role: input.role,
    nativeExecution: {
      kind: isPlayer ? ('admitted_player_model_run' as const) : ('pick_pav_model_execution' as const),
      executionId: isPlayer
        ? `model-run:${digest(input.character)}`
        : `pick-pav-model-execution:${digest(input.character)}`,
      artifact: artifact(input.character),
    },
    protocolId: `model-protocol:${digest(isPlayer ? '1' : '5')}`,
    protocolArtifact: artifact(isPlayer ? '2' : '6'),
    datasetId: `dataset:${digest(isPlayer ? '3' : '7')}`,
    datasetArtifact: artifact(isPlayer ? '4' : '8'),
    datasetAdmissionId: `dataset-admission:${digest(isPlayer ? '5' : '9')}`,
    datasetAdmissionArtifact: artifact(isPlayer ? '6' : 'a'),
    datasetAdmissionGateLedgerRevision: 1,
    registeredAt: '2026-08-15T01:30:00.000Z',
    qualificationState: 'automated_qualification_pending' as const,
    publicationEligible: false as const,
    limitation:
      'Authenticated non-production component-run candidate pending automated model-pair qualification; grades, production use, and publication remain prohibited.' as const,
  };
  return { runId: createAflTradeContentAddress('model-run', content), content };
}

function qualifiedEvidence(playerRunId: string, pickRunId: string) {
  const privateFactualAuthority = {
    valuationScopeKey: 'afl-men:2025-trades',
    candidateId: `private-factual-candidate:${digest('b')}`,
    evidenceScopeKey: 'afl-men:2025-evidence',
    evidenceBundleId: `private-reviewed-evidence-bundle:${digest('c')}`,
    reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${digest('d')}`,
    normalizedReconciledCustodySha256: digest('e'),
    revision: 2,
  };
  const operationPreimage = {
    scopeKey: 'afl-men:2025-trades',
    factualOperationId: `current-valuation-factual-refresh-operation:${digest('f')}`,
    privateFactualAuthority,
  };
  return {
    schemaVersion: 'afl-current-valuation-model-evidence-result/v1' as const,
    operationId: createAflTradeContentAddress(
      'current-valuation-model-evidence-operation',
      operationPreimage
    ),
    ...operationPreimage,
    expectedModelRevision: 4,
    modelRevision: 5,
    capturedAt: '2026-08-15T01:40:00.000Z',
    completedAt: '2026-08-15T01:45:00.000Z',
    executionLocation: 'local' as const,
    visibility: 'private' as const,
    environment: 'non_production' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Private local non-production model evidence only; no prepared-input, valuation, production, activation, or publication authority is granted.' as const,
    playerObservationSetId: `player-observation-set:${digest('1')}`,
    pickBenchmarkEvidenceId: `pick-pav-observation-set:${digest('2')}`,
    playerRunId,
    pickRunId,
    qualificationId: `model-qualification:${digest('3')}`,
    state: 'qualified' as const,
    qualificationWorkId: `model-qualification-work:${digest('4')}`,
    playerGate3DecisionId: `gate-decision:${digest('5')}`,
    pickGate3DecisionId: `gate-decision:${digest('6')}`,
  };
}

function input() {
  const playerRun = componentRun({ role: 'player_contribution_and_availability', character: '7' });
  const pickRun = componentRun({
    role: 'draft_pick_and_future_pick_distribution',
    character: '0',
  });
  return {
    modelEvidence: qualifiedEvidence(playerRun.runId, pickRun.runId),
    playerRun,
    pickRun,
    valueUnitId: 'fixed-horizon-pav-v1',
    createdAt: '2026-08-15T02:00:00.000Z',
    currentView: {
      effectiveAt: '2026-08-15T01:45:00.000Z',
      knowledgeCutoffAt: '2026-08-15T01:45:00.000Z',
      valuationAsOf: '2026-08-15T01:50:00.000Z',
    },
    policies: {
      listSpot: artifact('9'),
      scarcity: artifact('a'),
      roleCongestion: artifact('b'),
      lowReturn: artifact('c'),
      eliteOutcome: artifact('d'),
      practicalEquivalence: artifact('e'),
      explanation: artifact('f'),
    },
    simulation: { draws: 10_000, seed: 'genuine-2025-valuation' },
  };
}

describe('AFL trade valuation-input bundle candidate', () => {
  it('binds the exact qualified component ancestry into a retained bundle', () => {
    const bundle = createAflTradeValuationInputBundleCandidate(input());

    expect(bundle.content.scopeKey).toBe('afl-men:2025-trades');
    expect(bundle.content.components).toEqual([
      {
        role: 'player_contribution_and_availability',
        modelKind: 'player_contribution_and_availability',
        protocolId: input().playerRun.content.protocolId,
        runId: input().playerRun.runId,
        datasetId: input().playerRun.content.datasetId,
        gate3DecisionId: input().modelEvidence.playerGate3DecisionId,
      },
      {
        role: 'draft_pick_and_future_pick_distribution',
        modelKind: 'draft_pick_and_future_pick_distribution',
        protocolId: input().pickRun.content.protocolId,
        runId: input().pickRun.runId,
        datasetId: input().pickRun.content.datasetId,
        gate3DecisionId: input().modelEvidence.pickGate3DecisionId,
      },
    ]);
    expect(bundle.valuationInputBundleId).toBe(
      createAflTradeContentAddress('valuation-input-bundle', bundle.content)
    );
    expect(createAflTradeCanonicalJsonArtifactRef(bundle, bundle.content.createdAt).artifactId).toMatch(
      /^artifact:[a-f0-9]{64}$/
    );
  });

  it('replays the same authenticated input as the same immutable bundle', () => {
    const exactInput = input();

    expect(createAflTradeValuationInputBundleCandidate(exactInput)).toEqual(
      createAflTradeValuationInputBundleCandidate(exactInput)
    );
  });

  it('rejects a component run that is not the qualified run', () => {
    const mismatched = input();

    expect(() =>
      createAflTradeValuationInputBundleCandidate({
        ...mismatched,
        modelEvidence: {
          ...mismatched.modelEvidence,
          pickRunId: `model-run:${digest('f')}`,
        },
      })
    ).toThrow('Pick component run does not match qualified current model evidence.');
  });

  it('rejects construction before the qualified evidence completed', () => {
    const premature = input();

    expect(() =>
      createAflTradeValuationInputBundleCandidate({
        ...premature,
        createdAt: '2026-08-15T01:44:59.000Z',
      })
    ).toThrow('Valuation input bundle cannot predate qualified model evidence.');
  });

  it('rejects policy evidence created after bundle construction', () => {
    const latePolicy = input();

    expect(() =>
      createAflTradeValuationInputBundleCandidate({
        ...latePolicy,
        policies: {
          ...latePolicy.policies,
          explanation: artifact('f', '2026-08-15T02:00:01.000Z'),
        },
      })
    ).toThrow('Every valuation input artifact must exist before the bundle is created.');
  });

  it('rejects a legacy component manifest still awaiting Gate 3 review', () => {
    const legacy = input();
    const { qualificationState: _qualificationState, limitation: _limitation, ...common } =
      legacy.playerRun.content;
    const content = {
      ...common,
      schemaVersion: 'governed-valuation-component-run/v1' as const,
      approvalState: 'gate_3_review_required' as const,
      publicationEligible: false as const,
      limitation:
        'Authenticated non-production component-run candidate only; Gate 3 approval, grades, production use, and publication remain prohibited.' as const,
    };
    const playerRun = { runId: createAflTradeContentAddress('model-run', content), content };

    expect(() =>
      createAflTradeValuationInputBundleCandidate({
        ...legacy,
        playerRun,
        modelEvidence: { ...legacy.modelEvidence, playerRunId: playerRun.runId },
      })
    ).toThrow('Valuation input candidates require successor component-run manifests.');
  });

  it('rejects a component registered after qualification evidence was captured', () => {
    const lateRun = input();
    const content = {
      ...lateRun.pickRun.content,
      registeredAt: '2026-08-15T01:40:01.000Z',
    };
    const pickRun = { runId: createAflTradeContentAddress('model-run', content), content };

    expect(() =>
      createAflTradeValuationInputBundleCandidate({
        ...lateRun,
        pickRun,
        modelEvidence: { ...lateRun.modelEvidence, pickRunId: pickRun.runId },
      })
    ).toThrow('Qualified model evidence cannot predate its component registrations.');
  });
});
