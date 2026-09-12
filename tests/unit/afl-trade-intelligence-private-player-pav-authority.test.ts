import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PostgresAflTradePrivatePlayerPavAuthority } from '@/server/aflTradeIntelligence/valuation/postgresPrivatePlayerPavAuthority';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const digest = (marker: string) => createHash('sha256').update(marker).digest('hex');
const addressed = (prefix: string, marker: string) => `${prefix}:${digest(marker)}`;

const requestId = addressed('private-valuation-dispatch', 'request');
const claimId = addressed('private-valuation-dispatch-claim', 'claim');
const leaseToken = digest('lease');
const policyId = addressed('player-pav-policy', 'policy');
const lineageAdmissionId = addressed('corpus-factual-lineage-admission', 'lineage-admission');
const binding = {
  requestId,
  factualOutputId: addressed('private-valuation-factual-output', 'factual-output'),
  policyId,
  policyApprovalDecisionId: addressed('review-decision', 'policy-approval'),
  lineageAdmissionId,
  lineageId: addressed('corpus-factual-lineage', 'lineage'),
  corpusId: addressed('corpus', 'corpus'),
  releaseId: addressed('outcome-release', 'release'),
  methodId: addressed('hpn-pav-method', 'method'),
  knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
  featureHistorySeasons: 1,
  fixedHorizonSeasons: 1,
  predictionSeasons: [2018, 2020, 2022, 2024],
  requiredMeasurementSeasons: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  sourceMemberSetSha256: digest('source-members'),
  canonicalMemberSetSha256: digest('canonical-members'),
} as const;

class FakeSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  calls: Array<{ readonly sql: string; readonly parameters: readonly unknown[] }> = [];

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    return {
      rows: [{ binding_json: binding }] as Row[],
      rowCount: 1,
    };
  }
}

describe('private player-PAV authority', () => {
  it('binds one live dispatch to exact policy and historical corpus authority', async () => {
    const sql = new FakeSql();
    const authority = new PostgresAflTradePrivatePlayerPavAuthority(sql);

    await expect(
      authority.bind({
        requestId,
        claim: { claimId, leaseToken },
        policyId,
        lineageAdmissionId,
      })
    ).resolves.toEqual(binding);

    expect(sql.calls).toEqual([
      {
        sql: 'SET LOCAL ROLE afl_trade_private_evaluation_coordinator',
        parameters: [],
      },
      {
        sql: expect.stringContaining('bind_outcome_private_player_pav_authority'),
        parameters: [requestId, claimId, digest(leaseToken), policyId, lineageAdmissionId],
      },
    ]);
  });
});
