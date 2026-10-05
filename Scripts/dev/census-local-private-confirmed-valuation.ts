import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { loadAflOutcomesDevelopmentWorkbook } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

interface AllocationRow {
  recorded_name: string;
  canonical_player_id: string;
  club_id: string;
  season_year: number;
  allocation_id: string;
  games_played: number;
  total_pav: number;
}

interface CensusCandidate {
  tradeId: string;
  tradeYear: number;
  tradeTitle: string;
  assetId: string;
  playerName: string;
  receivingClubName: string;
  canonicalPlayerId: string;
  seasons: number[];
  gamesPlayed: number;
  totalPav: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function recordedNameMatchesWorkbookEvidence(input: {
  recordedName: string;
  workbookName: string;
  tradeTitle: string;
}): boolean {
  const recorded = normalizeName(input.recordedName);
  const workbook = normalizeName(input.workbookName);
  if (recorded === workbook) return true;
  if (workbook.includes(' ')) return false;
  return (
    recorded.split(' ').at(-1) === workbook &&
    normalizeName(input.tradeTitle).includes(recorded)
  );
}

function normalizedScore(value: number): number {
  return Number(value.toFixed(12));
}

function assertDisposableDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('The census requires loopback statly_outcomes_test PostgreSQL.');
  }
}

async function runtimeNonce(): Promise<string> {
  const configured = process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
  const value =
    configured ??
    (
      await readFile(
        resolve(process.cwd(), '.statly-local/afl-trade-outcomes-runtime-nonce'),
        'utf8'
      )
    ).trim();
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError('The disposable outcomes runtime nonce is invalid.');
  }
  return value;
}

export function censusLocalPrivateConfirmedValuationCandidates(input: {
  detailsById: ReturnType<typeof projectAflOutcomesDevelopmentWorkbookTrades>['detailsById'];
  allocations: readonly AllocationRow[];
}): CensusCandidate[] {
  const candidates: CensusCandidate[] = [];
  for (const detail of input.detailsById.values()) {
    for (const asset of detail.assets) {
      if (asset.assetType !== 'player' || asset.playerName === null) continue;
      const matching = input.allocations.filter(
        (allocation) =>
          recordedNameMatchesWorkbookEvidence({
            recordedName: allocation.recorded_name,
            workbookName: asset.playerName!,
            tradeTitle: detail.trade.title,
          }) &&
          allocation.club_id === `local-afl-club:${asset.clubSlug}` &&
          allocation.season_year > detail.trade.year
      );
      const canonicalPlayerIds = new Set(
        matching.map(({ canonical_player_id }) => canonical_player_id)
      );
      if (matching.length === 0 || canonicalPlayerIds.size !== 1) continue;
      candidates.push({
        tradeId: detail.trade.tradeId,
        tradeYear: detail.trade.year,
        tradeTitle: detail.trade.title,
        assetId: asset.id,
        playerName: asset.playerName,
        receivingClubName: asset.clubName,
        canonicalPlayerId: [...canonicalPlayerIds][0]!,
        seasons: [...new Set(matching.map(({ season_year }) => season_year))].sort(
          (left, right) => left - right
        ),
        gamesPlayed: matching.reduce((sum, { games_played }) => sum + games_played, 0),
        totalPav: normalizedScore(matching.reduce((sum, { total_pav }) => sum + total_pav, 0)),
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      right.seasons.length - left.seasons.length ||
      right.gamesPlayed - left.gamesPlayed ||
      left.tradeId.localeCompare(right.tradeId) ||
      left.assetId.localeCompare(right.assetId)
  );
}

async function main(): Promise<void> {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new TypeError('The private confirmed valuation census is prohibited in production.');
  }
  const databaseUrl = required('AFL_OUTCOMES_DATABASE_URL');
  assertDisposableDatabase(databaseUrl);
  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath: required('AFL_OUTCOMES_DEV_WORKBOOK_PATH'),
    expectedSha256: required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256'),
    runtimeEnvironment: process.env.NODE_ENV ?? 'development',
  });
  const projection = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, await runtimeNonce());
    await pool.query('BEGIN TRANSACTION READ ONLY');
    const result = await pool.query<AllocationRow>(
      `SELECT DISTINCT candidate.recorded_name,
                       allocation->'identity'->>'canonicalPlayerId' AS canonical_player_id,
                       allocation->>'clubId' AS club_id,
                       calculation.season_year,
                       allocation->>'allocationId' AS allocation_id,
                       (allocation->>'gamesPlayed')::integer AS games_played,
                       (allocation->>'totalPav')::double precision AS total_pav
         FROM outcome_private_reviewed_hpn_calculation calculation
        CROSS JOIN LATERAL jsonb_array_elements(
          calculation.calculation_json->'content'->'allocations'
        ) allocation
        CROSS JOIN LATERAL jsonb_array_elements_text(
          allocation->'identity'->'identityDecisionIds'
        ) identity_decision_id
         JOIN outcome_review_decision decision
           ON decision.decision_id=identity_decision_id
          AND decision.decision='approved'
         JOIN outcome_provider_identity_candidate candidate
           ON candidate.identity_candidate_id=decision.subject_id
        WHERE allocation->'identity'->>'state'='resolved'`
    );
    await pool.query('COMMIT');
    const candidates = censusLocalPrivateConfirmedValuationCandidates({
      detailsById: projection.detailsById,
      allocations: result.rows,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'private_local_read_only_census',
          authority: 'candidate_selection_only',
          publicationEligible: false,
          workbookTradeCount: projection.detailsById.size,
          candidateCount: candidates.length,
          reportedCandidateCount: Math.min(candidates.length, 50),
          candidates: candidates.slice(0, 50),
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Private confirmed valuation census failed.'}\n`
  );
  process.exitCode = 1;
});
