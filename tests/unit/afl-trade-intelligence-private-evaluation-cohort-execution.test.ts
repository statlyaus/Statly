import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY,
  classifyAflTradePrivateEvaluationExecutionError,
  createAflTradePrivateEvaluationCohortExecutionCycle,
  createAflTradePrivateEvaluationCohortInputFingerprint,
} from '@/server/aflTradeIntelligence/valuation/privateEvaluationCohortExecution';
import { PostgresAflTradePrivateEvaluationCohortExecutionRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationCohortExecutionRepository';

const digest = (marker: string) => marker.repeat(64);
const authority = {
  scopeKey: 'afl-men:2026-trades',
  preparedInputSetId: `prepared-valuation-input-set:${digest('1')}`,
  preparedInputSetRevision: 4,
  factualReleaseRevision: 3,
  modelQualificationWorkId: `model-qualification-work:${digest('2')}`,
  modelPairRevision: 5,
} as const;
const privateAuthority = {
  scopeKey: 'afl-men:2026-trades',
  preparedInputSetId: `prepared-valuation-input-set:${digest('3')}`,
  preparedInputSetRevision: 7,
  preparationOperationId: `valuation-cohort-preparation-operation:${digest('4')}`,
  currentModelEvidenceOperationId: `current-valuation-model-evidence-operation:${digest('5')}`,
  dispatchAuthority: {
    requestId: `private-valuation-dispatch:${digest('6')}`,
    factualOutputId: `private-valuation-factual-output:${digest('7')}`,
    hpnCalculationId: `hpn-pav-season:${digest('8')}`,
    modelOperationId: `private-valuation-model-operation:${digest('9')}`,
  },
  modelQualificationWorkId: `model-qualification-work:${digest('a')}`,
  modelPairRevision: 8,
} as const;

interface SqlCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function recordingExecutionClient(): {
  readonly calls: SqlCall[];
  readonly client: AflOutcomeSqlClient;
} {
  const calls: SqlCall[] = [];
  let retainedCycle: unknown;
  const query: AflOutcomeSqlClient['query'] = async <Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ) => {
    calls.push({ sql, parameters });
    let rows: readonly unknown[] = [];
    if (sql.includes('INSERT INTO outcome_private_evaluation_execution_cycle')) {
      retainedCycle = JSON.parse(String(parameters.at(-1)));
    } else if (sql.includes('WHERE cycle_id=$1') && sql.includes('SELECT cycle_json')) {
      rows = [{ cycle_json: retainedCycle }];
    }
    return { rows: rows as readonly Row[], rowCount: rows.length };
  };
  return {
    calls,
    client: {
      query,
      transaction: async (work) => work({ query }),
    },
  };
}

describe('private evaluation cohort durable execution policy', () => {
  it('fixes bounded local execution to three persisted attempts', () => {
    expect(AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY).toEqual({
      schemaVersion: 'private-evaluation-cohort-execution-policy/v1',
      maximumAttemptsPerCycle: 3,
      maximumConcurrency: 8,
      leaseSeconds: 120,
      heartbeatSeconds: 30,
      retryBaseSeconds: 5,
      retryMaximumSeconds: 60,
      concurrencyPolicy: 'bounded_local_workers',
    });
  });

  it('opens a new automatic cycle only when authenticated inputs change', () => {
    const first = createAflTradePrivateEvaluationCohortInputFingerprint(authority);
    expect(first).toBe(
      'cohort-execution-input:0298291a536e7aba5c56e234df6433028dcb7741c12aeb791afe27799039ec9a'
    );
    expect(createAflTradePrivateEvaluationCohortInputFingerprint(authority)).toBe(first);
    expect(
      createAflTradePrivateEvaluationCohortInputFingerprint({
        ...authority,
        preparedInputSetRevision: authority.preparedInputSetRevision + 1,
      })
    ).not.toBe(first);

    const cycle = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 0,
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    expect(cycle.content).toMatchObject({
      inputFingerprint: first,
      repairSequence: 0,
      openingCause: 'authenticated_inputs_changed',
      openingPrincipalId: 'system:weekly-valuation-coordinator',
      repairOperationId: null,
      repairReason: null,
      maximumAttemptsPerTrade: 3,
      publicationEligible: false,
    });
  });

  it('binds private prepared-v3 ancestry without retaining dispatch claim custody', () => {
    const first = createAflTradePrivateEvaluationCohortInputFingerprint(privateAuthority);
    expect(first).toBe(
      'cohort-execution-input:8bdaaa24a05a507614694012a6ceed3fc808aaa567360c2f782d176efe38033f'
    );
    expect(
      createAflTradePrivateEvaluationCohortInputFingerprint({
        ...privateAuthority,
        dispatchAuthority: {
          ...privateAuthority.dispatchAuthority,
          factualOutputId: `private-valuation-factual-output:${digest('b')}`,
        },
      })
    ).not.toBe(first);

    const cycle = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority: privateAuthority,
      repairSequence: 0,
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    expect(cycle.content.authority).toEqual(privateAuthority);
    expect(cycle.content.authority).not.toHaveProperty('claim');

    const authorityWithClaim = {
      ...privateAuthority,
      claim: {
        claimId: `private-valuation-dispatch-claim:${digest('c')}`,
        leaseToken: digest('d'),
      },
    } as unknown as typeof privateAuthority;
    expect(() =>
      createAflTradePrivateEvaluationCohortExecutionCycle({
        authority: authorityWithClaim,
        repairSequence: 0,
        openedAt: '2026-08-21T10:00:00.000Z',
      })
    ).toThrow();
  });

  it('persists private prepared-v3 authority without dispatch claim custody', async () => {
    const fixture = recordingExecutionClient();
    const repository = new PostgresAflTradePrivateEvaluationCohortExecutionRepository(
      fixture.client
    );

    const cycle = await repository.openAutomatic({
      authority: privateAuthority,
      readyTradeIds: [],
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    const insertion = fixture.calls.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_private_evaluation_execution_cycle')
    );
    expect(insertion).toBeDefined();
    expect(insertion!.sql.replaceAll(/\s+/g, ' ')).toContain(
      'prepared_input_set_revision,preparation_authority,factual_release_revision, preparation_operation_id,current_model_evidence_operation_id,dispatch_request_id, factual_output_id,hpn_calculation_id,model_operation_id, model_qualification_work_id,model_pair_revision'
    );
    expect(insertion!.parameters.slice(0, -1)).toEqual([
      cycle.cycleId,
      cycle.content.inputFingerprint,
      privateAuthority.scopeKey,
      privateAuthority.preparedInputSetId,
      privateAuthority.preparedInputSetRevision,
      'qualified_current_model_evidence',
      null,
      privateAuthority.preparationOperationId,
      privateAuthority.currentModelEvidenceOperationId,
      privateAuthority.dispatchAuthority.requestId,
      privateAuthority.dispatchAuthority.factualOutputId,
      privateAuthority.dispatchAuthority.hpnCalculationId,
      privateAuthority.dispatchAuthority.modelOperationId,
      privateAuthority.modelQualificationWorkId,
      privateAuthority.modelPairRevision,
      cycle.content.repairSequence,
      cycle.content.openingCause,
      cycle.content.openingPrincipalId,
      cycle.content.repairOperationId,
      cycle.content.repairReason,
      cycle.content.repairsCycleId,
      cycle.content.maximumAttemptsPerTrade,
      cycle.content.openedAt,
    ]);
    expect(JSON.parse(String(insertion!.parameters.at(-1)))).toEqual(cycle);
    expect(insertion!.sql).not.toMatch(/claim_id|lease_token|lease_expires_at/iu);
  });

  it('preserves public execution custody while leaving private lineage empty', async () => {
    const fixture = recordingExecutionClient();
    const repository = new PostgresAflTradePrivateEvaluationCohortExecutionRepository(
      fixture.client
    );

    const cycle = await repository.openAutomatic({
      authority,
      readyTradeIds: [],
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    const insertion = fixture.calls.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_private_evaluation_execution_cycle')
    );
    expect(insertion?.parameters.slice(0, 15)).toEqual([
      cycle.cycleId,
      cycle.content.inputFingerprint,
      authority.scopeKey,
      authority.preparedInputSetId,
      authority.preparedInputSetRevision,
      'authenticated_calculation_evidence_snapshot',
      authority.factualReleaseRevision,
      null,
      null,
      null,
      null,
      null,
      null,
      authority.modelQualificationWorkId,
      authority.modelPairRevision,
    ]);
    expect(cycle.content.authority).toEqual(authority);
  });

  it('opens an explicit repair cycle without changing or deleting prior history', () => {
    const original = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 0,
      openedAt: '2026-08-21T10:00:00.000Z',
    });
    const repair = createAflTradePrivateEvaluationCohortExecutionCycle({
      authority,
      repairSequence: 1,
      openedAt: '2026-08-21T11:00:00.000Z',
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      repairReason: 'Retry after the retained upstream outage was corrected.',
    });

    expect(repair.cycleId).not.toBe(original.cycleId);
    expect(repair.content.inputFingerprint).toBe(original.content.inputFingerprint);
    expect(repair.content).toMatchObject({
      repairSequence: 1,
      openingCause: 'explicit_repair',
      openingPrincipalId: 'system:weekly-valuation-coordinator',
      repairOperationId: `cohort-execution-repair:${digest('9')}`,
      repairReason: 'Retry after the retained upstream outage was corrected.',
      repairsCycleId: original.cycleId,
    });
  });

  it('classifies only bounded infrastructure failures as transient', () => {
    expect(
      classifyAflTradePrivateEvaluationExecutionError(
        Object.assign(new Error('serialization conflict'), { code: '40001' })
      )
    ).toEqual({
      code: 'postgres_40001',
      message: 'serialization conflict',
      retryable: true,
    });
    expect(
      classifyAflTradePrivateEvaluationExecutionError(
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      )
    ).toEqual({
      code: 'transport_ECONNRESET',
      message: 'connection reset',
      retryable: true,
    });
    expect(
      classifyAflTradePrivateEvaluationExecutionError(new TypeError('bad custody'))
    ).toBeNull();
  });
});
