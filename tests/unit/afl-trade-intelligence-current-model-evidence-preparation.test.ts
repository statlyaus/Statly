import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeCurrentValuationModelEvidenceCoordinator,
  type AflTradeCurrentValuationModelEvidenceRepository,
  type AflTradeCurrentValuationModelEvidenceResult,
} from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidence';
import {
  createAflTradeCurrentValuationModelEvidencePreparation,
  type AflTradeCurrentValuationModelEvidencePreparationError,
} from '@/server/aflTradeIntelligence/valuation/currentValuationModelEvidencePreparation';
import { composePostgresAflTradeCurrentValuationModelEvidenceDispatch } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationModelEvidencePreparation';
import { AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION } from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const digest = (value: string) => value.repeat(64);
const id = (prefix: string, value: string) => `${prefix}:${digest(value)}`;

const factualAuthority = {
  valuationScopeKey: 'afl-men:2026-trades',
  candidateId: id('private-factual-candidate', '1'),
  evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
  evidenceBundleId: id('private-reviewed-evidence-bundle', '2'),
  reviewDecisionId: id('private-reviewed-evidence-evaluation-decision', '3'),
  normalizedReconciledCustodySha256: digest('4'),
  revision: 2,
} as const;

const currentRequest = {
  scopeKey: factualAuthority.valuationScopeKey,
  factualOperationId: id('current-valuation-factual-refresh-operation', '5'),
  privateFactualAuthority: factualAuthority,
} as const;

const dispatch = {
  request: {
    requestId: id('private-valuation-dispatch', '6'),
    scopeKey: factualAuthority.valuationScopeKey,
    trigger: 'weekly' as const,
    scheduledFor: '2026-09-07T09:00:00.000Z',
    authorityKey: '2026-09-07T09:00:00.000Z',
  },
  claim: {
    claimId: id('private-valuation-dispatch-claim', '7'),
    leaseToken: digest('8'),
  },
} as const;

const preparedEvidence = {
  state: 'qualified' as const,
  playerObservationSetId: id('player-observation-set', '9'),
  pickBenchmarkEvidenceId: id('pick-pav-observation-set', 'a'),
  playerRunId: id('model-run', 'b'),
  pickRunId: id('model-run', 'c'),
  qualificationId: id('model-qualification', 'd'),
  qualificationWorkId: id('model-qualification-work', 'e'),
  playerGate3DecisionId: id('gate-decision', 'f'),
  pickGate3DecisionId: id('gate-decision', '0'),
} as const;

function orchestrationResult() {
  const capturedAt = '2026-09-04T03:00:00.000Z';
  return {
    schemaVersion: 'afl-current-valuation-evidence-orchestration-result-v1',
    operationId: id('current-valuation-evidence-orchestration-operation', '8'),
    scopeKey: currentRequest.scopeKey,
    trigger: dispatch.request.trigger,
    stableOperationKey: dispatch.request.requestId,
    state: 'complete',
    stage: 'private_factual_authority',
    currentValuationRefresh: {
      schemaVersion: 'afl-current-valuation-refresh-result-v2',
      operationId: currentRequest.factualOperationId,
      scopeKey: currentRequest.scopeKey,
      trigger: dispatch.request.trigger,
      stableOperationKey: dispatch.request.requestId,
      state: 'factual_refresh_complete',
      factualStage: 'already_current',
      privateFactualAuthority: factualAuthority,
      capturedAt,
      completedAt: capturedAt,
      executionLocation: 'local',
      visibility: 'private',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      limitation: AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION,
    },
    capturedAt,
    completedAt: capturedAt,
    executionLocation: 'local',
    visibility: 'private',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION,
  } as const;
}

class MemoryRepository implements AflTradeCurrentValuationModelEvidenceRepository {
  readonly retained = new Map<string, AflTradeCurrentValuationModelEvidenceResult>();

  async load(operationId: string) {
    return this.retained.get(operationId) ?? null;
  }

  async commit(input: Parameters<AflTradeCurrentValuationModelEvidenceRepository['commit']>[0]) {
    this.retained.set(input.result.operationId, input.result);
    return { state: 'committed' as const, result: input.result };
  }
}

describe('current valuation model-evidence preparation', () => {
  it('binds the exact dispatch and live claim before projecting one qualified pair', async () => {
    const calls: unknown[] = [];
    const preparation = createAflTradeCurrentValuationModelEvidencePreparation({
      dispatch,
      authority: {
        authenticate: async (input) => {
          calls.push({ stage: 'authority', input });
        },
      },
      pair: {
        prepare: async (input) => {
          calls.push({ stage: 'pair', input });
          return {
            state: 'qualified' as const,
            operationId: id('private-valuation-model-operation', '1'),
            attemptNumber: 1,
            qualificationId: preparedEvidence.qualificationId,
          };
        },
      },
      evidence: {
        load: async (input) => {
          calls.push({ stage: 'evidence', input });
          return preparedEvidence;
        },
      },
    });
    const coordinator = createAflTradeCurrentValuationModelEvidenceCoordinator({
      repository: new MemoryRepository(),
      captureCurrentModelRevision: async () => 0,
      prepareAndQualify: preparation.prepareAndQualify,
      clock: { now: () => '2026-09-04T03:00:00.000Z' },
    });

    await expect(coordinator.refresh(currentRequest)).resolves.toMatchObject({
      ...preparedEvidence,
      expectedModelRevision: 0,
      modelRevision: 1,
    });
    expect(calls.map((call) => (call as { stage: string }).stage)).toEqual([
      'authority',
      'pair',
      'evidence',
    ]);
    expect(calls[0]).toMatchObject({
      input: {
        current: expect.objectContaining(currentRequest),
        dispatch,
      },
    });
    expect(calls[1]).toEqual({
      stage: 'pair',
      input: {
        requestId: dispatch.request.requestId,
        claim: dispatch.claim,
      },
    });
    expect(calls[2]).toMatchObject({
      input: {
        current: expect.objectContaining(currentRequest),
        dispatch,
        pair: {
          state: 'qualified',
          qualificationId: preparedEvidence.qualificationId,
        },
      },
    });
  });

  it('leaves retryable pair work nonterminal without loading evidence', async () => {
    let evidenceLoads = 0;
    const preparation = createAflTradeCurrentValuationModelEvidencePreparation({
      dispatch,
      authority: { authenticate: async () => undefined },
      pair: {
        prepare: async () => ({
          state: 'transient_failure' as const,
          operationId: id('private-valuation-model-operation', '1'),
          attemptNumber: 2,
          reason: 'The retained player run is waiting for its next attempt.',
        }),
      },
      evidence: {
        load: async () => {
          evidenceLoads += 1;
          return preparedEvidence;
        },
      },
    });

    const expectedError = {
      name: 'AflTradeCurrentValuationModelEvidencePreparationError',
      state: 'transient_failure',
      operationId: id('private-valuation-model-operation', '1'),
      attemptNumber: 2,
    } satisfies Pick<
      AflTradeCurrentValuationModelEvidencePreparationError,
      'name' | 'state' | 'operationId' | 'attemptNumber'
    >;

    await expect(
      preparation.prepareAndQualify({
        ...currentRequest,
        operationId: id('current-valuation-model-evidence-operation', '2'),
      })
    ).rejects.toMatchObject(expectedError);
    expect(evidenceLoads).toBe(0);
  });

  it('rejects evidence from any qualification other than the retained pair terminal', async () => {
    const preparation = createAflTradeCurrentValuationModelEvidencePreparation({
      dispatch,
      authority: { authenticate: async () => undefined },
      pair: {
        prepare: async () => ({
          state: 'qualified' as const,
          operationId: id('private-valuation-model-operation', '1'),
          attemptNumber: 1,
          qualificationId: id('model-qualification', '1'),
        }),
      },
      evidence: { load: async () => preparedEvidence },
    });

    await expect(
      preparation.prepareAndQualify({
        ...currentRequest,
        operationId: id('current-valuation-model-evidence-operation', '2'),
      })
    ).rejects.toThrow('does not match the exact retained pair qualification');
  });

  it('rejects HPN factual work outside the exact current custody before component execution', async () => {
    let componentExecutions = 0;
    const queryRows = async (sql: string): Promise<readonly Record<string, unknown>[]> => {
      if (sql.includes('FROM outcome_current_valuation_model_evidence_operation')) {
        return [];
      }
      if (sql.includes('FROM outcome_current_governed_valuation_model_pair')) {
        return [];
      }
      if (sql.includes('FROM outcome_current_private_factual_authority head')) {
        return [
          {
            candidate_id: factualAuthority.candidateId,
            revision: factualAuthority.revision,
            valuation_scope_key: factualAuthority.valuationScopeKey,
            evidence_scope_key: factualAuthority.evidenceScopeKey,
            evidence_bundle_id: factualAuthority.evidenceBundleId,
            review_decision_id: factualAuthority.reviewDecisionId,
            normalized_reconciled_custody_sha256:
              factualAuthority.normalizedReconciledCustodySha256,
          },
        ];
      }
      if (sql.includes('FROM outcome_current_valuation_factual_refresh_operation')) {
        return [
          {
            scope_key: currentRequest.scopeKey,
            candidate_id: factualAuthority.candidateId,
            private_factual_revision: factualAuthority.revision,
          },
        ];
      }
      if (sql.includes('load_outcome_current_valuation_evidence')) {
        return [{ result_json: orchestrationResult() }];
      }
      if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
        return [{ request_json: dispatch.request }];
      }
      if (sql.includes('FROM outcome_private_valuation_factual_output factual')) {
        return [{ exact: false }];
      }
      if (sql.startsWith('SET LOCAL ROLE')) return [];
      throw new Error(`Unexpected SQL in current model composition test: ${sql}`);
    };
    const query: AflOutcomeSqlClient['query'] = async <Row = Record<string, unknown>>(
      sql: string
    ) => {
      const rows = await queryRows(sql);
      return { rows: rows as readonly Row[], rowCount: rows.length };
    };
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };
    const coordinator = composePostgresAflTradeCurrentValuationModelEvidenceDispatch({
      client,
      dispatch,
      modelPair: {
        hpnPreparation: {
          prepare: async () => ({
            state: 'prepared' as const,
            requestId: dispatch.request.requestId,
            factualOutputId: id('private-valuation-factual-output', '1'),
            inputSetId: id('hpn-pav-input-set', '2'),
            calculationId: id('hpn-pav-season', '3'),
            captureBindingIds: [],
            sourceAdmissionIds: [],
            publicationEligible: false as const,
          }),
        },
        targets: {
          player: {
            modelId: 'development-grade-model:player',
            modelVersion: 'player-v1',
            protocolId: id('model-protocol', '4'),
            datasetId: id('dataset', '5'),
            datasetAdmissionId: id('dataset-admission', '6'),
          },
          pick: {
            protocolId: id('model-protocol', '7'),
            datasetId: id('dataset', '8'),
            datasetAdmissionId: id('dataset-admission', '9'),
            policyId: id('pick-pav-policy', 'a'),
          },
          qualificationPolicyId: id('model-qualification-policy', 'b'),
        },
        playerExecutor: {
          execute: async () => {
            componentExecutions += 1;
            return { state: 'completed' as const, runId: id('model-run', 'c') };
          },
        },
        pickExecutor: {
          execute: async () => {
            componentExecutions += 1;
            return { state: 'completed' as const, runId: id('model-run', 'd') };
          },
        },
        qualificationRegistrar: {
          register: async () => ({
            qualificationId: id('model-qualification', 'e'),
            outcome: 'qualified' as const,
          }),
        },
      },
    });

    await expect(coordinator.refresh(currentRequest)).rejects.toThrow(
      'outside the exact current custody'
    );
    expect(componentExecutions).toBe(0);
  });
});
