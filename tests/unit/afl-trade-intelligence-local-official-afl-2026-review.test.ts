import { describe, expect, it } from 'vitest';

import {
  LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
  reviewLocalOfficialAfl2026SamFlandersEvidence,
} from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Review';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const reviewedMatches = [
  ['CD_M20260140005', 'Opening Round', '2026-03-08T08:20:00.000+0000', 0],
  ['CD_M20260140108', 'Round 1', '2026-03-15T04:15:00.000+0000', 0],
  ['CD_M20260140204', 'Round 2', '2026-03-21T05:15:00.000+0000', 0],
  ['CD_M20260140303', 'Round 3', '2026-03-28T01:35:00.000+0000', 0],
  ['CD_M20260140509', 'Round 5', '2026-04-12T09:15:00.000+0000', 0],
  ['CD_M20260140606', 'Round 6', '2026-04-18T09:35:00.000+0000', 0],
  ['CD_M20260140707', 'Round 7', '2026-04-26T03:10:00.000+0000', 1],
  ['CD_M20260140807', 'Round 8', '2026-05-02T09:35:00.000+0000', 0],
  ['CD_M20260140906', 'Round 9', '2026-05-09T09:10:00.000+0000', 0],
  ['CD_M20260141008', 'Round 10', '2026-05-17T05:15:00.000+0000', 0],
  ['CD_M20260141103', 'Round 11', '2026-05-22T10:30:00.000+0000', 0],
  ['CD_M20260141201', 'Round 12', '2026-05-28T09:30:00.000+0000', 0],
] as const;

function reviewedRows() {
  return reviewedMatches.map(([nativeMatchId, roundLabel, matchDateText, numericValue], index) => ({
    provider_decoded_row_id: `decoded-${index}`,
    identity_candidate_id: `identity-${index}`,
    match_candidate_id: `match-${index}`,
    native_entity_id: 'CD_I1009260',
    recorded_name: 'Sam Flanders',
    recorded_club_name: 'St Kilda',
    native_match_id: nativeMatchId,
    round_label: roundLabel,
    match_date_text: matchDateText,
    definition_version: 'goals/v1',
    numeric_value: numericValue,
  }));
}

function atomicReviewClient(options: { failAtInsert?: number } = {}) {
  const committed: unknown[][] = [];
  const client: AflOutcomeSqlClient = {
    async query() {
      throw new Error('Review writes must use a transaction.');
    },
    async transaction(work) {
      const pending: unknown[][] = [];
      const transaction: AflOutcomeSqlTransaction = {
        async query<Row>(sql, parameters) {
          if (sql.includes('pg_advisory_xact_lock')) return { rows: [] as Row[], rowCount: 1 };
          if (sql.includes('FROM outcome_provider_decoded_row decoded')) {
            return { rows: reviewedRows() as Row[], rowCount: 12 };
          }
          if (sql.includes('INSERT INTO outcome_review_decision')) {
            pending.push([...(parameters ?? [])]);
            if (pending.length === options.failAtInsert) throw new Error('injected review failure');
            return { rows: [] as Row[], rowCount: 1 };
          }
          if (sql.includes('count(*)::integer AS decision_count')) {
            return { rows: [{ decision_count: pending.length }] as Row[], rowCount: 1 };
          }
          if (sql.includes('SELECT decision_id FROM outcome_review_decision')) {
            return {
              rows: [{ decision_id: parameters?.[0] }] as Row[],
              rowCount: 1,
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      const result = await work(transaction);
      committed.push(...pending);
      return result;
    },
  };
  return { client, committed };
}

describe('local official AFL 2026 review', () => {
  it('atomically records the exact identity, match, and factual approval set', async () => {
    const { client, committed } = atomicReviewClient();
    const evidence = await reviewLocalOfficialAfl2026SamFlandersEvidence(
      client,
      'source-capture:official-2026',
      'provider-normalization-run:official-2026'
    );

    expect(evidence).toMatchObject({
      recordedName: 'Sam Flanders',
      recordedClubName: 'St Kilda',
      concludedAppearanceCount: 12,
      goals: 1,
      evidenceSetSha256: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
    });
    expect(committed).toHaveLength(37);
    expect(committed.map((parameters) => parameters[1])).toEqual(
      expect.arrayContaining([
        'provider_identity_candidate',
        'provider_match_candidate',
        'local_reconciled_player_match_fact',
        LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
      ])
    );
    expect(committed.at(-1)?.[0]).toBe(
      `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`
    );
  });

  it('rejects a native match or date mutation against the pinned evidence digest', async () => {
    const { client } = atomicReviewClient();
    const originalTransaction = client.transaction.bind(client);
    client.transaction = (work) =>
      originalTransaction((transaction) =>
        work({
          ...transaction,
          async query<Row>(sql, parameters) {
            const result = await transaction.query<Row>(sql, parameters);
            if (!sql.includes('FROM outcome_provider_decoded_row decoded')) return result;
            const rows = structuredClone(result.rows) as Array<Record<string, unknown>>;
            rows[0]!.match_date_text = '2026-03-09T08:20:00.000+0000';
            return { rows: rows as Row[], rowCount: rows.length };
          },
        })
      );

    await expect(
      reviewLocalOfficialAfl2026SamFlandersEvidence(
        client,
        'source-capture:official-2026',
        'provider-normalization-run:official-2026'
      )
    ).rejects.toThrow(/exact reviewed Sam Flanders evidence set/i);
  });

  it('rolls every decision back when a mid-review write fails', async () => {
    const { client, committed } = atomicReviewClient({ failAtInsert: 19 });
    await expect(
      reviewLocalOfficialAfl2026SamFlandersEvidence(
        client,
        'source-capture:official-2026',
        'provider-normalization-run:official-2026'
      )
    ).rejects.toThrow(/injected review failure/i);
    expect(committed).toEqual([]);
  });

  it('rolls the 36 receipts back when the set-admission marker cannot be written', async () => {
    const { client, committed } = atomicReviewClient({ failAtInsert: 37 });
    await expect(
      reviewLocalOfficialAfl2026SamFlandersEvidence(
        client,
        'source-capture:official-2026',
        'provider-normalization-run:official-2026'
      )
    ).rejects.toThrow(/injected review failure/i);
    expect(committed).toEqual([]);
  });
});
