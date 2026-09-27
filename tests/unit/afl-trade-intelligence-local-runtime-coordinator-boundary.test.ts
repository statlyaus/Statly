import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalAflTradePrivateValuationRuntime } from '@/server/aflTradeIntelligence/development/localPrivateValuationRuntime';
import type { AflOutcomePgPool } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  aflTradeCurrentValuationEvidenceOrchestrationResultSchema,
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION,
} from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;
const request = {
  requestId: id('private-valuation-dispatch'),
  scopeKey: 'afl-men:2025-trades',
  trigger: 'ad_hoc' as const,
  scheduledFor: '2026-09-02T00:00:00.000Z',
  authorityKey: 'synthetic-runtime-boundary',
};
function retainedFacts() {
  const common = {
    scopeKey: request.scopeKey,
    trigger: request.trigger,
    stableOperationKey: request.requestId,
    capturedAt: request.scheduledFor,
    completedAt: request.scheduledFor,
    executionLocation: 'local',
    visibility: 'private',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
  };
  return aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse({
    ...common,
    schemaVersion: 'afl-current-valuation-evidence-orchestration-result-v1',
    operationId: id('current-valuation-evidence-orchestration-operation'),
    state: 'complete',
    stage: 'private_factual_authority',
    limitation: AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION,
    currentValuationRefresh: {
      ...common,
      schemaVersion: 'afl-current-valuation-refresh-result-v2',
      operationId: id('current-valuation-factual-refresh-operation'),
      state: 'factual_refresh_complete',
      factualStage: 'advanced',
      limitation: AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION,
      privateFactualAuthority: {
        valuationScopeKey: request.scopeKey,
        candidateId: id('private-factual-candidate'),
        evidenceScopeKey: 'synthetic-runtime-source',
        evidenceBundleId: id('private-reviewed-evidence-bundle'),
        reviewDecisionId: id('private-reviewed-evidence-evaluation-decision'),
        normalizedReconciledCustodySha256: 'a'.repeat(64),
        revision: 1,
      },
    },
  });
}

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

// Real runtime and internal owners; only PostgreSQL responses are synthetic.
describe('local runtime recalculation wiring', () => {
  it('refuses changed factual work without exact model and cohort construction configuration', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'statly-runtime-coordinator-'));
    directories.push(artifactRoot);
    const statements: string[] = [];
    const pool: AflOutcomePgPool = {
      async query(sql, parameters) {
        statements.push(sql);
        let rows: unknown[] = [];
        if (sql.includes('claim_outcome_private_valuation_dispatch'))
          rows = [
            {
              request_id: request.requestId,
              request_json: request,
              claim_id: id('private-valuation-dispatch-claim'),
              lease_expires_at: '2026-09-02T00:02:00.000Z',
            },
          ];
        else if (sql.includes('load_outcome_current_valuation_evidence')) {
          expect(parameters).toEqual([request.scopeKey, request.trigger, request.requestId]);
          rows = [{ retained_source_keys: [], result_json: retainedFacts() }];
        } else if (!/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/u.test(sql)) {
          throw new Error(`Unexpected database operation before model preparation: ${sql}`);
        }
        return { rows, rowCount: rows.length };
      },
      async connect() {
        return { query: pool.query, release() {} };
      },
    };
    const runtime = createLocalAflTradePrivateValuationRuntime({ pool, artifactRoot });
    await expect(runtime.dispatchOne()).rejects.toMatchObject({
      code: 'MISSING_CONSTRUCTION_CONFIGURATION',
    });
    expect(
      statements.some((sql) => /private_evaluation_batch|current_prepared_valuation/u.test(sql))
    ).toBe(false);
  });

  it('names the composition root blockers in the configuration failure', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'statly-runtime-coordinator-'));
    directories.push(artifactRoot);
    const blockers = [
      {
        code: 'cohort_trade_construction_owner_missing',
        subject: { kind: 'owner' as const, id: 'private-cohort-trade-construction' },
        reason: 'No genuine evidence-derived per-trade valuation-input assembly owner exists yet.',
      },
      {
        code: 'hpn_source_authority_missing',
        subject: { kind: 'source_role' as const, id: 'hpn_corroborating_player_stats' },
        reason: 'No exact reviewed corroborating player-stat authority is configured.',
      },
    ];
    const pool: AflOutcomePgPool = {
      async query(sql) {
        if (sql.includes('claim_outcome_private_valuation_dispatch'))
          return {
            rows: [
              {
                request_id: request.requestId,
                request_json: request,
                claim_id: id('private-valuation-dispatch-claim'),
                lease_expires_at: '2026-09-02T00:02:00.000Z',
              },
            ],
            rowCount: 1,
          };
        if (sql.includes('load_outcome_current_valuation_evidence'))
          return {
            rows: [{ retained_source_keys: [], result_json: retainedFacts() }],
            rowCount: 1,
          };
        if (!/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/u.test(sql)) {
          throw new Error(`Unexpected database operation before model preparation: ${sql}`);
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return { query: pool.query, release() {} };
      },
    };
    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool,
      artifactRoot,
      constructionBlockers: blockers,
    });
    const failure = await runtime.dispatchOne().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'MISSING_CONSTRUCTION_CONFIGURATION',
      blockerCodes: ['cohort_trade_construction_owner_missing', 'hpn_source_authority_missing'],
      blockers,
    });
    expect((failure as Error).message).toContain('cohort_trade_construction_owner_missing');
    expect((failure as Error).message).toContain('hpn_source_authority_missing');
  });
});
