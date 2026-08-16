import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateReviewedHpnCalculationSchema,
  calculateAflTradePrivateReviewedHpnSeason,
  createAflTradePrivateReviewedHpnMethod,
  type AflTradePrivateReviewedHpnCalculation,
} from './privateReviewedHpnCalculation';
import { PostgresAflTradeHpnReviewedSeasonUniverseRepository } from './postgresHpnReviewedSeasonUniverseRepository';

interface CalculationRow {
  calculation_json: unknown;
  team_count: number;
  allocation_count: number;
  actual_team_count: number;
  actual_allocation_count: number;
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

function digest(identifier: string, prefix: string): string {
  const expected = `${prefix}:`;
  if (!identifier.startsWith(expected)) throw new TypeError(`Expected ${prefix} identity.`);
  return identifier.slice(expected.length);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('PostgreSQL returned invalid time.');
  return parsed.toISOString();
}

async function trustedNow(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (!value) throw new Error('Disposable PostgreSQL did not supply trusted calculation time.');
  return iso(value);
}

async function loadAuthenticatedCalculation(
  client: AflOutcomeSqlClient,
  whereSql: string,
  parameters: readonly unknown[]
): Promise<AflTradePrivateReviewedHpnCalculation | null> {
  const result = await client.query<CalculationRow>(
    `SELECT calculation_json,team_count,allocation_count,
       (SELECT count(*)::integer FROM outcome_private_reviewed_hpn_team child
         WHERE child.calculation_id=calculation.calculation_id) AS actual_team_count,
       (SELECT count(*)::integer FROM outcome_private_reviewed_hpn_allocation child
         WHERE child.calculation_id=calculation.calculation_id) AS actual_allocation_count
     FROM outcome_private_reviewed_hpn_calculation calculation
     ${whereSql}`,
    parameters
  );
  const row = result.rows[0];
  if (!row) return null;
  const calculation = aflTradePrivateReviewedHpnCalculationSchema.parse(row.calculation_json);
  if (
    row.team_count !== calculation.content.teams.length ||
    row.allocation_count !== calculation.content.allocations.length ||
    row.actual_team_count !== row.team_count ||
    row.actual_allocation_count !== row.allocation_count
  ) {
    throw new Error('The private reviewed HPN calculation is incomplete.');
  }
  return calculation;
}

async function registerMethod(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const method = createAflTradePrivateReviewedHpnMethod();
  const methodCanonicalJson = canonicalizeAflTradeJson(method);
  const methodContentCanonicalJson = canonicalizeAflTradeJson(method.content);
  await transaction.query(
    `INSERT INTO outcome_private_reviewed_hpn_method
      (method_id,method_sha256,method_content_canonical_json,method_canonical_json,method_json)
     VALUES ($1,$2,$3,$4::text,$4::jsonb)
     ON CONFLICT (method_id) DO NOTHING`,
    [
      method.methodId,
      digest(method.methodId, 'private-reviewed-hpn-method'),
      methodContentCanonicalJson,
      methodCanonicalJson,
    ]
  );
  const exact = await transaction.query<{ method_json: unknown }>(
    `SELECT method_json FROM outcome_private_reviewed_hpn_method WHERE method_id=$1`,
    [method.methodId]
  );
  if (canonicalizeAflTradeJson(exact.rows[0]?.method_json) !== methodCanonicalJson) {
    throw new Error('The private reviewed HPN method conflicts with durable authority.');
  }
  return method.methodId;
}

async function persistCalculation(
  transaction: AflOutcomeSqlTransaction,
  calculation: AflTradePrivateReviewedHpnCalculation
): Promise<void> {
  const content = calculation.content;
  await transaction.query(
    `INSERT INTO outcome_private_reviewed_hpn_calculation
      (calculation_id,calculation_sha256,reviewed_season_id,membership_id,method_id,
       season_year,team_count,allocation_count,resolved_allocation_count,
       quarantined_allocation_count,calculated_at,calculation_content_canonical_json,
       calculation_canonical_json,calculation_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text,$13::jsonb)`,
    [
      calculation.calculationId,
      digest(calculation.calculationId, 'private-reviewed-hpn-calculation'),
      content.reviewedSeasonId,
      content.membershipId,
      content.methodId,
      content.seasonYear,
      content.teams.length,
      content.allocations.length,
      content.counts.resolvedAllocations,
      content.counts.quarantinedAllocations,
      content.calculatedAt,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(calculation),
    ]
  );
  const teams = content.teams.map((team, ordinal) => ({
    calculationId: calculation.calculationId,
    ordinal,
    teamId: team.teamId,
    totalPav: team.totalPav,
    team,
  }));
  await transaction.query(
    `INSERT INTO outcome_private_reviewed_hpn_team
      (calculation_id,ordinal,team_id,total_pav,team_json)
     SELECT "calculationId",ordinal,"teamId","totalPav",team
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "calculationId" text,ordinal integer,"teamId" text,
         "totalPav" double precision,team jsonb)`,
    [canonicalizeAflTradeJson(teams)]
  );
  const allocations = content.allocations.map((allocation, ordinal) => ({
    calculationId: calculation.calculationId,
    ordinal,
    allocationId: allocation.allocationId,
    clubId: allocation.clubId,
    identityState: allocation.identity.state,
    canonicalPlayerId:
      allocation.identity.state === 'resolved' ? allocation.identity.canonicalPlayerId : null,
    gamesPlayed: allocation.gamesPlayed,
    totalPav: allocation.totalPav,
    allocation,
  }));
  await transaction.query(
    `INSERT INTO outcome_private_reviewed_hpn_allocation
      (calculation_id,ordinal,allocation_id,club_id,identity_state,canonical_player_id,
       games_played,total_pav,allocation_json)
     SELECT "calculationId",ordinal,"allocationId","clubId","identityState",
            "canonicalPlayerId","gamesPlayed","totalPav",allocation
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "calculationId" text,ordinal integer,"allocationId" text,"clubId" text,
         "identityState" text,"canonicalPlayerId" text,"gamesPlayed" integer,
         "totalPav" double precision,allocation jsonb)`,
    [canonicalizeAflTradeJson(allocations)]
  );
}

export class PostgresAflTradePrivateReviewedHpnCalculationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async calculateAndPersist(seasonYear: number): Promise<Readonly<{
    calculation: AflTradePrivateReviewedHpnCalculation;
    idempotentReplay: boolean;
  }>> {
    if (!Number.isInteger(seasonYear) || seasonYear < 1998 || seasonYear > 2200) {
      throw new TypeError('A valid HPN season is required.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-reviewed-hpn-calculation:${seasonYear}`,
      ]);
      const reviewed = await new PostgresAflTradeHpnReviewedSeasonUniverseRepository(
        transactionClient(transaction)
      ).loadLatest(seasonYear);
      if (!reviewed) throw new Error(`No reviewed HPN season exists for ${seasonYear}.`);
      const methodId = await registerMethod(transaction);
      const replay = await loadAuthenticatedCalculation(
        transactionClient(transaction),
        `WHERE reviewed_season_id=$1 AND method_id=$2 LIMIT 1`,
        [reviewed.reviewedSeason.reviewedSeasonId, methodId]
      );
      if (replay) return { calculation: replay, idempotentReplay: true };
      const calculation = calculateAflTradePrivateReviewedHpnSeason({
        ...reviewed,
        method: createAflTradePrivateReviewedHpnMethod(),
        calculatedAt: await trustedNow(transaction),
      });
      await persistCalculation(transaction, calculation);
      const authenticated = await loadAuthenticatedCalculation(
        transactionClient(transaction),
        `WHERE calculation_id=$1`,
        [calculation.calculationId]
      );
      if (!authenticated) throw new Error('Private reviewed HPN calculation did not persist.');
      return { calculation: authenticated, idempotentReplay: false };
    });
  }

  async loadLatest(seasonYear: number): Promise<AflTradePrivateReviewedHpnCalculation | null> {
    if (!Number.isInteger(seasonYear) || seasonYear < 1998 || seasonYear > 2200) {
      throw new TypeError('A valid HPN season is required.');
    }
    return loadAuthenticatedCalculation(
      this.client,
      `WHERE season_year=$1 ORDER BY registered_at DESC,calculation_id DESC LIMIT 1`,
      [seasonYear]
    );
  }
}
