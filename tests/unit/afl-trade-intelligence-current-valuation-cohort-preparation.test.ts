import { describe, expect, it } from 'vitest';

import {
  AflTradeCurrentValuationTradeUnavailableError,
  createAflTradeCurrentValuationCohortCoordinator,
} from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
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
  it('constructs private prepared-v3 from exact dispatch-bound authority', async () => {
    const bundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey: 'afl-men:2026-trades',
      playerRunId: 'model-run:' + digest('9'),
      pickRunId: 'model-run:' + digest('a'),
    });
    const privateAuthority = {
      dispatchRequestId: 'private-valuation-dispatch:' + digest('0'),
      factualOutputId: 'private-valuation-factual-output:' + digest('1'),
      hpnCalculationId: 'hpn-pav-season:' + digest('2'),
      modelOperationId: 'private-valuation-model-operation:' + digest('3'),
      modelQualificationId: 'model-qualification:' + digest('8'),
      modelQualificationWorkId: 'model-qualification-work:' + digest('4'),
      modelQualificationRevision: 3,
      playerRunId: 'model-run:' + digest('9'),
      pickRunId: 'model-run:' + digest('a'),
    } as const;
    const coordinator = createAflTradeCurrentValuationCohortCoordinator({
      captureCurrent: async () => ({
        operationId: 'valuation-cohort-preparation-operation:' + digest('5'),
        scopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
        factualReleaseId: 'outcome-release:' + digest('6'),
        factualReleaseArtifact: artifact('7'),
        releaseMembershipArtifact: artifact('8'),
        releaseTradeIds: ['trade-a'],
        preparationAuthority: 'dispatch_bound_private_factual_output' as const,
        privateAuthority,
        expectedPreparedInputRevision: 11,
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
        capturedAt: '2026-08-21T09:00:00.000Z',
      }),
      prepareTrade: async ({ tradeId }) => ({
        tradeId,
        state: 'ready',
        materializationManifestId: 'private-evaluation-materialization-manifest:' + digest('b'),
        materializationManifestArtifact: artifact('c', '2026-08-21T08:30:00.000Z'),
      }),
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
      operationId: 'valuation-cohort-preparation-operation:' + digest('5'),
      scopeKey: 'afl-men:2026-trades',
    });

    expect(result).toMatchObject({
      state: 'advanced',
      preparedInputSet: {
        content: {
          preparationAuthority: 'dispatch_bound_private_factual_output',
          privateAuthority,
        },
      },
    });
  });

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
