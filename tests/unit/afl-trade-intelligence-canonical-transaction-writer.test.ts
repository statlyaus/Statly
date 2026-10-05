import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { writeCanonicalAflTradeTransaction } from '@/server/aflTradeIntelligence/source/canonicalTradeTransactionWriter';

describe('writeCanonicalAflTradeTransaction', () => {
  it('writes one versioned transaction aggregate without owning capture or publication policy', async () => {
    const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const transaction = {
      query: async (sql: string, parameters: readonly unknown[] = []) => {
        queries.push({ sql, parameters });
        if (sql.includes('SELECT event_id FROM outcome_event')) {
          return { rows: [{ event_id: parameters[0] }], rowCount: 1 };
        }
        if (sql.includes('FROM outcome_event_version current')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    } as AflOutcomeSqlTransaction;

    const written = await writeCanonicalAflTradeTransaction(transaction, {
      provenanceId: 'workbook-transaction-review-decision:abc',
      eventId: 'workbook-2021-jordan-dawson',
      stableKey: 'workbook:AFLM:2021:jordan-dawson',
      competition: 'AFLM',
      seasonYear: 2021,
      occurredOn: '2021-10-13',
      officialName: '2021 Trade for Jordan Dawson',
      transactionSourceImportRowId: 'workbook-row:transaction',
      recordedAt: '2026-08-17T00:00:00.000Z',
      parties: [
        { clubId: 'afl-club:adelaide', sourceImportRowId: 'workbook-row:adelaide' },
        { clubId: 'afl-club:sydney', sourceImportRowId: 'workbook-row:sydney' },
      ],
      assets: [
        {
          assetKey: 'workbook-2021-jordan-dawson-adelaide-1',
          kind: 'player',
          playerId: 'local-afl-player:afl-tables:12516',
          playerIdentityId: null,
          externalIdentityDecisionId: null,
          privateWorkbookTransactionDecisionId: 'workbook-transaction-review-decision:abc',
          pickId: null,
          fromClubId: 'afl-club:sydney',
          toClubId: 'afl-club:adelaide',
          sourceImportRowId: 'workbook-row:adelaide',
          rawDescription: 'Jordan Dawson',
        },
      ],
    });

    expect(written).toMatchObject({ eventId: 'workbook-2021-jordan-dawson', version: 1 });
    expect(written.eventVersionId).toMatch(/^event-version:[a-f0-9]{64}$/);
    expect(queries.filter(({ sql }) => sql.includes('INSERT INTO outcome_event_party'))).toHaveLength(
      2
    );
    expect(queries.filter(({ sql }) => sql.includes('INSERT INTO outcome_event_asset'))).toHaveLength(
      1
    );
    expect(
      queries.some(({ sql }) => sql.includes('private_workbook_transaction_decision_id'))
    ).toBe(true);
    expect(
      queries.some(({ sql }) => /outcome_(release|active_release|valuation)/.test(sql))
    ).toBe(false);
  });
});
