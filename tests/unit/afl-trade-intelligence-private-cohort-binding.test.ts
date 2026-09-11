import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationCohortBinding } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCohortBinding';

const hash = 'a'.repeat(64);
const id = (prefix: string) => `${prefix}:${hash}`;
const selection = {
  requestId: id('private-valuation-dispatch'),
  claim: { claimId: id('private-valuation-dispatch-claim'), leaseToken: hash },
  lineageAdmissionId: id('corpus-factual-lineage-admission'),
};
const retained = {
  requestId: selection.requestId,
  factualOutputId: id('private-valuation-factual-output'),
  factualOperationId: id('current-valuation-factual-refresh-operation'),
  privateFactualCandidateId: id('private-factual-candidate'),
  privateFactualRevision: 1,
  lineageAdmissionId: selection.lineageAdmissionId,
  lineageId: id('corpus-factual-lineage'),
  corpusId: id('corpus'),
  cohortCandidateId: id('factual-release-candidate'),
  cohortReleaseId: id('outcome-release'),
  cohortScopeKey: 'afl-men:2025-trades',
  sourceMemberSetSha256: hash,
  canonicalMemberSetSha256: hash,
  sourceCaptureSetSha256: hash,
  promotionSourceSetSha256: hash,
  effectiveThrough: '2026-08-01T00:00:00.000Z',
  cohortTradeIds: ['event-version:2025-trade'],
};

function clientFor(binding: unknown): AflOutcomeSqlClient {
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string) {
      if (sql.startsWith('SET LOCAL ROLE') || sql.includes('dispatch_request_for_claim')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ binding_json: binding }] as Row[], rowCount: 1 };
    },
    async transaction(work) {
      return work(client);
    },
  };
  return client;
}

describe('private target-cohort binding adapter', () => {
  it('returns the exact authenticated independent cohort selection', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(clientFor(retained));
    await expect(binding.bind(selection)).resolves.toEqual(retained);
    await expect(binding.load(selection)).resolves.toEqual(retained);
  });
  it('rejects substitution of the selected lineage admission', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(
      clientFor({
        ...retained,
        lineageAdmissionId: `corpus-factual-lineage-admission:${'b'.repeat(64)}`,
      })
    );
    await expect(binding.bind(selection)).rejects.toThrow('another selected lineage admission');
  });
  it('reports an absent binding without treating it as cohort authority', async () => {
    const binding = new PostgresAflTradePrivateValuationCohortBinding(clientFor(null));
    await expect(binding.load(selection)).resolves.toBeNull();
    await expect(binding.bind(selection)).rejects.toThrow('Cohort selection was not retained');
  });
});
