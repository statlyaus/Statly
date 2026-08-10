import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  AflTradeExternalReconciliationPersistenceError,
  PostgresAflTradeExternalReconciliationRepository,
} from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';

const reconciledAt = '2026-08-09T07:30:00.000Z';
const evidenceId = `external-evidence:${'e'.repeat(64)}`;
const batchId = `external-evidence-batch:${'b'.repeat(64)}`;

function fixture() {
  const clubA = createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: 'draftguru',
    entityKind: 'club',
    sourceIdentity: { nativeId: 'gws', recordedName: 'GWS' },
    canonicalId: 'club-gws',
    reviewDecisionId: `review-decision:${'a'.repeat(64)}`,
    reviewDecisionSha256: 'a'.repeat(64),
    decidedAt: '2026-08-09T07:00:00.000Z',
    status: 'current_approved',
  });
  const clubB = createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: 'draftguru',
    entityKind: 'club',
    sourceIdentity: { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
    canonicalId: 'club-western-bulldogs',
    reviewDecisionId: `review-decision:${'c'.repeat(64)}`,
    reviewDecisionSha256: 'c'.repeat(64),
    decidedAt: '2026-08-09T07:00:00.000Z',
    status: 'current_approved',
  });
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
  const selectionId = createAflTradeContentAddress('external-draft-selection', {
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
  });
  const lineageId = createAflTradeContentAddress('external-pick-lineage', {
    transferId,
    selectionId,
  });
  const custodyId = createAflTradeContentAddress('external-pick-custody', { evidenceId });
  const identityResolutions = [clubA, clubB].sort((left, right) =>
    left.resolutionId.localeCompare(right.resolutionId)
  );
  const candidate = createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: identityResolutions.map(({ resolutionId }) => resolutionId),
    transactions: [
      {
        transactionId,
        providerEventId: '2025-gws-bulldogs',
        seasonYear: 2025,
        occurredOn: '2025-10-15',
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
          originalClubId: null,
          recordedLabel: 'Pick 14',
        },
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    draftSelections: [
      {
        selectionId,
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        pickId,
        playerId: 'player-harry-kyle',
        clubId: 'club-western-bulldogs',
        status: 'corroborated',
        supportingProviders: ['draftguru', 'footywire'],
        evidenceIds: [evidenceId],
      },
    ],
    pickCustody: [
      {
        custodyId,
        pickId,
        observedAt: '2025-11-01T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        status: 'single_source',
        evidenceIds: [evidenceId],
      },
    ],
    pickLineage: [
      {
        lineageId,
        pickId,
        transferId,
        selectionId,
        status: 'corroborated',
        evidenceIds: [evidenceId],
      },
    ],
    issues: [],
    reconciledAt,
    publicationEligible: false,
  });
  return { candidate, identityResolutions };
}

function fakeClient(options?: {
  replay?: boolean;
  sourceFinalized?: boolean;
  sourceIssueCount?: number;
  wrongScope?: boolean;
  missingEvidence?: boolean;
  unreferencedEvidence?: boolean;
}) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const { candidate } = fixture();
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('FROM outcome_external_reconciliation_candidate')) {
      return options?.replay
        ? {
            rows: [
              {
                status: 'finalized',
                finalized_at: reconciledAt,
                candidate_json: candidate,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_external_evidence_batch')) {
      return options?.sourceFinalized === false
        ? {
            rows: [
              {
                status: 'open',
                finalized_at: null,
                environment: 'test_fixture',
                competition: options?.wrongScope ? 'AFLW' : 'AFLM',
                anchor_season_year: 2025,
                issue_count: options?.sourceIssueCount ?? 0,
              },
            ],
            rowCount: 1,
          }
        : {
            rows: [
              {
                status: 'finalized',
                finalized_at: reconciledAt,
                environment: 'test_fixture',
                competition: options?.wrongScope ? 'AFLW' : 'AFLM',
                anchor_season_year: 2025,
                issue_count: options?.sourceIssueCount ?? 0,
              },
            ],
            rowCount: 1,
          };
    }
    if (sql.includes('NOT (evidence.evidence_id = ANY')) {
      return options?.unreferencedEvidence
        ? { rows: [{ evidence_id: `external-evidence:${'f'.repeat(64)}` }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_external_evidence_row evidence')) {
      return options?.missingEvidence
        ? { rows: [], rowCount: 0 }
        : { rows: [{ evidence_id: parameters[1] }], rowCount: 1 };
    }
    return { rows: [], rowCount: sql.includes('UPDATE') || sql.includes('INSERT') ? 1 : 0 };
  };
  const client: AflOutcomeSqlClient = {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
  return { client, statements };
}

describe('PostgreSQL external reconciliation candidate repository', () => {
  it('persists the complete typed graph and finalizes it atomically', async () => {
    const input = fixture();
    const database = fakeClient();
    const repository = new PostgresAflTradeExternalReconciliationRepository(database.client);

    await expect(repository.persistCandidate(input)).resolves.toMatchObject({
      candidateId: input.candidate.candidateId,
      status: 'finalized',
      blockingIssueCount: 0,
      idempotentReplay: false,
    });
    expect(database.statements.some(({ sql }) => sql.includes('reconciliation_transaction'))).toBe(
      true
    );
    expect(database.statements.some(({ sql }) => sql.includes('reconciliation_transfer'))).toBe(
      true
    );
    expect(
      database.statements.some(({ sql }) => sql.includes('reconciliation_draft_selection'))
    ).toBe(true);
    expect(database.statements.some(({ sql }) => sql.includes('reconciliation_pick_lineage'))).toBe(
      true
    );
    expect(database.statements.at(-1)?.sql).toContain("SET status='finalized'");
  });

  it('returns exact replay without inserting a second candidate', async () => {
    const input = fixture();
    const database = fakeClient({ replay: true });
    const repository = new PostgresAflTradeExternalReconciliationRepository(database.client);

    await expect(repository.persistCandidate(input)).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(database.statements.some(({ sql }) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('rejects missing reviewed identity evidence and unfinalized source batches', async () => {
    const input = fixture();
    const repository = new PostgresAflTradeExternalReconciliationRepository(fakeClient().client);
    await expect(
      repository.persistCandidate({
        ...input,
        identityResolutions: input.identityResolutions.slice(1),
      })
    ).rejects.toMatchObject({ code: 'IDENTITY_EVIDENCE_MISMATCH' });

    const unavailable = new PostgresAflTradeExternalReconciliationRepository(
      fakeClient({ sourceFinalized: false }).client
    );
    await expect(unavailable.persistCandidate(input)).rejects.toMatchObject({
      code: 'SOURCE_BATCH_UNAVAILABLE',
    });

    const issueBearing = new PostgresAflTradeExternalReconciliationRepository(
      fakeClient({ sourceIssueCount: 1 }).client
    );
    await expect(issueBearing.persistCandidate(input)).rejects.toMatchObject({
      code: 'SOURCE_BATCH_UNAVAILABLE',
    });
  });

  it('rejects source batches from another scope and evidence outside the candidate batches', async () => {
    const input = fixture();
    const wrongScope = new PostgresAflTradeExternalReconciliationRepository(
      fakeClient({ wrongScope: true }).client
    );
    await expect(wrongScope.persistCandidate(input)).rejects.toMatchObject({
      code: 'SOURCE_BATCH_UNAVAILABLE',
    });

    const missingEvidence = new PostgresAflTradeExternalReconciliationRepository(
      fakeClient({ missingEvidence: true }).client
    );
    await expect(missingEvidence.persistCandidate(input)).rejects.toMatchObject({
      code: 'SOURCE_BATCH_UNAVAILABLE',
    });

    const unreferencedEvidence = new PostgresAflTradeExternalReconciliationRepository(
      fakeClient({ unreferencedEvidence: true }).client
    );
    await expect(unreferencedEvidence.persistCandidate(input)).rejects.toMatchObject({
      code: 'SOURCE_BATCH_UNAVAILABLE',
    });
  });

  it('rejects a candidate whose content-address was tampered', async () => {
    const input = fixture();
    const repository = new PostgresAflTradeExternalReconciliationRepository(fakeClient().client);
    await expect(
      repository.persistCandidate({
        ...input,
        candidate: { ...input.candidate, candidateId: `external-reconciliation:${'0'.repeat(64)}` },
      })
    ).rejects.toBeInstanceOf(AflTradeExternalReconciliationPersistenceError);
  });

  it('rejects incomplete transaction transfer membership before persistence', () => {
    const { candidate } = fixture();
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...candidate.content,
        transactions: candidate.content.transactions.map((transaction) => ({
          ...transaction,
          transferIds: [],
        })),
      })
    ).toThrow(/exact owned transfer set/i);
  });

  it('rejects lineage backed by disputed transfer, selection, or custody state', () => {
    const { candidate } = fixture();
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...candidate.content,
        transfers: candidate.content.transfers.map((transfer) => ({
          ...transfer,
          status: 'disputed' as const,
        })),
        draftSelections: candidate.content.draftSelections.map((selection) => ({
          ...selection,
          status: 'disputed' as const,
        })),
        pickCustody: candidate.content.pickCustody.map((custody) => ({
          ...custody,
          status: 'disputed' as const,
        })),
      })
    ).toThrow(/usable transfer, selection, and custody/i);
  });

  it('keeps database finalization and append-only guards in the migration', () => {
    const migration = readFileSync(
      'prisma/afl-trade-outcomes/migrations/0011_external_reconciliation_candidate/migration.sql',
      'utf8'
    );
    expect(migration).toContain('finalize_outcome_external_reconciliation_candidate');
    expect(migration).toContain('requires finalized, issue-free source evidence batches');
    expect(migration).toContain('batch.issue_count <> 0');
    expect(migration).toContain('requires current approved identity decisions');
    expect(migration).toContain('External reconciliation evidence is append-only');
    expect(migration).toContain('outcome_external_reconciliation_lineage_transfer_fkey');
    expect(migration).toContain('outcome_external_reconciliation_lineage_selection_fkey');
    expect(migration).toContain('usable transfer, selection, and custody');
    expect(migration).toContain('must conserve the exact source evidence set');
    const sourceAuthorityMigration = readFileSync(
      'prisma/afl-trade-outcomes/migrations/0017_external_reconciliation_source_authority/migration.sql',
      'utf8'
    );
    expect(sourceAuthorityMigration).toContain('candidate_canonical_json');
    expect(sourceAuthorityMigration).toContain(
      'Historical reconciliation must consume the exact completed batch set'
    );
    expect(sourceAuthorityMigration).toContain(
      'Reconciliation source authority does not bind its exact candidate batches'
    );
  });
});
