import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
  createAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionRequest,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';

const evidenceId = `external-evidence:${'e'.repeat(64)}`;
const batchId = `external-evidence-batch:${'b'.repeat(64)}`;
const approvalDecisionId = `review-decision:${'a'.repeat(64)}`;
const transactionId = createAflTradeContentAddress('external-transaction', {
  provider: 'draftguru',
  nativeEventId: '2025-gws-bulldogs',
});
const transferId = createAflTradeContentAddress('external-transfer', {
  transactionId,
  nativeTransferId: 'pick-14',
});
const pickId = createAflTradeContentAddress('draft-pick', {
  draftYear: 2025,
  draftType: 'national',
  nominalPick: 14,
  nominalRound: 1,
});
const custodyId = createAflTradeContentAddress('external-pick-custody', { evidenceId });

function fixture() {
  const candidate = createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: '2025-gws-bulldogs',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: 'GWS and Western Bulldogs exchange picks',
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: 'club-gws',
        toClubId: 'club-western-bulldogs',
        asset: {
          kind: 'pick_entitlement',
          pickId,
          draftYear: 2025,
          draftType: 'national',
          nominalRound: 1,
          nominalPick: 14,
          originalClubId: 'club-gws',
          recordedLabel: 'Pick 14',
        },
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    draftSelections: [],
    pickCustody: [
      {
        custodyId,
        pickId,
        observedAt: '2025-11-01T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 19,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    pickLineage: [],
    issues: [],
    reconciledAt: '2026-08-09T07:30:00.000Z',
    publicationEligible: false,
  });
  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1],
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftEventCoverage: [],
    transactionDateCoverage: [{ transactionId, seasonYear: 2025, occurredOn: '2025-10-15' }],
    proposedAt: '2026-08-09T07:31:00.000Z',
    publicationEligible: false,
  });
  return { candidate, proposal };
}

function fakeClient(options?: { replay?: boolean }) {
  const { candidate, proposal } = fixture();
  const statements: string[] = [];
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push(sql);
    queries.push({ sql, parameters });
    if (sql.includes('FROM outcome_external_canonical_promotion') && sql.includes('candidate_id')) {
      const receipt = createAflTradeExternalCanonicalPromotionRequest({
        candidateId: candidate.candidateId,
        proposalId: proposal.proposalId,
        approvalDecisionId,
      });
      return options?.replay
        ? {
            rows: [
              {
                promotion_id: receipt.promotionId,
                candidate_id: candidate.candidateId,
                proposal_id: proposal.proposalId,
                approval_decision_id: approvalDecisionId,
                status: 'finalized',
                receipt_json: receipt,
                transaction_count: 1,
                transfer_count: 1,
                draft_selection_count: 0,
                draft_player_asset_count: 0,
                pick_custody_count: 1,
                pick_realization_count: 0,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_external_reconciliation_candidate')) {
      return {
        rows: [
          {
            status: 'finalized',
            finalized_at: candidate.content.reconciledAt,
            issue_count: 0,
            candidate_json: candidate,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_review_decision') && sql.includes('decision_id=$1')) {
      return {
        rows: [
          {
            decision_id: approvalDecisionId,
            subject_type: 'external_reconciliation_candidate',
            subject_id: candidate.candidateId,
            decision: 'approved',
            decided_at: '2026-08-09T07:32:00.000Z',
            current: true,
            evidence_json: {
              schemaVersion: 'afl-trade-external-canonical-promotion-approval/v1',
              proposalId: proposal.proposalId,
              proposalSha256: proposal.proposalId.split(':')[1],
              proposal,
              authorityEvidenceId: `reviewer-authority-evidence:${'f'.repeat(64)}`,
            },
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_external_reconciliation_source_batch')) {
      return {
        rows: [
          {
            evidence_id: evidenceId,
            batch_id: batchId,
            capture_id: 'capture-fixture',
            anchor_season_year: 2025,
            season_years: [2025],
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_external_reconciliation_identity_resolution')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_competition_season')) {
      return { rows: [{ season_year: 2025 }], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_club')) {
      return {
        rows: [{ club_id: 'club-gws' }, { club_id: 'club-western-bulldogs' }],
        rowCount: 2,
      };
    }
    if (sql.includes('FROM outcome_event_version') && sql.includes('superseded_by')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT event_id FROM outcome_event')) {
      return { rows: [{ event_id: parameters[0] }], rowCount: 1 };
    }
    if (sql.includes('SELECT pick_id FROM outcome_draft_pick')) {
      return { rows: [{ pick_id: parameters[0] }], rowCount: 1 };
    }
    if (sql.includes('SELECT custody_observation_id FROM outcome_pick_custody_observation')) {
      return { rows: [{ custody_observation_id: parameters[0] }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE outcome_external_canonical_promotion')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  const client = {
    query,
    transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
      work({ query }),
  } as AflOutcomeSqlClient;
  return { client, statements, queries };
}

describe('PostgresAflTradeExternalCanonicalPromotionRepository', () => {
  it('atomically promotes a reviewed candidate without touching release or publication state', async () => {
    const { candidate, proposal } = fixture();
    const { client, statements, queries } = fakeClient();
    const repository = new PostgresAflTradeExternalCanonicalPromotionRepository(client);

    const result = await repository.promote({
      candidateId: candidate.candidateId,
      approvalDecisionId,
    });

    expect(result).toMatchObject({
      candidateId: candidate.candidateId,
      status: 'finalized',
      idempotentReplay: false,
      transactionCount: 1,
      transferCount: 1,
      pickCustodyCount: 1,
    });
    expect(statements.some((sql) => sql.includes('INSERT INTO outcome_event_version'))).toBe(true);
    const eventInsert = queries.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_event_version')
    );
    expect(eventInsert?.parameters[5]).toBe('2025-10-15');
    expect(
      statements.some((sql) => sql.includes('INSERT INTO outcome_pick_custody_observation'))
    ).toBe(true);
    expect(statements.some((sql) => sql.includes('FROM outcome_source_capture_season scope'))).toBe(
      true
    );
    const pickInsert = queries.find(({ sql }) => sql.includes('INSERT INTO outcome_draft_pick'));
    expect(pickInsert?.parameters.slice(3, 6)).toEqual([1, 14, 'club-gws']);
    const promotionInsert = queries.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_external_canonical_promotion')
    );
    const partyInserts = queries.filter(({ sql }) =>
      sql.includes('INSERT INTO outcome_event_party')
    );
    expect(partyInserts.map(({ parameters }) => parameters[3])).toEqual([1, 2]);
    const request = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId,
    });
    expect(JSON.parse(String(promotionInsert?.parameters[17]))).toEqual(proposal.content);
    expect(JSON.parse(String(promotionInsert?.parameters[18]))).toEqual(proposal);
    expect(JSON.parse(String(promotionInsert?.parameters[20]))).toEqual(request.content);
    expect(JSON.parse(String(promotionInsert?.parameters[21]))).toEqual(request);
    expect(statements.some((sql) => /outcome_(release|active_release|valuation)/.test(sql))).toBe(
      false
    );
  });

  it('returns an exact replay without writing canonical rows again', async () => {
    const { candidate } = fixture();
    const { client, statements } = fakeClient({ replay: true });
    const repository = new PostgresAflTradeExternalCanonicalPromotionRepository(client);

    await expect(
      repository.promote({ candidateId: candidate.candidateId, approvalDecisionId })
    ).resolves.toMatchObject({ idempotentReplay: true, status: 'finalized' });
    expect(statements.some((sql) => sql.startsWith('INSERT INTO outcome_event'))).toBe(false);
  });
});
