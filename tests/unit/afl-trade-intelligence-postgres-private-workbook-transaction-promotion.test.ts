import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeWorkbookTransactionReviewDecisionV2 } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import type { AflTradeWorkbookTransactionReviewSet } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewSet';
import { PostgresAflTradePrivateWorkbookTransactionPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresPrivateWorkbookTransactionPromotionRepository';

const parties = [
  {
    stagingRowId: `workbook-row:${'5'.repeat(64)}`,
    rowSha256: '6'.repeat(64),
    sourceLocator: 'Trades!R11',
    sourceOrdinal: 2,
    clubLabel: 'Adelaide',
    assetText: 'Jordan Dawson',
  },
  {
    stagingRowId: `workbook-row:${'7'.repeat(64)}`,
    rowSha256: '8'.repeat(64),
    sourceLocator: 'Trades!R12',
    sourceOrdinal: 3,
    clubLabel: 'Sydney',
    assetText: 'Future 2022 R1 (Melbourne)',
  },
] as const;
const stagingPackageId = `workbook-import:${'a'.repeat(64)}`;
const subjectBase = {
  sourceGroupId: `workbook-source-group:${'2'.repeat(64)}`,
  transactionRowId: `workbook-row:${'3'.repeat(64)}`,
  transactionRowSha256: '4'.repeat(64),
  sourceLocator: 'Trades!R10',
  sourceOrdinal: 1,
  seasonYear: 2021,
  sourceTitle: '2021 Trade for Jordan Dawson',
  parties,
  partySetSha256: sha256AflTradeCanonicalJson(parties),
  reviewState: 'pending',
} as const;
const subject = {
  reviewSubjectId: createAflTradeContentAddress('workbook-transaction-review-subject', {
    stagingPackageId,
    sourceGroupId: subjectBase.sourceGroupId,
    transactionRowId: subjectBase.transactionRowId,
    transactionRowSha256: subjectBase.transactionRowSha256,
    partySetSha256: subjectBase.partySetSha256,
  }),
  ...subjectBase,
} as const;

const reviewSetContent = {
    schemaVersion: 'afl-trade-workbook-transaction-review-set/v1',
    stagingPackageId,
    sourceArtifactId: `artifact:${'b'.repeat(64)}`,
    sourceArtifactSha256: 'b'.repeat(64),
    rawEvidenceSha256: 'c'.repeat(64),
    authority: 'private_workbook_migration_oracle_review',
    publicationEligible: false,
    publicationProhibited: true,
    transactions: [subject],
    transactionCount: 1,
    transactionSetSha256: sha256AflTradeCanonicalJson([subject]),
    pendingReviewCount: 1,
} as const;
const reviewSet = {
  reviewSetId: createAflTradeContentAddress('workbook-transaction-review-set', reviewSetContent),
  content: reviewSetContent,
} as unknown as AflTradeWorkbookTransactionReviewSet;

describe('PostgresAflTradePrivateWorkbookTransactionPromotionRepository', () => {
  it('atomically stores an exact private-only promotion receipt', async () => {
    const decision = createAflTradeWorkbookTransactionReviewDecisionV2({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      workbookTradeId: 'workbook-2021-e7f7d1484744f855',
      occurredOn: '2021-10-13',
      occurrencePrecision: 'date',
      outcome: 'approved',
      parties: [
        {
          stagingRowId: subject.parties[0].stagingRowId,
          canonicalClubId: 'local-afl-club:adelaide',
          assets: [
            {
              assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
              sourceAssetText: 'Jordan Dawson',
              assetKind: 'player',
              sendingClubId: 'local-afl-club:sydney',
              receivingClubId: 'local-afl-club:adelaide',
              canonicalPlayerId: 'local-afl-player:afl-tables:12516',
              selection: null,
            },
          ],
        },
        {
          stagingRowId: subject.parties[1].stagingRowId,
          canonicalClubId: 'local-afl-club:sydney',
          assets: [
            {
              assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
              sourceAssetText: 'Future 2022 R1 (Melbourne)',
              assetKind: 'future_pick',
              sendingClubId: 'local-afl-club:adelaide',
              receivingClubId: 'local-afl-club:sydney',
              canonicalPlayerId: null,
              selection: { seasonYear: 2022, round: 1, number: null, originalClubId: 'local-afl-club:melbourne' },
            },
          ],
        },
      ],
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Exact private transaction review.',
      decidedAt: '2026-08-17T00:00:00.000Z',
    });
    const queries: string[] = [];
    const query = async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM outcome_workbook_transaction_review_set')) {
        return {
          rows: [{ import_run_id: `import-run:${'9'.repeat(64)}`, review_set_json: reviewSet }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT club_id FROM outcome_club')) {
        return { rows: [{ club_id: 'exact' }], rowCount: 1 };
      }
      if (sql.includes('SELECT player_id FROM outcome_player')) {
        return { rows: [{ player_id: 'exact' }], rowCount: 1 };
      }
      if (sql.includes('SELECT event_id FROM outcome_event')) {
        return { rows: [{ event_id: 'exact' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;

    const result = await new PostgresAflTradePrivateWorkbookTransactionPromotionRepository(
      client
    ).promote({ reviewSet, decision });

    expect(result.promotionId).toMatch(/^private-workbook-transaction-promotion:[a-f0-9]{64}$/);
    expect(result).toMatchObject({
      workbookTradeId: 'workbook-2021-e7f7d1484744f855',
      decisionId: decision.decisionId,
      status: 'active',
      publicationEligible: false,
      publicationProhibited: true,
      canonicalTransaction: {
        eventVersionId: expect.stringMatching(/^event-version:[a-f0-9]{64}$/),
        assets: [
          {
            assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
            assetVersionId: expect.stringMatching(/^event-asset-version:[a-f0-9]{64}$/),
            acquisitionSpell: {
              spellVersionId: expect.stringMatching(/^acquisition-spell-version:[a-f0-9]{64}$/),
              startDate: '2021-10-13',
              endDate: null,
            },
          },
          {
            assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
            acquisitionSpell: null,
          },
        ],
      },
    });
    expect(queries.some((sql) => sql.includes('outcome_private_workbook_transaction_promotion'))).toBe(true);
    expect(
      queries.some(
        (sql) =>
          sql.includes('INSERT INTO outcome_event_asset') &&
          sql.includes('private_workbook_transaction_decision_id')
      )
    ).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO outcome_review_decision'))).toBe(false);
    expect(queries.some((sql) => sql.includes('external_provider_identity'))).toBe(false);
    expect(queries.some((sql) => sql.includes("status='open'"))).toBe(false);
    expect(queries.some((sql) => /outcome_(release|active_release|valuation)/.test(sql))).toBe(false);
  });
});
