import type { Pool } from 'pg';
import { LOCAL_FITZROY_REHEARSAL_GATE_EVIDENCE } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { LOCAL_FITZROY_RELEASE_REHEARSAL_GATE_EVIDENCE } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualReleaseRehearsal';
import { LOCAL_FIVE_SEASON_AFL_TABLES_GATE_EVIDENCE } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import type {
  AflTradeGateDecisionProposal,
  AflTradeGateDecisionRecord,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeSourceRightsProposal } from '@/server/aflTradeIntelligence/source/sourceRights';
import { retainTestGateEvidenceValues } from './testEvidenceStore';

/**
 * Retains the synthetic evidence the local fitzRoy rehearsals and five-season AFL Tables authorities
 * cite, so their non-production Gate records can be appended (migration 0253).
 */
export async function retainRehearsalGateEvidence(
  target: Pool | AflOutcomeSqlClient
): Promise<void> {
  await retainTestGateEvidenceValues(target, [
    ...LOCAL_FITZROY_REHEARSAL_GATE_EVIDENCE,
    ...LOCAL_FIVE_SEASON_AFL_TABLES_GATE_EVIDENCE,
    ...LOCAL_FITZROY_RELEASE_REHEARSAL_GATE_EVIDENCE,
  ]);
}

/** Retains the rehearsal evidence, then appends one rehearsal source authority to the Gate ledger. */
export async function appendRehearsalSourceAuthority(
  client: AflOutcomeSqlClient,
  authority: {
    sourceRights: AflTradeSourceRightsProposal;
    ledger: {
      proposals: readonly AflTradeGateDecisionProposal[];
      decisions: readonly AflTradeGateDecisionRecord[];
    };
  }
) {
  await retainRehearsalGateEvidence(client);
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  return ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: authority.sourceRights,
        proposal: authority.ledger.proposals[0]!,
        decision: authority.ledger.decisions[0]!,
      },
    ],
  });
}
