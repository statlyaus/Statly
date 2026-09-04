import { describe, expect, it } from 'vitest';

import {
  AflTradeCurrentValuationTradeUnavailableError,
  createAflTradeCurrentValuationCohortCoordinator,
  createAflTradePrivateCurrentValuationCohortPreparationOperationId,
} from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
import { createAflTradeCurrentValuationModelEvidenceOperationId } from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidence';
import { createAflTradeCurrentValuationBundleFixture } from '../testUtils/currentValuationCohortFixture';

const digest = (character: string) => character.repeat(64);

function artifact(character: string, createdAt = '2026-08-21T08:00:00.000Z') {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 256,
    createdAt,
  };
}

describe('current AFL trade valuation cohort preparation', () => {
  it('classifies every current factual-release trade in one authenticated prepared-v3 cohort', async () => {
    const attempted: string[] = [];
    const bundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey: 'afl-men:2026-trades',
      playerRunId: 'model-run:' + digest('9'),
      pickRunId: 'model-run:' + digest('a'),
    });
    const coordinator = createAflTradeCurrentValuationCohortCoordinator({
      captureCurrent: async () => ({
        operationId: 'valuation-cohort-preparation-operation:' + digest('1'),
        scopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
        factualReleaseId: 'outcome-release:' + digest('2'),
        factualReleaseRevision: 7,
        factualReleaseArtifact: artifact('3'),
        releaseMembershipArtifact: artifact('4'),
        releaseTradeIds: ['trade-a', 'trade-b'],
        sourceQualificationReportId: 'valuation-source-qualification:' + digest('5'),
        sourceQualificationReportArtifact: artifact('6'),
        sourceQualificationEvidenceRefs: [artifact('7')],
        modelQualificationId: 'model-qualification:' + digest('8'),
        modelQualificationWorkId: 'model-qualification-work:' + digest('0'),
        modelQualificationRevision: 3,
        playerRunId: 'model-run:' + digest('9'),
        pickRunId: 'model-run:' + digest('a'),
        expectedPreparedInputRevision: 11,
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
        capturedAt: '2026-08-21T09:00:00.000Z',
      }),
      prepareTrade: async ({ tradeId }) => {
        attempted.push(tradeId);
        if (tradeId === 'trade-b') {
          throw new AflTradeCurrentValuationTradeUnavailableError('isolated construction failure');
        }
        return {
          tradeId,
          state: 'ready',
          materializationManifestId: 'private-evaluation-materialization-manifest:' + digest('d'),
          materializationManifestArtifact: artifact('e', '2026-08-21T08:30:00.000Z'),
        };
      },
      commitIfCurrent: async ({ preparedInputSet }) => ({
        state: 'advanced',
        preparedInputSet,
        head: {
          scopeKey: preparedInputSet.content.scopeKey,
          preparedInputSetId: preparedInputSet.preparedInputSetId,
          revision: 12,
          activatedAt: preparedInputSet.content.preparedAt,
        },
      }),
    });

    const result = await coordinator.prepare({
      operationId: 'valuation-cohort-preparation-operation:' + digest('1'),
      scopeKey: 'afl-men:2026-trades',
    });

    expect(result.state).toBe('advanced');
    if (result.state !== 'advanced') throw new Error('Expected an advanced cohort.');
    expect(result.preparedInputSet.content).toMatchObject({
      schemaVersion: 'afl-trade-prepared-valuation-input-set/v3',
      releaseTradeIds: ['trade-a', 'trade-b'],
      tradeCount: 2,
      readyCount: 1,
      blockedCount: 1,
      preparedAt: '2026-08-21T08:30:00.000Z',
      publicationEligible: false,
    });
    expect(
      result.preparedInputSet.content.entries.map(({ tradeId, state }) => ({
        tradeId,
        state,
      }))
    ).toEqual([
      { tradeId: 'trade-a', state: 'ready' },
      { tradeId: 'trade-b', state: 'blocked' },
    ]);
    expect(attempted.sort()).toEqual(['trade-a', 'trade-b']);
    expect(result.preparedInputSet.content.entries[1]).toMatchObject({
      blockers: [{ code: 'component_output_unavailable' }],
    });
  });

  it('constructs private prepared-v3 from one exact qualified current model-evidence result', async () => {
    const privateFactualAuthority = {
      valuationScopeKey: 'afl-men:2026-trades',
      candidateId: 'private-factual-candidate:' + digest('1'),
      evidenceScopeKey: 'afl-men:2026-evidence',
      evidenceBundleId: 'private-reviewed-evidence-bundle:' + digest('2'),
      reviewDecisionId: 'private-reviewed-evidence-evaluation-decision:' + digest('3'),
      normalizedReconciledCustodySha256: digest('4'),
      revision: 8,
    } as const;
    const factualOperationId = 'current-valuation-factual-refresh-operation:' + digest('5');
    const modelEvidenceOperationId = createAflTradeCurrentValuationModelEvidenceOperationId({
      scopeKey: 'afl-men:2026-trades',
      factualOperationId,
      privateFactualAuthority,
    });
    const modelEvidence = {
      schemaVersion: 'afl-current-valuation-model-evidence-result/v1',
      state: 'qualified',
      operationId: modelEvidenceOperationId,
      scopeKey: 'afl-men:2026-trades',
      factualOperationId,
      privateFactualAuthority,
      expectedModelRevision: 4,
      modelRevision: 5,
      playerObservationSetId: 'player-observation-set:' + digest('6'),
      pickBenchmarkEvidenceId: 'pick-pav-observation-set:' + digest('7'),
      playerRunId: 'model-run:' + digest('8'),
      pickRunId: 'model-run:' + digest('9'),
      qualificationId: 'model-qualification:' + digest('a'),
      qualificationWorkId: 'model-qualification-work:' + digest('b'),
      playerGate3DecisionId: 'gate-decision:player',
      pickGate3DecisionId: 'gate-decision:pick',
      capturedAt: '2026-09-04T08:00:00.000Z',
      completedAt: '2026-09-04T08:05:00.000Z',
      executionLocation: 'local',
      visibility: 'private',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      limitation:
        'Private local non-production model evidence only; no prepared-input, valuation, production, activation, or publication authority is granted.',
    } as const;
    const dispatchAuthority = {
      requestId: 'private-valuation-dispatch:' + digest('c'),
      factualOutputId: 'private-valuation-factual-output:' + digest('d'),
      hpnCalculationId: 'hpn-pav-season:' + digest('e'),
      modelOperationId: 'private-valuation-model-operation:' + digest('f'),
    } as const;
    const bundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey: modelEvidence.scopeKey,
      playerRunId: modelEvidence.playerRunId,
      pickRunId: modelEvidence.pickRunId,
    });
    const operationId = createAflTradePrivateCurrentValuationCohortPreparationOperationId({
      scopeKey: modelEvidence.scopeKey,
      factualReleaseId: 'outcome-release:' + digest('0'),
      modelEvidence,
      dispatchAuthority,
      valuationInputBundleId: bundle.valuationInputBundleId,
      expectedPreparedInputRevision: 12,
    });
    const coordinator = createAflTradeCurrentValuationCohortCoordinator({
      captureCurrent: async () => ({
        operationId,
        scopeKey: modelEvidence.scopeKey,
        factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
        factualReleaseId: 'outcome-release:' + digest('0'),
        factualReleaseArtifact: artifact('1'),
        releaseMembershipArtifact: artifact('2'),
        releaseTradeIds: ['trade-a'],
        preparationAuthority: 'qualified_current_model_evidence',
        modelEvidence,
        dispatchAuthority,
        expectedPreparedInputRevision: 12,
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
        capturedAt: '2026-09-04T09:00:00.000Z',
      }),
      prepareTrade: async ({ tradeId }) => ({
        tradeId,
        state: 'ready',
        materializationManifestId: 'private-evaluation-materialization-manifest:' + digest('3'),
        materializationManifestArtifact: artifact('4', '2026-09-04T08:30:00.000Z'),
      }),
      commitIfCurrent: async ({ preparedInputSet }) => ({
        state: 'advanced',
        preparedInputSet,
        head: {
          scopeKey: preparedInputSet.content.scopeKey,
          preparedInputSetId: preparedInputSet.preparedInputSetId,
          revision: 13,
          activatedAt: preparedInputSet.content.preparedAt,
        },
      }),
    });

    const result = await coordinator.prepare({
      operationId,
      scopeKey: modelEvidence.scopeKey,
    });

    expect(result.state).toBe('advanced');
    if (result.state !== 'advanced') throw new Error('Expected an advanced cohort.');
    expect(result.preparedInputSet.content).toMatchObject({
      preparationAuthority: 'qualified_current_model_evidence',
      preparationOperationId: operationId,
      modelEvidence,
      dispatchAuthority,
      publicationEligible: false,
    });
  });

  it('aborts without committing when trade preparation reports an unexpected defect', async () => {
    const commitIfCurrent = vi.fn();
    const bundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey: 'afl-men:2026-trades',
      playerRunId: 'model-run:' + digest('9'),
      pickRunId: 'model-run:' + digest('a'),
    });
    const coordinator = createAflTradeCurrentValuationCohortCoordinator({
      captureCurrent: async () => ({
        operationId: 'valuation-cohort-preparation-operation:' + digest('1'),
        scopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
        factualReleaseId: 'outcome-release:' + digest('2'),
        factualReleaseRevision: 7,
        factualReleaseArtifact: artifact('3'),
        releaseMembershipArtifact: artifact('4'),
        releaseTradeIds: ['trade-a'],
        sourceQualificationReportId: 'valuation-source-qualification:' + digest('5'),
        sourceQualificationReportArtifact: artifact('6'),
        sourceQualificationEvidenceRefs: [artifact('7')],
        modelQualificationId: 'model-qualification:' + digest('8'),
        modelQualificationWorkId: 'model-qualification-work:' + digest('0'),
        modelQualificationRevision: 3,
        playerRunId: 'model-run:' + digest('9'),
        pickRunId: 'model-run:' + digest('a'),
        expectedPreparedInputRevision: 11,
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
        capturedAt: '2026-08-21T09:00:00.000Z',
      }),
      prepareTrade: async () => {
        throw new TypeError('retained ancestry mismatch');
      },
      commitIfCurrent,
    });

    await expect(
      coordinator.prepare({
        operationId: 'valuation-cohort-preparation-operation:' + digest('1'),
        scopeKey: 'afl-men:2026-trades',
      })
    ).rejects.toThrow('retained ancestry mismatch');
    expect(commitIfCurrent).not.toHaveBeenCalled();
  });
});
