import { expect, it } from 'vitest';
import { createAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';
import {
  PostgresAflTradePrivateValuationHpnFactualPreparation,
  loadAflTradePrivateValuationHpnFactualBinding,
  findAflTradePrivateValuationHpnFactualBinding,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnFactualBinding';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

it('distinguishes unbound legacy factual preparation from unavailable required HPN authority', async () => {
  const sql: AflOutcomeSqlClient = {
    query: async <Row>() => ({ rows: [{ binding_json: null }] as Row[], rowCount: 1 }),
    transaction: async (work) => work(sql),
  };
  const request = {
    requestId: `private-valuation-dispatch:${'1'.repeat(64)}`,
    factualOutputId: `private-valuation-factual-output:${'2'.repeat(64)}`,
  };
  await expect(findAflTradePrivateValuationHpnFactualBinding(sql, request)).resolves.toBeNull();
  await expect(loadAflTradePrivateValuationHpnFactualBinding(sql, request)).rejects.toThrow(
    'unavailable'
  );
});

// Synthetic SQL boundary: document/adapter composition, not SQL authority proof.
it('retains an explicit source-first binding to a separate HPN run without a reviewed-corpus identity', async () => {
  const sha = (value: string) => value.repeat(64);
  const output = createAflTradePrivateValuationFactualOutput({
    requestId: `private-valuation-dispatch:${sha('1')}`,
    valuationScopeKey: 'afl-men:2025-trades',
    captureBindingId: `private-valuation-capture-binding:${sha('2')}`,
    sourceAdmissionId: `private-valuation-source-admission:${sha('3')}`,
    normalizationRunId: `provider-normalization-run:${sha('4')}`,
    factBatch: { batchId: `source-fact-batch:${sha('5')}`, batchSha256: sha('5') },
    reconciliation: {
      factualRunId: `factual-reconciliation-run:${sha('6')}`,
      runSha256: sha('6'),
      outputSetSha256: sha('7'),
      finalizedAt: '2026-09-02T00:00:00.000Z',
    },
    spellMetricBatches: [
      { batchId: `acquisition-spell-metric-batch:${sha('8')}`, batchSha256: sha('8') },
    ],
    candidate: {
      candidateId: `factual-release-candidate:${sha('9')}`,
      candidateSha256: sha('9'),
      memberSetSha256: sha('a'),
    },
    factualRelease: { releaseId: `outcome-release:${sha('b')}`, releaseSha256: sha('b') },
    preparedAt: '2026-09-02T00:01:00.000Z',
  });
  const binding = {
    authorityKind: 'source_first' as const,
    requestId: output.content.requestId,
    factualOutputId: output.outputId,
    sourceAdmissionId: output.content.sourceAdmissionId,
    hpnFactualRunId: `factual-reconciliation-run:${sha('c')}`,
    hpnInputSetSha256: sha('d'),
    hpnFinalizedAt: '2026-09-02T00:01:00.000Z',
  };
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string) {
      const rows = statement.includes('hpn_factual_input')
        ? [{ binding_json: binding }]
        : statement.includes('factual_output')
          ? [{ output_json: output }]
          : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: async (work) => work(sql),
  };
  const sourcePreparation = new PostgresAflTradePrivateFactualPreparation(sql, {
    prepareSourceEvidence: async () => {
      throw new Error('Retained source output must replay');
    },
    prepareCandidate: async () => {
      throw new Error('Retained candidate must replay');
    },
  });
  const adapter = new PostgresAflTradePrivateValuationHpnFactualPreparation(
    sql,
    {
      authorityKind: 'source_first',
      hpnFactualRunId: binding.hpnFactualRunId,
    },
    sourcePreparation
  );
  await expect(
    adapter.prepare({
      requestId: output.content.requestId,
      claim: { claimId: `private-valuation-dispatch-claim:${sha('e')}`, leaseToken: sha('f') },
    })
  ).resolves.toEqual({ state: 'already_prepared', output });
  await expect(
    loadAflTradePrivateValuationHpnFactualBinding(sql, {
      requestId: output.content.requestId,
      factualOutputId: output.outputId,
    })
  ).resolves.toEqual(binding);
});
