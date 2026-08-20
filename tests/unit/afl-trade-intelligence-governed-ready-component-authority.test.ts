import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { authenticateGovernedReadyComponentAuthority } from '@/server/aflTradeIntelligence/valuation/internal/governedReadyComponentAuthority';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationPolicy,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';

const capturedAt = '2026-08-20T10:00:00.000Z';
const createdAt = '2026-08-20T09:00:00.000Z';

function artifact(label: string) {
  const contentSha256 = createAflTradeContentAddress('artifact', label).split(':')[1]!;
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

function qualificationFor(
  run: ReturnType<typeof createGovernedValuationComponentRunManifest>,
  options: Readonly<{ playerMinimumComparableObservations?: number }> = {}
) {
  const policy = createGovernedValuationModelQualificationPolicy({
    player: {
      schemaVersion: 'governed-player-model-qualification-criteria/v1' as const,
      minimumComparableObservations: options.playerMinimumComparableObservations ?? 1,
      minimumRelativeMaeImprovement: 0.05,
      minimumRelativeRmseImprovement: 0.05,
      requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    },
    pick: {
      schemaVersion: 'governed-pick-model-qualification-criteria/v1' as const,
      evaluatedScope: 'final_test' as const,
      minimumObservations: 1,
      maximumMulticlassBrierScore: 1,
      maximumMulticlassLogLoss: 2,
      maximumRankedProbabilityScore: 1,
      maximumContributionCrps: 100,
      maximumMeanAbsoluteContributionError: 100,
      maximumRootMeanSquaredContributionError: 100,
      maximumMeanAbsoluteGamesError: 100,
      maximumRootMeanSquaredGamesError: 100,
      minimumEmpiricalP10P90Coverage: 0.5,
      maximumEmpiricalP10P90Coverage: 1,
      maximumMeanEmpiricalIntervalWidth: 100,
      maximumZeroProbabilityObservationCount: 0,
    },
  });
  const playerEvidence = {
    schemaVersion: 'governed-player-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress('player-validation-report', 'ready-player'),
    comparableObservationCount: 10,
    acceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    relativeMaeImprovement: 0.1,
    relativeRmseImprovement: 0.1,
  };
  const pickEvidence = {
    schemaVersion: 'governed-pick-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress(
      'pick-pav-validation-report',
      'ready-pick'
    ),
    evaluationStatus: 'scored_not_approved' as const,
    scope: 'final_test' as const,
    observationCount: 10,
    metrics: {
      multiclassBrierScore: 0.5,
      multiclassLogLoss: 1,
      rankedProbabilityScore: 0.5,
      contributionCrps: 50,
      meanAbsoluteContributionError: 50,
      rootMeanSquaredContributionError: 50,
      meanAbsoluteGamesError: 50,
      rootMeanSquaredGamesError: 50,
      empiricalP10P90Coverage: 0.8,
      meanEmpiricalIntervalWidth: 50,
      zeroProbabilityObservationCount: 0,
    },
  };
  const qualification = createGovernedValuationModelQualification({
    environment: 'non_production',
    scopeKey: 'afl-men:2025-trades',
    evaluatedAt: capturedAt,
    policy,
    policyArtifact: createAflTradeCanonicalJsonArtifactRef(policy, capturedAt),
    components: {
      player: {
        role: run.content.role as 'player_contribution_and_availability',
        runId: run.runId,
        runArtifact: createAflTradeCanonicalJsonArtifactRef(run, createdAt),
        protocolId: run.content.protocolId,
        protocolArtifact: run.content.protocolArtifact,
        criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(policy.player, capturedAt),
        validationEvidence: playerEvidence,
        validationEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          playerEvidence,
          capturedAt
        ),
      },
      pick: {
        role: 'draft_pick_and_future_pick_distribution',
        runId: createAflTradeContentAddress('model-run', 'ready-pick-run'),
        runArtifact: artifact('ready-pick-run'),
        protocolId: createAflTradeContentAddress('model-protocol', 'ready-pick-protocol'),
        protocolArtifact: artifact('ready-pick-protocol'),
        criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(policy.pick, capturedAt),
        validationEvidence: pickEvidence,
        validationEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          pickEvidence,
          capturedAt
        ),
      },
    },
  });
  return {
    qualification,
    qualificationArtifact: createAflTradeCanonicalJsonArtifactRef(qualification, capturedAt),
  };
}

function fixture() {
  const protocolId = createAflTradeContentAddress('model-protocol', { fixture: 'player' });
  const datasetId = createAflTradeContentAddress('dataset', { fixture: 'player' });
  const datasetAdmissionId = createAflTradeContentAddress('dataset-admission', {
    fixture: 'player',
  });
  const run = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: createAflTradeContentAddress('model-run', { fixture: 'native-player' }),
      artifact: artifact('native-player'),
    },
    protocolId,
    protocolArtifact: artifact('player-protocol'),
    datasetId,
    datasetArtifact: artifact('player-dataset'),
    datasetAdmissionId,
    datasetAdmissionArtifact: artifact('player-admission'),
    datasetAdmissionGateLedgerRevision: 11,
    registeredAt: createdAt,
  });
  const runArtifact = createAflTradeCanonicalJsonArtifactRef(run, createdAt);
  const qualification = qualificationFor(run);
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: createAflTradeContentAddress('gate-proposal', { fixture: 'player-gate3' }),
    gate: 'gate_3_model_validity' as const,
    decisionKey: 'private-player-component-run-v1',
    version: 2,
    environment: 'non_production' as const,
    scope: {
      scopeKey: 'afl-men:2025-trades',
      description: 'Player component model validity.',
      dimensions: [],
      exclusions: [],
    },
    state: 'approved' as const,
    authorityKind: 'automated_validation_record' as const,
    accountableOwner: 'statly-model-owner',
    decidedBy: 'statly-model-qualification-agent',
    reviewers: [],
    authorityEvidenceIds: [artifact('review-evidence').artifactId],
    conditionResults: [],
    rationale: 'Independent review accepted this exact component envelope.',
    limitations: ['Private non-production calculation only.'],
    decidedAt: '2026-08-20T09:10:00.000Z',
    effectiveAt: '2026-08-20T09:15:00.000Z',
    revalidateAt: null,
    supersedesDecisionId: null,
    affectedArtifacts: [
      { kind: 'model_run' as const, artifactId: run.runId },
      {
        kind: 'model_qualification' as const,
        artifactId: qualification.qualification.qualificationId,
      },
    ],
    withdrawalActions: [],
  };
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return {
    run: { manifest: run, artifact: runArtifact },
    traceComponent: {
      role: run.content.role,
      runId: run.runId,
      protocolId,
      datasetId,
      datasetAdmissionId,
      gate3DecisionId: gate3Decision.decisionId,
      evidence: {
        runManifest: runArtifact,
        protocol: run.content.protocolArtifact,
        datasetAdmission: run.content.datasetAdmissionArtifact,
        gate3Decision: createAflTradeCanonicalJsonArtifactRef(
          gate3Decision,
          gate3Decision.content.decidedAt!
        ),
      },
    },
    gate3Decision,
    ...qualification,
  };
}

function replaceDecision(
  value: ReturnType<typeof fixture>,
  content: typeof value.gate3Decision.content
) {
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
  const gate3DecisionArtifact = createAflTradeCanonicalJsonArtifactRef(
    gate3Decision,
    gate3Decision.content.decidedAt!
  );
  return {
    ...value,
    traceComponent: {
      ...value.traceComponent,
      gate3DecisionId: gate3Decision.decisionId,
      evidence: { ...value.traceComponent.evidence, gate3Decision: gate3DecisionArtifact },
    },
    gate3Decision,
    gate3DecisionArtifact,
  };
}

describe('governed ready component authority', () => {
  it('returns only exact current automated model-pair qualification authority', () => {
    const value = fixture();
    expect(
      authenticateGovernedReadyComponentAuthority({
        ...value,
        gate3DecisionArtifact: value.traceComponent.evidence.gate3Decision,
        gate3IsCurrent: true,
        gateLedgerRevision: 19,
        capturedAt,
        qualification: value.qualification,
        qualificationArtifact: value.qualificationArtifact,
        currentQualificationId: value.qualification.qualificationId,
      })
    ).toEqual({
      role: value.traceComponent.role,
      runId: value.traceComponent.runId,
      protocolId: value.traceComponent.protocolId,
      datasetId: value.traceComponent.datasetId,
      datasetAdmissionId: value.traceComponent.datasetAdmissionId,
      datasetAdmissionGateLedgerRevision: 11,
      gate3DecisionId: value.gate3Decision.decisionId,
      gate3DecisionVersion: 2,
      qualificationId: value.qualification.qualificationId,
      qualificationPolicyVersion: value.qualification.content.policy.policyVersion,
    });
  });

  it('rejects superseded, not-yet-effective, and non-automated Gate authority', () => {
    const value = fixture();
    const common = {
      ...value,
      gate3DecisionArtifact: value.traceComponent.evidence.gate3Decision,
      gateLedgerRevision: 19,
      capturedAt,
      qualification: value.qualification,
      qualificationArtifact: value.qualificationArtifact,
      currentQualificationId: value.qualification.qualificationId,
    };
    expect(() =>
      authenticateGovernedReadyComponentAuthority({ ...common, gate3IsCurrent: false })
    ).toThrow(/current/i);

    const notYetEffective = replaceDecision(value, {
      ...value.gate3Decision.content,
      effectiveAt: '2026-08-20T10:00:01.000Z',
    });
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        ...notYetEffective,
        gate3IsCurrent: true,
      })
    ).toThrow(/effective/i);

    const fixtureOnly = replaceDecision(value, {
      ...value.gate3Decision.content,
      authorityKind: 'fixture',
      revalidateAt: '2026-08-21T10:00:00.000Z',
    });
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        ...fixtureOnly,
        gate3IsCurrent: true,
      })
    ).toThrow(/automated/i);
  });

  it('rejects failed, stale, or mismatched model-pair qualification evidence', () => {
    const value = fixture();
    const common = {
      ...value,
      gate3DecisionArtifact: value.traceComponent.evidence.gate3Decision,
      gate3IsCurrent: true,
      gateLedgerRevision: 19,
      capturedAt,
    };
    const failed = qualificationFor(value.run.manifest, {
      playerMinimumComparableObservations: 100,
    });

    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        qualification: failed.qualification,
        qualificationArtifact: failed.qualificationArtifact,
        currentQualificationId: failed.qualification.qualificationId,
      })
    ).toThrow(/passing/i);

    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        currentQualificationId: createAflTradeContentAddress(
          'model-qualification',
          'superseding-current-qualification'
        ),
      })
    ).toThrow(/current/i);

    const otherRun = createGovernedValuationComponentRunManifest({
      ...value.run.manifest.content,
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: createAflTradeContentAddress('model-run', 'other-player-run'),
        artifact: artifact('other-player-run'),
      },
    });
    const otherQualification = qualificationFor(otherRun);
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        qualification: otherQualification.qualification,
        qualificationArtifact: otherQualification.qualificationArtifact,
        currentQualificationId: otherQualification.qualification.qualificationId,
      })
    ).toThrow(/exact component run/i);

    const crossScope = replaceDecision(value, {
      ...value.gate3Decision.content,
      scope: { ...value.gate3Decision.content.scope, scopeKey: 'afl-men:2024-trades' },
    });
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        ...crossScope,
        gate3IsCurrent: true,
        qualification: value.qualification,
        qualificationArtifact: value.qualificationArtifact,
        currentQualificationId: value.qualification.qualificationId,
      })
    ).toThrow(/exact run and qualification/i);
  });

  it('rejects a legacy pick fixture wrapper even when a Gate 3 record names it', () => {
    const value = fixture();
    const legacyPickRun = createGovernedValuationComponentRunManifest({
      ...value.run.manifest.content,
      role: 'draft_pick_and_future_pick_distribution',
      nativeExecution: {
        kind: 'pick_pav_model_execution',
        executionId: createAflTradeContentAddress('pick-pav-model-execution', {
          fixture: 'legacy-pick',
        }),
        artifact: artifact('legacy-pick'),
      },
    });
    const runArtifact = createAflTradeCanonicalJsonArtifactRef(legacyPickRun, createdAt);
    const replaced = replaceDecision(value, {
      ...value.gate3Decision.content,
      affectedArtifacts: [
        { kind: 'model_run', artifactId: legacyPickRun.runId },
        {
          kind: 'model_qualification',
          artifactId: value.qualification.qualificationId,
        },
      ],
    });

    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        traceComponent: {
          role: legacyPickRun.content.role,
          runId: legacyPickRun.runId,
          protocolId: legacyPickRun.content.protocolId,
          datasetId: legacyPickRun.content.datasetId,
          datasetAdmissionId: legacyPickRun.content.datasetAdmissionId,
          gate3DecisionId: replaced.gate3Decision.decisionId,
          evidence: {
            runManifest: runArtifact,
            protocol: legacyPickRun.content.protocolArtifact,
            datasetAdmission: legacyPickRun.content.datasetAdmissionArtifact,
            gate3Decision: replaced.gate3DecisionArtifact,
          },
        },
        run: { manifest: legacyPickRun, artifact: runArtifact },
        gate3Decision: replaced.gate3Decision,
        gate3DecisionArtifact: replaced.gate3DecisionArtifact,
        gate3IsCurrent: true,
        gateLedgerRevision: 19,
        capturedAt,
        qualification: value.qualification,
        qualificationArtifact: value.qualificationArtifact,
        currentQualificationId: value.qualification.qualificationId,
      })
    ).toThrow(/governed|fixture|eligible/i);
  });
});
