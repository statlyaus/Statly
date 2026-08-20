import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationGateRecords,
  createGovernedValuationModelQualificationPolicy,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';

const evaluatedAt = '2026-08-21T09:00:00.000Z';

function ref(prefix: string, label: string) {
  const value = { prefix, label };
  return createAflTradeCanonicalJsonArtifactRef(value, '2026-08-21T08:00:00.000Z');
}

function fixture() {
  const policy = createGovernedValuationModelQualificationPolicy({
    player: {
      schemaVersion: 'governed-player-model-qualification-criteria/v1' as const,
      minimumComparableObservations: 100,
      minimumRelativeMaeImprovement: 0.05,
      minimumRelativeRmseImprovement: 0.05,
      requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    },
    pick: {
      schemaVersion: 'governed-pick-model-qualification-criteria/v1' as const,
      evaluatedScope: 'final_test' as const,
      minimumObservations: 30,
      maximumMulticlassBrierScore: 0.7,
      maximumMulticlassLogLoss: 2,
      maximumRankedProbabilityScore: 0.35,
      maximumContributionCrps: 25,
      maximumMeanAbsoluteContributionError: 30,
      maximumRootMeanSquaredContributionError: 40,
      maximumMeanAbsoluteGamesError: 35,
      maximumRootMeanSquaredGamesError: 45,
      minimumEmpiricalP10P90Coverage: 0.7,
      maximumEmpiricalP10P90Coverage: 0.9,
      maximumMeanEmpiricalIntervalWidth: 80,
      maximumZeroProbabilityObservationCount: 0,
    },
  });
  const playerEvidence = {
    schemaVersion: 'governed-player-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress('player-validation-report', 'player-report'),
    comparableObservationCount: 120,
    acceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    relativeMaeImprovement: 0.08,
    relativeRmseImprovement: 0.07,
  };
  const pickEvidence = {
    schemaVersion: 'governed-pick-model-qualification-evidence/v1' as const,
    validationReportId: createAflTradeContentAddress(
      'pick-pav-validation-report',
      'pick-report'
    ),
    evaluationStatus: 'scored_not_approved' as const,
    scope: 'final_test' as const,
    observationCount: 40,
    metrics: {
      multiclassBrierScore: 0.4,
      multiclassLogLoss: 1.2,
      rankedProbabilityScore: 0.2,
      contributionCrps: 18,
      meanAbsoluteContributionError: 22,
      rootMeanSquaredContributionError: 31,
      meanAbsoluteGamesError: 24,
      rootMeanSquaredGamesError: 34,
      empiricalP10P90Coverage: 0.8,
      meanEmpiricalIntervalWidth: 60,
      zeroProbabilityObservationCount: 0,
    },
  };
  const playerRunId = createAflTradeContentAddress('model-run', 'qualified-player-run');
  const pickRunId = createAflTradeContentAddress('model-run', 'qualified-pick-run');
  return {
    environment: 'non_production' as const,
    scopeKey: 'afl-men:2026-trades',
    evaluatedAt,
    policy,
    policyArtifact: createAflTradeCanonicalJsonArtifactRef(policy, evaluatedAt),
    components: {
      player: {
        role: 'player_contribution_and_availability' as const,
        runId: playerRunId,
        runArtifact: ref('run', 'player'),
        protocolId: createAflTradeContentAddress('model-protocol', 'player-protocol'),
        protocolArtifact: ref('protocol', 'player'),
        criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(policy.player, evaluatedAt),
        validationEvidence: playerEvidence,
        validationEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          playerEvidence,
          evaluatedAt
        ),
      },
      pick: {
        role: 'draft_pick_and_future_pick_distribution' as const,
        runId: pickRunId,
        runArtifact: ref('run', 'pick'),
        protocolId: createAflTradeContentAddress('model-protocol', 'pick-protocol'),
        protocolArtifact: ref('protocol', 'pick'),
        criteriaArtifact: createAflTradeCanonicalJsonArtifactRef(policy.pick, evaluatedAt),
        validationEvidence: pickEvidence,
        validationEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          pickEvidence,
          evaluatedAt
        ),
      },
    },
  };
}

describe('governed valuation model qualification', () => {
  it('qualifies one exact player-and-pick release by recomputing authenticated criteria', () => {
    const input = fixture();
    const qualification = createGovernedValuationModelQualification(input);

    expect(qualification.qualificationId).toMatch(/^model-qualification:[a-f0-9]{64}$/u);
    expect(qualification.content.policy.policyVersion).toMatch(
      /^model-qualification-policy:[a-f0-9]{64}$/u
    );
    expect(qualification.content).toMatchObject({
      environment: 'non_production',
      scopeKey: input.scopeKey,
      outcome: 'qualified',
      publicationEligible: false,
      player: { runId: input.components.player.runId, passed: true },
      pick: { runId: input.components.pick.runId, passed: true },
      failureCodes: [],
    });
    expect(qualification.content.policyArtifact).toEqual(input.policyArtifact);
  });

  it('retains a failed exact pair without converting scored evidence into approval', () => {
    const input = fixture();
    const failedEvidence = {
      ...input.components.pick.validationEvidence,
      metrics: {
        ...input.components.pick.validationEvidence.metrics,
        multiclassLogLoss: 2.5,
      },
    };
    const qualification = createGovernedValuationModelQualification({
      ...input,
      components: {
        ...input.components,
        pick: {
          ...input.components.pick,
          validationEvidence: failedEvidence,
          validationEvidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
            failedEvidence,
            evaluatedAt
          ),
        },
      },
    });

    expect(qualification.content.outcome).toBe('failed');
    expect(qualification.content.pick.passed).toBe(false);
    expect(qualification.content.failureCodes).toContain('pick_log_loss_above_maximum');
  });

  it('rejects criteria or evidence that are not authenticated by their retained references', () => {
    const input = fixture();
    const conflictingPolicy = {
      ...input.policy,
      player: { ...input.policy.player, minimumComparableObservations: 101 },
    };
    expect(() =>
      createGovernedValuationModelQualification({
        ...input,
        policy: conflictingPolicy,
        policyArtifact: createAflTradeCanonicalJsonArtifactRef(conflictingPolicy, evaluatedAt),
      })
    ).toThrow(/policyVersion|content-address/i);

    expect(() =>
      createGovernedValuationModelQualification({
        ...input,
        components: {
          ...input.components,
          player: { ...input.components.player, criteriaArtifact: ref('criteria', 'wrong') },
        },
      })
    ).toThrow(/criteria artifact/i);

    expect(() =>
      createGovernedValuationModelQualification({
        ...input,
        components: {
          ...input.components,
          pick: { ...input.components.pick, validationEvidenceArtifact: ref('evidence', 'wrong') },
        },
      })
    ).toThrow(/validation evidence artifact/i);
  });

  it('creates two linked automated Gate 3 records only for a passing exact pair', () => {
    const input = fixture();
    const qualification = createGovernedValuationModelQualification(input);
    const qualificationArtifact = createAflTradeCanonicalJsonArtifactRef(
      qualification,
      evaluatedAt
    );
    const records = createGovernedValuationModelQualificationGateRecords({
      qualification,
      qualificationArtifact,
      decidedAt: evaluatedAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });

    expect(records.map(({ decision }) => decision.content)).toEqual([
      expect.objectContaining({
        gate: 'gate_3_model_validity',
        authorityKind: 'automated_validation_record',
        revalidateAt: null,
        affectedArtifacts: [
          { kind: 'model_run', artifactId: input.components.player.runId },
          { kind: 'model_qualification', artifactId: qualification.qualificationId },
        ],
      }),
      expect.objectContaining({
        gate: 'gate_3_model_validity',
        authorityKind: 'automated_validation_record',
        revalidateAt: null,
        affectedArtifacts: [
          { kind: 'model_run', artifactId: input.components.pick.runId },
          { kind: 'model_qualification', artifactId: qualification.qualificationId },
        ],
      }),
    ]);
    expect(records[0]!.decision.content.authorityEvidenceIds).toEqual([
      qualificationArtifact.artifactId,
    ]);

    const failedInput = fixture();
    failedInput.components.player.validationEvidence.relativeMaeImprovement = 0;
    failedInput.components.player.validationEvidenceArtifact =
      createAflTradeCanonicalJsonArtifactRef(
        failedInput.components.player.validationEvidence,
        evaluatedAt
      );
    const failed = createGovernedValuationModelQualification(failedInput);
    expect(() =>
      createGovernedValuationModelQualificationGateRecords({
        qualification: failed,
        qualificationArtifact: createAflTradeCanonicalJsonArtifactRef(failed, evaluatedAt),
        decidedAt: evaluatedAt,
        automationPrincipal: 'statly-model-qualification-agent',
        accountableOwner: 'statly-model-owner',
        versions: { player: 1, pick: 1 },
        supersedes: { player: null, pick: null },
      })
    ).toThrow(/passing|qualified/i);
  });
});
