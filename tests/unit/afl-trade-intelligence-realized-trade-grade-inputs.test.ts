import { describe, expect, it } from 'vitest';

import {
  buildAflTradeRealizedTradeGradeInputs,
  loadAflTradeRealizedTradeGradeInputs,
  type AflTradeRealizedTradeGradeRows,
} from '@/server/aflTradeIntelligence/development/postgresRealizedTradeGradeInputs';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';

const hex = (digit: string) => digit.repeat(64);
const transactionId = `external-transaction:${hex('4')}`;
const transferId = `external-transfer:${hex('5')}`;
const evidenceIds = [`external-evidence:${hex('6')}`];
const candidate = createAflTradeExternalReconciliationCandidate({
  schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
  environment: 'non_production',
  competition: 'AFLM',
  anchorSeasonYear: 2025,
  sourceBatchIds: [`external-evidence-batch:${hex('1')}`],
  identityResolutionIds: [],
  transactions: [
    {
      transactionId,
      providerEventId: 'draftguru:2025-trade',
      seasonYear: 2025,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
      parties: ['carlton', 'geelong'],
      transferIds: [transferId],
      status: 'single_source',
      evidenceIds,
    },
  ],
  transfers: [
    {
      transferId,
      transactionId,
      fromClubId: 'carlton',
      toClubId: 'geelong',
      asset: { kind: 'player', playerId: 'p1', recordedName: 'Player One' },
      status: 'single_source',
      evidenceIds,
    },
  ],
  draftSelections: [],
  pickCustody: [],
  pickLineage: [],
  issues: [],
  reconciledAt: '2026-10-08T00:00:00.000Z',
  publicationEligible: false,
});

const V3 = 'afl-trade-acquisition-registration/v3';
const V4 = 'afl-trade-acquisition-registration/v4';
const options = {
  candidateId: candidate.candidateId,
  methodId: `hpn-pav-method:${hex('2')}`,
  seasons: [2022, 2021],
  officialSeasons: [2021],
  pickProjectionBenchmarkId: `hpn-pick-benchmark:${hex('3')}`,
  spellCutoffAt: '2026-10-08T00:00:00.000Z',
  gradedAt: '2026-10-08T13:00:00.000Z',
};
const head = (season: number) => ({
  season_year: season,
  calculation_id: `hpn-pav-season:${season}`,
  status: 'finalized',
  finalized_at: '2026-10-01T00:00:00.000Z',
});
const spell = (id: string, player: string, club: string, season: number, schema = V3) => ({
  spell_version_id: id,
  player_id: player,
  club_id: club,
  season,
  schema,
});
const rows = (): AflTradeRealizedTradeGradeRows => ({
  candidate: { candidate_json: candidate, environment: 'non_production', status: 'finalized' },
  heads: [head(2021), head(2022)],
  pav: [
    {
      season_year: 2022,
      spell_version_id: 'sv-1',
      player_id: 'p1',
      team_id: 'carlton',
      total_pav: 7.5,
    },
  ],
  spells: [
    spell('sv-1', 'p1', 'carlton', 2022),
    spell('sv-a', 'p1', 'carlton', 2021, V4),
    spell('sv-2', 'p2', 'geelong', 2021),
  ],
});

describe('realized trade grade inputs from PostgreSQL rows', () => {
  it('maps calculations, PAV, season spells and reviewed arrivals', () => {
    const inputs = buildAflTradeRealizedTradeGradeInputs(options, rows());
    expect(inputs.candidateId).toBe(candidate.candidateId);
    expect(inputs.pavCalculations).toEqual([
      { season: 2021, calculationId: 'hpn-pav-season:2021', official: true },
      { season: 2022, calculationId: 'hpn-pav-season:2022', official: false },
    ]);
    expect(inputs.pav).toEqual([{ playerId: 'p1', season: 2022, clubId: 'carlton', value: 7.5 }]);
    expect(inputs.seasonSpells).toEqual([
      { playerId: 'p1', clubId: 'carlton', season: 2022 },
      { playerId: 'p2', clubId: 'geelong', season: 2021 },
    ]);
    expect(inputs.spellSeasons).toEqual([2021, 2022]);
    expect(inputs.reviewedArrivals).toEqual([{ playerId: 'p1', clubId: 'carlton', season: 2021 }]);
  });

  it.each<
    [string, (value: AflTradeRealizedTradeGradeRows) => AflTradeRealizedTradeGradeRows, RegExp]
  >([
    ['an unknown candidate', (value) => ({ ...value, candidate: undefined }), /Unknown candidate/],
    [
      'a candidate that is not finalized',
      (value) => ({ ...value, candidate: { ...value.candidate!, status: 'draft' } }),
      /not a finalized non-production/,
    ],
    [
      'a production candidate',
      (value) => ({ ...value, candidate: { ...value.candidate!, environment: 'production' } }),
      /not a finalized non-production/,
    ],
    [
      'stored content that does not match its address',
      (value) => ({
        ...value,
        candidate: {
          ...value.candidate!,
          candidate_json: {
            ...candidate,
            content: { ...candidate.content, reconciledAt: '2026-10-09T00:00:00.000Z' },
          },
        },
      }),
      /content address/,
    ],
    [
      'a season without a finalized current calculation',
      (value) => ({ ...value, heads: [head(2021)] }),
      /No finalized current HPN PAV calculation for 2022/,
    ],
    [
      'a PAV head finalized after the cutoff',
      (value) => ({
        ...value,
        heads: [head(2021), { ...head(2022), finalized_at: '2026-10-09T00:00:00.000Z' }],
      }),
      /2022 was finalized after the cutoff/,
    ],
    [
      'a graded season with no season spells',
      (value) => ({
        ...value,
        spells: value.spells.filter((row) => row.spell_version_id !== 'sv-2'),
      }),
      /No season spells for 2021/,
    ],
    [
      'two PAV rows for one player, club and season',
      (value) => ({ ...value, pav: [...value.pav, { ...value.pav[0]!, total_pav: 1 }] }),
      /Two PAV rows for p1 at carlton in 2022/,
    ],
    [
      'a PAV row bound to no current season spell',
      (value) => ({ ...value, pav: [{ ...value.pav[0]!, spell_version_id: 'sv-gone' }] }),
      /sv-gone is not bound to a current season spell/,
    ],
    [
      'a PAV row bound to a reviewed arrival rather than a season spell',
      (value) => ({ ...value, pav: [{ ...value.pav[0]!, spell_version_id: 'sv-a' }] }),
      /sv-a is not bound to a current season spell/,
    ],
  ])('refuses %s', (_label, change, message) => {
    expect(() => buildAflTradeRealizedTradeGradeInputs(options, change(rows()))).toThrow(message);
  });

  it('refuses empty or repeated seasons, and an official season outside them', () => {
    expect(() =>
      buildAflTradeRealizedTradeGradeInputs({ ...options, seasons: [] }, rows())
    ).toThrow(/distinct seasons/);
    expect(() =>
      buildAflTradeRealizedTradeGradeInputs({ ...options, seasons: [2021, 2021] }, rows())
    ).toThrow(/distinct seasons/);
    expect(() =>
      buildAflTradeRealizedTradeGradeInputs({ ...options, officialSeasons: [2020] }, rows())
    ).toThrow(/official season must be one of the graded seasons/);
  });

  it('reads everything in one read-only repeatable-read transaction with the pinned parameters', async () => {
    const statements: { sql: string; parameters?: readonly unknown[] }[] = [];
    const data = rows();
    const answer = (sql: string) => {
      if (sql.includes('FROM outcome_external_reconciliation_candidate')) return [data.candidate];
      if (sql.includes('FROM outcome_hpn_pav_calculation_head')) return data.heads;
      if (sql.includes('FROM outcome_hpn_pav_calculation_player')) return data.pav;
      if (sql.includes('FROM outcome_acquisition_spell_version')) return data.spells;
      return [];
    };
    let transactions = 0;
    const query = async (sql: string, parameters?: readonly unknown[]) => {
      statements.push({ sql, parameters });
      return { rows: answer(sql) as never[], rowCount: 0 };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) => {
        transactions++;
        return work({ query });
      },
    } as unknown as AflOutcomeSqlClient;
    const inputs = await loadAflTradeRealizedTradeGradeInputs(client, options);
    expect(transactions).toBe(1);
    expect(statements[0]!.sql).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(statements[2]!.parameters).toEqual([options.methodId, options.seasons]);
    expect(statements[3]!.parameters).toEqual([['hpn-pav-season:2021', 'hpn-pav-season:2022']]);
    expect(statements[4]!.parameters).toEqual([options.spellCutoffAt, [V3, V4], V3]);
    expect(statements[4]!.sql).toMatch(/r ->> 'environment' = 'non_production'/);
    expect(statements[4]!.sql).toMatch(/extract\(month FROM s\.start_date\) >= 10 THEN 1/);
    expect(inputs.reviewedArrivals).toHaveLength(1);
  });
});
