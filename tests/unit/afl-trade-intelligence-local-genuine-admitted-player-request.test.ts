import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { runLocalAflTradeGenuineAdmittedPlayerRequest } from '@/server/aflTradeIntelligence/development/localGenuineAdmittedPlayerRequest';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradePrivateValuationModelOperation } from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) =>
  createAflTradeContentAddress(prefix, { value });

function operation(scopeKey = 'afl-men:2025-trades') {
  return createAflTradePrivateValuationModelOperation({
    scopeKey,
    factualValuesSha256: sha('factual'),
    hpnValuesSha256: sha('hpn'),
    hpnMethodId: addressed('hpn-pav-method', 'method'),
    player: {
      modelId: 'afl-player-contribution',
      modelVersion: '1',
      protocolId: addressed('model-protocol', 'player'),
      datasetId: addressed('dataset', 'player'),
      datasetAdmissionId: addressed('dataset-admission', 'player'),
    },
    pick: {
      protocolId: addressed('model-protocol', 'pick'),
      datasetId: addressed('dataset', 'pick'),
      datasetAdmissionId: addressed('dataset-admission', 'pick'),
      policyId: addressed('pick-pav-policy', 'pick'),
    },
    qualificationPolicyId: addressed('model-qualification-policy', 'pair'),
  });
}

function clientFor(row: Record<string, unknown>): AflOutcomeSqlClient {
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string) {
      if (sql.startsWith('SET LOCAL ROLE')) return { rows: [], rowCount: 0 };
      if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
        return { rows: [{}] as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_private_valuation_model_request_binding')) {
        expect(sql).toContain('attempt.claim_id=request.claim_id');
        expect(sql).not.toContain('binding.claim_id=$2');
        return { rows: [row] as Row[], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    query: transaction.query,
    transaction: async <T>(work: (scope: AflOutcomeSqlTransaction) => Promise<T>) =>
      work(transaction),
  };
}

describe('local genuine admitted-player request entry point', () => {
  it('derives all model authority from the retained request operation', async () => {
    const retainedOperation = operation();
    const requestId = addressed('private-valuation-dispatch', 'request');
    const claim = {
      claimId: addressed('private-valuation-dispatch-claim', 'claim'),
      leaseToken: sha('lease'),
    };
    const execute = vi.fn().mockResolvedValue({ state: 'completed', runId: 'model-run:retained' });

    const result = await runLocalAflTradeGenuineAdmittedPlayerRequest({
      sql: clientFor({
        scope_key: retainedOperation.content.scopeKey,
        operation_json: retainedOperation,
        factual_output_id: addressed('private-valuation-factual-output', 'factual'),
        hpn_calculation_id: addressed('hpn-pav-season', 'hpn'),
        attempt_number: 2,
      }),
      executor: { execute },
      requestId,
      claim,
    });

    expect(result).toEqual({ state: 'completed', runId: 'model-run:retained' });
    expect(execute).toHaveBeenCalledWith({
      exactInput: {
        requestId,
        scopeKey: retainedOperation.content.scopeKey,
        factualOutputId: addressed('private-valuation-factual-output', 'factual'),
        hpnCalculationId: addressed('hpn-pav-season', 'hpn'),
        substantive: {
          factualValuesSha256: retainedOperation.content.factualValuesSha256,
          hpnValuesSha256: retainedOperation.content.hpnValuesSha256,
          hpnMethodId: retainedOperation.content.hpnMethodId,
          player: retainedOperation.content.player,
          pick: retainedOperation.content.pick,
          qualificationPolicyId: retainedOperation.content.qualificationPolicyId,
        },
      },
      operation: retainedOperation,
      attemptNumber: 2,
      claim,
    });
  });

  it('rejects a retained operation from another valuation scope', async () => {
    await expect(
      runLocalAflTradeGenuineAdmittedPlayerRequest({
        sql: clientFor({
          scope_key: 'afl-men:2025-trades',
          operation_json: operation('afl-men:2024-trades'),
          factual_output_id: addressed('private-valuation-factual-output', 'factual'),
          hpn_calculation_id: addressed('hpn-pav-season', 'hpn'),
          attempt_number: 1,
        }),
        executor: { execute: vi.fn() },
        requestId: addressed('private-valuation-dispatch', 'request'),
        claim: {
          claimId: addressed('private-valuation-dispatch-claim', 'claim'),
          leaseToken: sha('lease'),
        },
      })
    ).rejects.toThrow('exact retained player operation');
  });

  it('uses the replacement claim attempt without rewriting the immutable operation binding', async () => {
    const retainedOperation = operation();
    const execute = vi.fn().mockResolvedValue({ state: 'completed', runId: 'model-run:retained' });

    await runLocalAflTradeGenuineAdmittedPlayerRequest({
      sql: clientFor({
        scope_key: retainedOperation.content.scopeKey,
        operation_json: retainedOperation,
        factual_output_id: addressed('private-valuation-factual-output', 'factual'),
        hpn_calculation_id: addressed('hpn-pav-season', 'hpn'),
        attempt_number: 3,
      }),
      executor: { execute },
      requestId: addressed('private-valuation-dispatch', 'request'),
      claim: {
        claimId: addressed('private-valuation-dispatch-claim', 'replacement-claim'),
        leaseToken: sha('replacement-lease'),
      },
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 3 }));
  });
});
