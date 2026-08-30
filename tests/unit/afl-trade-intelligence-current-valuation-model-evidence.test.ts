import { describe, expect, it } from 'vitest';

import {
  createAflTradeCurrentValuationModelEvidenceCoordinator,
  createAflTradeCurrentValuationModelEvidenceOperationId,
  type AflTradeCurrentValuationModelEvidenceRepository,
  type AflTradeCurrentValuationModelEvidenceResult,
} from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidence';

const digest = (value: string) => value.repeat(64);
const id = (prefix: string, value: string) => `${prefix}:${digest(value)}`;

const factualAuthority = {
  valuationScopeKey: 'afl-men:2026-trades',
  candidateId: id('private-factual-candidate', '1'),
  evidenceScopeKey: 'afl-men:reviewed-provider-evidence',
  evidenceBundleId: id('private-reviewed-evidence-bundle', '2'),
  reviewDecisionId: id('private-reviewed-evidence-evaluation-decision', '3'),
  normalizedReconciledCustodySha256: digest('4'),
  revision: 2,
} as const;

const request = {
  scopeKey: factualAuthority.valuationScopeKey,
  factualOperationId: id('current-valuation-factual-refresh-operation', '5'),
  privateFactualAuthority: factualAuthority,
} as const;

class MemoryRepository implements AflTradeCurrentValuationModelEvidenceRepository {
  retained = new Map<string, AflTradeCurrentValuationModelEvidenceResult>();
  currentRevision = 0;

  async load(operationId: string) {
    return this.retained.get(operationId) ?? null;
  }

  async commit(input: Parameters<AflTradeCurrentValuationModelEvidenceRepository['commit']>[0]) {
    if (input.expectedModelRevision !== this.currentRevision)
      return { state: 'stale_authority' as const };
    this.retained.set(input.result.operationId, input.result);
    if (input.result.state === 'qualified') this.currentRevision += 1;
    return { state: 'committed' as const, result: input.result };
  }
}

function qualifiedResult() {
  return {
    state: 'qualified' as const,
    playerObservationSetId: id('player-observation-set', '6'),
    pickBenchmarkEvidenceId: id('pick-pav-observation-set', '7'),
    playerRunId: id('model-run', '8'),
    pickRunId: id('model-run', '9'),
    qualificationId: id('model-qualification', 'a'),
    qualificationWorkId: id('model-qualification-work', 'b'),
    playerGate3DecisionId: id('review-decision', 'c'),
    pickGate3DecisionId: id('review-decision', 'd'),
  };
}

describe('current valuation model evidence coordinator', () => {
  it('binds deterministic evidence and qualification to the exact refreshed factual authority', async () => {
    const repository = new MemoryRepository();
    const calls: unknown[] = [];
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async (input) => {
        calls.push(input);
        return qualifiedResult();
      },
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    const result = await coordinator.refresh(request);

    expect(result).toMatchObject({
      state: 'qualified',
      privateFactualAuthority: factualAuthority,
      expectedModelRevision: 0,
      modelRevision: 1,
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        operationId: createAflTradeCurrentValuationModelEvidenceOperationId(request),
        privateFactualAuthority: factualAuthority,
      }),
    ]);
  });

  it('replays a committed qualification without deriving evidence or creating another pair', async () => {
    const repository = new MemoryRepository();
    let executions = 0;
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => repository.currentRevision,
      prepareAndQualify: async () => {
        executions += 1;
        return qualifiedResult();
      },
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    const first = await coordinator.refresh(request);
    const restartedCoordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => repository.currentRevision,
      prepareAndQualify: async () => {
        executions += 1;
        return qualifiedResult();
      },
      clock: { now: () => '2026-08-30T10:01:00.000Z' },
    });
    const replay = await restartedCoordinator.refresh(request);

    expect(replay).toEqual(first);
    expect(executions).toBe(1);
  });

  it('retains failed qualification evidence without advancing current model authority', async () => {
    const repository = new MemoryRepository();
    repository.currentRevision = 4;
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 4,
      prepareAndQualify: async () => ({
        state: 'qualification_failed',
        playerObservationSetId: id('player-observation-set', '6'),
        pickBenchmarkEvidenceId: id('pick-pav-observation-set', '7'),
        playerRunId: id('model-run', '8'),
        pickRunId: id('model-run', '9'),
        qualificationId: id('model-qualification', 'a'),
        failureCodes: ['pick_validation_threshold_failed'],
      }),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    const result = await coordinator.refresh(request);

    expect(result).toMatchObject({
      state: 'qualification_failed',
      expectedModelRevision: 4,
      modelRevision: 4,
      failureCodes: ['pick_validation_threshold_failed'],
    });
    expect(repository.currentRevision).toBe(4);
  });

  it('rejects stale authority instead of retaining a mismatched stage result', async () => {
    const repository = new MemoryRepository();
    repository.currentRevision = 2;
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 1,
      prepareAndQualify: async () => qualifiedResult(),
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await expect(coordinator.refresh(request)).resolves.toMatchObject({
      state: 'stale_authority',
      expectedModelRevision: 1,
    });
    expect(repository.retained.size).toBe(0);
  });

  it('fails closed without custody when factual derivation rejects unavailable authority', async () => {
    const repository = new MemoryRepository();
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: async () => {
        throw new TypeError('Factual authority was withdrawn before derivation.');
      },
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await expect(coordinator.refresh(request)).rejects.toThrow(
      'Factual authority was withdrawn before derivation.'
    );
    expect(repository.retained.size).toBe(0);
    expect(repository.currentRevision).toBe(0);
  });

  it('does not replay retained custody for a distinct factual operation', async () => {
    const repository = new MemoryRepository();
    let executions = 0;
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository,
      captureCurrentModelRevision: async () => repository.currentRevision,
      prepareAndQualify: async () => {
        executions += 1;
        return qualifiedResult();
      },
      clock: { now: () => '2026-08-30T10:00:00.000Z' },
    });

    await coordinator.refresh(request);
    await coordinator.refresh({
      ...request,
      factualOperationId: id('current-valuation-factual-refresh-operation', 'e'),
    });

    expect(executions).toBe(2);
    expect(repository.retained.size).toBe(2);
  });
});
