import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationRequestSchema,
  aflTradeFinalizedHpnPavCalculationSchema,
  createAflTradeFinalizedHpnPavCalculationService,
  type AflTradeFinalizedHpnPavCalculation,
  type AflTradeFinalizedHpnPavCalculationRequest,
  type AflTradeHpnPavMethodAuthority,
} from './hpnPavCalculationService';
import {
  AflTradeHpnPavCalculationError,
  aflTradeFinalizedHpnPavCalculationLoadRequestSchema,
  type AflTradeFinalizedHpnPavCalculationLoadRequest,
  type AflTradeHpnPavCalculationRepository,
  type PersistedAflTradeFinalizedHpnPavCalculation,
} from './hpnPavCalculationRepository';
import type { AflTradeHpnPavInputExecutionContext } from './hpnPavInputRepository';
import { aflTradeHpnPavMethodSchema, type AflTradeHpnPavMethod } from './hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavInputRepository } from './postgresHpnPavInputRepository';

interface TimestampRow {
  trusted_at: Date | string;
}

interface MethodRow {
  method_json: unknown;
  environment: 'test_fixture' | 'non_production' | 'production';
}

interface CalculationRow {
  calculation_json: unknown;
  finalized_at: Date | string | null;
  team_count: number;
  player_count: number;
  actual_team_count: number;
  actual_player_count: number;
}

function digestFromId(id: string, prefix: string): string {
  const expected = `${prefix}:`;
  if (!id.startsWith(expected)) throw new TypeError(`Expected ${prefix} content address.`);
  return id.slice(expected.length);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new TypeError('PostgreSQL returned an invalid time.');
  return parsed.toISOString();
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

async function trustedNow(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<TimestampRow>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (!value) throw new AflTradeHpnPavCalculationError('PERSISTENCE_REJECTED', 'No DB time.');
  return iso(value);
}

async function authenticateMethod(
  authority: AflTradeHpnPavMethodAuthority,
  methodId: string
): Promise<{ readonly method: AflTradeHpnPavMethod; readonly sourceBytes: Uint8Array }> {
  const retained = await authority.loadExact(methodId);
  const method = aflTradeHpnPavMethodSchema.parse(retained.method);
  if (
    method.methodId !== methodId ||
    !doesAflTradeArtifactRefMatchBytes(
      method.content.sourceArtifact,
      retained.sourceBytes,
      'text/html'
    )
  ) {
    throw new AflTradeHpnPavCalculationError(
      'METHOD_AUTHORITY_MISMATCH',
      'The retained HPN method bytes do not match the method.'
    );
  }
  return { method, sourceBytes: retained.sourceBytes };
}

async function registerMethodInTransaction(
  transaction: AflOutcomeSqlTransaction,
  method: AflTradeHpnPavMethod,
  execution: AflTradeHpnPavInputExecutionContext
): Promise<AflTradeHpnPavMethod> {
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `outcome-hpn-pav-method:${method.methodId}`,
  ]);
  const existing = await transaction.query<MethodRow>(
    `SELECT method_json,environment FROM outcome_hpn_pav_method WHERE method_id=$1`,
    [method.methodId]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    const stored = aflTradeHpnPavMethodSchema.parse(row?.method_json);
    if (
      row?.environment !== execution.environment ||
      canonicalizeAflTradeJson(stored) !== canonicalizeAflTradeJson(method)
    ) {
      throw new AflTradeHpnPavCalculationError('REPLAY_CONFLICT', 'HPN method replay differs.');
    }
    return stored;
  }
  const registeredAt = await trustedNow(transaction);
  const canonicalContent = canonicalizeAflTradeJson(method.content);
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_method
      (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
       method_canonical_json,method_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      method.methodId,
      digestFromId(method.methodId, 'hpn-pav-method'),
      execution.environment,
      method.content.sourceArtifact.artifactId,
      method.content.capturedAt,
      registeredAt,
      canonicalContent,
      canonicalizeAflTradeJson(method),
    ]
  );
  return method;
}

async function findCalculationReplay(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeFinalizedHpnPavCalculationRequest
): Promise<AflTradeFinalizedHpnPavCalculation | null> {
  const result = await transaction.query<CalculationRow>(
    `SELECT calculation_json,finalized_at,team_count,player_count,
       (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_team child
         WHERE child.calculation_id=calculation.calculation_id) AS actual_team_count,
       (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_player child
         WHERE child.calculation_id=calculation.calculation_id) AS actual_player_count
     FROM outcome_hpn_pav_calculation calculation
     WHERE input_set_id=$1 AND method_id=$2
       AND schema_version=$3`,
    [request.inputSetId, request.methodId, AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION]
  );
  const row = result.rows[0];
  if (!row) return null;
  const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
  if (
    !row.finalized_at ||
    row.team_count !== row.actual_team_count ||
    row.player_count !== row.actual_player_count ||
    calculation.content.environment !== request.environment ||
    calculation.content.competition !== request.competition ||
    calculation.content.seasonYear !== request.seasonYear
  ) {
    throw new AflTradeHpnPavCalculationError(
      'REPLAY_CONFLICT',
      'Stored HPN calculation is incomplete or outside the requested scope.'
    );
  }
  return calculation;
}

async function insertCalculation(
  transaction: AflOutcomeSqlTransaction,
  calculation: AflTradeFinalizedHpnPavCalculation
): Promise<void> {
  const canonicalContent = canonicalizeAflTradeJson(calculation.content);
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_calculation
      (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
       competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
       player_count,calculation_canonical_json,calculation_json,finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'building',$12,$13,$14,$15::jsonb,NULL)`,
    [
      calculation.calculationId,
      digestFromId(calculation.calculationId, 'hpn-pav-season'),
      calculation.content.schemaVersion,
      calculation.content.inputSetId,
      calculation.content.methodId,
      calculation.content.environment,
      calculation.content.competition,
      calculation.content.seasonYear,
      calculation.content.effectiveThrough,
      calculation.content.calculatedAt,
      calculation.content.valueUnit,
      calculation.content.teams.length,
      calculation.content.players.length,
      canonicalContent,
      canonicalizeAflTradeJson(calculation),
    ]
  );
  const teams = calculation.content.teams.map((team, ordinal) => ({
    calculationId: calculation.calculationId,
    teamId: team.teamId,
    ordinal,
    teamSha256: sha256AflTradeCanonicalJson(team),
    offensivePav: team.offensivePav,
    midfieldPav: team.midfieldPav,
    defensivePav: team.defensivePav,
    totalPav: team.totalPav,
    teamCanonicalJson: canonicalizeAflTradeJson(team),
  }));
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_calculation_team
      (calculation_id,team_id,ordinal,team_sha256,offensive_pav,midfield_pav,
       defensive_pav,total_pav,team_canonical_json)
     SELECT "calculationId","teamId",ordinal,"teamSha256","offensivePav","midfieldPav",
       "defensivePav","totalPav","teamCanonicalJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "calculationId" text,"teamId" text,ordinal integer,"teamSha256" text,
       "offensivePav" double precision,"midfieldPav" double precision,
       "defensivePav" double precision,"totalPav" double precision,"teamCanonicalJson" text)`,
    [canonicalizeAflTradeJson(teams)]
  );
  const players = calculation.content.players.map((player, ordinal) => ({
    calculationId: calculation.calculationId,
    spellVersionId: player.spellVersionId,
    playerId: player.playerId,
    teamId: player.teamId,
    ordinal,
    playerSha256: sha256AflTradeCanonicalJson(player),
    offensivePav: player.offensivePav,
    midfieldPav: player.midfieldPav,
    defensivePav: player.defensivePav,
    totalPav: player.totalPav,
    playerCanonicalJson: canonicalizeAflTradeJson(player),
  }));
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_calculation_player
      (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,offensive_pav,midfield_pav,
       defensive_pav,total_pav,player_canonical_json)
     SELECT "calculationId","spellVersionId","playerId","teamId",ordinal,"playerSha256","offensivePav",
       "midfieldPav","defensivePav","totalPav","playerCanonicalJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "calculationId" text,"spellVersionId" text,"playerId" text,"teamId" text,ordinal integer,
       "playerSha256" text,"offensivePav" double precision,"midfieldPav" double precision,
       "defensivePav" double precision,"totalPav" double precision,
       "playerCanonicalJson" text)`,
    [canonicalizeAflTradeJson(players)]
  );
  const finalized = await transaction.query(
    `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at
      WHERE calculation_id=$1 AND status='building'`,
    [calculation.calculationId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradeHpnPavCalculationError(
      'PERSISTENCE_REJECTED',
      'HPN calculation did not finalize.'
    );
  }
}

export class PostgresAflTradeHpnPavCalculationRepository implements AflTradeHpnPavCalculationRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly methodAuthority: AflTradeHpnPavMethodAuthority
  ) {}

  async registerMethod(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavMethod> {
    let method: AflTradeHpnPavMethod;
    try {
      method = aflTradeHpnPavMethodSchema.parse(input);
    } catch (error) {
      throw new AflTradeHpnPavCalculationError(
        'INVALID_METHOD',
        error instanceof Error ? error.message : 'Invalid HPN method.'
      );
    }
    const authenticated = await authenticateMethod(this.methodAuthority, method.methodId);
    if (canonicalizeAflTradeJson(authenticated.method) !== canonicalizeAflTradeJson(method)) {
      throw new AflTradeHpnPavCalculationError(
        'METHOD_AUTHORITY_MISMATCH',
        'HPN method differs from retained authority.'
      );
    }
    return this.client.transaction((transaction) =>
      registerMethodInTransaction(transaction, authenticated.method, execution)
    );
  }

  async calculateAndPersist(
    unparsedRequest: AflTradeFinalizedHpnPavCalculationRequest,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<PersistedAflTradeFinalizedHpnPavCalculation> {
    let request: AflTradeFinalizedHpnPavCalculationRequest;
    try {
      request = aflTradeFinalizedHpnPavCalculationRequestSchema.parse(unparsedRequest);
    } catch (error) {
      throw new AflTradeHpnPavCalculationError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid HPN calculation request.'
      );
    }
    if (request.environment !== execution.environment) {
      throw new AflTradeHpnPavCalculationError(
        'ENVIRONMENT_MISMATCH',
        'HPN calculation execution environment mismatch.'
      );
    }
    const authenticatedMethod = await authenticateMethod(this.methodAuthority, request.methodId);
    try {
      return await this.client.transaction(async (transaction) => {
        const lockKey = `outcome-hpn-pav-calculation:${request.inputSetId}:${request.methodId}:${AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION}`;
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [lockKey]);
        const replay = await findCalculationReplay(transaction, request);
        if (replay) return { calculation: replay, idempotentReplay: true };
        await registerMethodInTransaction(transaction, authenticatedMethod.method, execution);
        const calculatedAt = await trustedNow(transaction);
        const calculation = await createAflTradeFinalizedHpnPavCalculationService({
          inputRepository: new PostgresAflTradeHpnPavInputRepository(
            transactionClient(transaction)
          ),
          methodAuthority: { loadExact: async () => authenticatedMethod },
          clock: { now: () => calculatedAt },
        }).calculate(request, execution);
        await insertCalculation(transaction, calculation);
        return { calculation, idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof AflTradeHpnPavCalculationError) throw error;
      throw new AflTradeHpnPavCalculationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'HPN calculation persistence failed.'
      );
    }
  }

  async loadFinalizedCalculation(
    unparsedRequest: AflTradeFinalizedHpnPavCalculationLoadRequest,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeFinalizedHpnPavCalculation> {
    const request = aflTradeFinalizedHpnPavCalculationLoadRequestSchema.parse(unparsedRequest);
    if (request.environment !== execution.environment) {
      throw new AflTradeHpnPavCalculationError(
        'ENVIRONMENT_MISMATCH',
        'HPN calculation load environment mismatch.'
      );
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-hpn-pav-calculation:${request.calculationId}`,
      ]);
      const result = await transaction.query<CalculationRow>(
        `SELECT calculation_json,finalized_at,team_count,player_count,
           (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_team child
             WHERE child.calculation_id=calculation.calculation_id) AS actual_team_count,
           (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_player child
             WHERE child.calculation_id=calculation.calculation_id) AS actual_player_count
         FROM outcome_hpn_pav_calculation calculation WHERE calculation_id=$1`,
        [request.calculationId]
      );
      const row = result.rows[0];
      if (
        !row?.finalized_at ||
        row.team_count !== row.actual_team_count ||
        row.player_count !== row.actual_player_count
      ) {
        throw new AflTradeHpnPavCalculationError(
          'CALCULATION_NOT_FINALIZED',
          'HPN calculation is absent or not finalized.'
        );
      }
      const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
      if (calculation.content.environment !== request.environment) {
        throw new AflTradeHpnPavCalculationError(
          'ENVIRONMENT_MISMATCH',
          'Stored HPN calculation environment mismatch.'
        );
      }
      return calculation;
    });
  }
}
