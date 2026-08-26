import { describe, expect, it, vi } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner';
import { createAflTradePreparedValuationInputSet } from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';

const digest = (character: string): string => character.repeat(64);
const artifact = (character: string) => ({
  artifactId: `artifact:${digest(character)}`,
  contentSha256: digest(character),
  storageUri: `artifact://sha256/${digest(character)}`,
  mediaType: 'application/json',
  byteLength: 256,
  createdAt: '2026-08-21T09:00:00.000Z',
});

const privateAuthority = {
  dispatchRequestId: `private-valuation-dispatch:${digest('1')}`,
  factualOutputId: `private-valuation-factual-output:${digest('2')}`,
  hpnCalculationId: `hpn-pav-season:${digest('3')}`,
  modelOperationId: `private-valuation-model-operation:${digest('4')}`,
  modelQualificationId: `model-qualification:${digest('5')}`,
  modelQualificationWorkId: `model-qualification-work:${digest('6')}`,
  modelQualificationRevision: 7,
  playerRunId: `model-run:${digest('7')}`,
  pickRunId: `model-run:${digest('8')}`,
} as const;

const prepared = createAflTradePreparedValuationInputSet({
  schemaVersion: 'afl-trade-prepared-valuation-input-set/v3',
  environment: 'non_production',
  scopeKey: 'afl-men:2026-trades',
  factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
  factualReleaseId: `outcome-release:${digest('9')}`,
  factualReleaseArtifact: artifact('a'),
  releaseMembershipArtifact: artifact('b'),
  preparationAuthority: 'dispatch_bound_private_factual_output',
  preparationOperationId: `valuation-cohort-preparation-operation:${digest('f')}`,
  privateAuthority,
  qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
  valuationInputBundleId: `valuation-input-bundle:${digest('c')}`,
  valuationInputBundleArtifact: artifact('c'),
  releaseTradeIds: ['trade-a', 'trade-b'],
  entries: [
    {
      tradeId: 'trade-a',
      state: 'ready',
      materializationManifestId: `private-evaluation-materialization-manifest:${digest('d')}`,
      materializationManifestArtifact: artifact('d'),
    },
    {
      tradeId: 'trade-b',
      state: 'blocked',
      blockers: [
        {
          code: 'component_output_unavailable',
          subject: { kind: 'trade', id: 'trade-b' },
          evidenceRefs: [artifact('e')],
        },
      ],
    },
  ],
  tradeCount: 2,
  readyCount: 1,
  blockedCount: 1,
  preparedAt: '2026-08-21T09:00:00.000Z',
  publicationEligible: false,
  limitation:
    'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
});

class RepairTransaction implements AflOutcomeSqlTransaction {
  async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL')) return { rows: [], rowCount: 0 };
    if (sql.includes('prepared.prepared_set_json AS input_set_json')) {
      return {
        rows: [
          {
            input_set_json: prepared,
            prepared_revision: 11,
            model_pair_revision: privateAuthority.modelQualificationRevision,
          },
        ],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_prepared_valuation_input_entry')) {
      return {
        rows: prepared.content.entries.map((entry) => ({
          trade_id: entry.tradeId,
          state: entry.state,
          entry_json: entry,
        })),
        rowCount: prepared.content.entries.length,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgreSQL current valuation cohort repair', () => {
  it('opens repair against exact private prepared authority without public release capture', async () => {
    const transaction = new RepairTransaction();
    const client: AflOutcomeSqlClient = {
      query: transaction.query.bind(transaction),
      transaction: async (work) => work(transaction),
    };
    const repaired = { cycleId: `cohort-execution-cycle:${digest('f')}` };
    const openRepair = vi.fn(async () => repaired);
    const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client,
      workspace: {} as never,
      batchRepository: {} as never,
      executionRepository: {
        loadRepair: vi.fn(async () => null),
        openRepair,
      } as never,
    });
    const repairOperationId = `cohort-execution-repair:${digest('0')}`;

    await expect(
      runner.repairCurrent(
        'afl-men:2026-trades',
        'The retained private execution outage was corrected.',
        repairOperationId
      )
    ).resolves.toBe(repaired);
    expect(openRepair).toHaveBeenCalledWith({
      authority: {
        preparationAuthority: 'dispatch_bound_private_factual_output',
        scopeKey: 'afl-men:2026-trades',
        preparedInputSetId: prepared.preparedInputSetId,
        preparedInputSetRevision: 11,
        modelQualificationWorkId: privateAuthority.modelQualificationWorkId,
        modelPairRevision: privateAuthority.modelQualificationRevision,
        privateAuthority,
      },
      readyTradeIds: ['trade-a'],
      repairOperationId,
      reason: 'The retained private execution outage was corrected.',
    });
  });
});
