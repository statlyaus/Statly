import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnPavFieldMapSchema,
  aflTradeHpnPavReviewedFields,
  aflTradeHpnPavSeasonInputSetSchema,
  createAflTradeHpnPavSeasonInputSet,
  type AflTradeHpnPavFieldMap,
  type AflTradeHpnPavSeasonInputSet,
} from './hpnPavInputContracts';
import {
  AflTradeHpnPavInputError,
  aflTradeFinalizedHpnPavInputSetRequestSchema,
  aflTradeHpnPavSeasonInputRequestSchema,
  type AflTradeFinalizedHpnPavInputSetRequest,
  type AflTradeHpnPavInputExecutionContext,
  type AflTradeHpnPavInputRepository,
  type AflTradeHpnPavSeasonInputRequest,
  type PersistedAflTradeHpnPavInputSet,
} from './hpnPavInputRepository';

type SourceSelection = AflTradeHpnPavSeasonInputRequest['sources'][number];

interface RunRow {
  normalization_run_id: string;
  capture_id: string;
  source_snapshot_id: string;
  source_artifact_id: string;
  capture_environment: string;
  capture_status: string;
  captured_at: Date | string;
  finalized_at: Date | string | null;
  staging_sha256: string;
  source_row_count: number;
  accepted_row_count: number;
  quarantined_row_count: number;
  issue_count: number;
  run_status: string;
  capability_id: string;
  source_schema_sha256: string;
  field_map_json: unknown;
}

interface DecodedRow {
  provider_decoded_row_id: string;
  normalization_run_id: string;
  source_row_sha256: string;
  typed_payload: unknown;
  row_status: string;
  player_resolution: unknown;
  match_resolution: unknown;
  home_club_resolutions: unknown;
  away_club_resolutions: unknown;
  native_match_id: string | null;
  home_club_native_id: string | null;
  home_club_name: string | null;
  away_club_native_id: string | null;
  away_club_name: string | null;
  canonical_match_date: Date | string | null;
  canonical_home_club_id: string | null;
  canonical_away_club_id: string | null;
}

interface FactualRunRow {
  factual_run_id: string;
  policy_id: string;
  input_set_sha256: string;
  status: string;
  conflict_count: number;
  finalized_at: Date | string | null;
}

interface FactualMatchRow {
  fact_ids: string[];
  match_id: string;
  effective_at: Date | string;
  home_club_id: string;
  away_club_id: string;
}

interface FactualAppearanceRow {
  fact_ids: string[];
  match_id: string;
  player_id: string;
  club_id: string;
}

interface AcquisitionSpellRow {
  provider_decoded_row_id: string;
  spell_version_id: string;
  spell_id: string;
  version: number;
  player_id: string;
  club_id: string;
  start_event_version_id: string;
  start_asset_version_id: string;
  start_date: Date | string;
  end_date: Date | string | null;
  end_reason: string | null;
  rule_id: string;
  status: string;
  supersedes_spell_version_id: string | null;
  recorded_at: Date | string;
}

interface FinalizedInputSetRow {
  input_set_json: unknown;
  input_set_canonical_json: string;
  input_set_sha256: string;
  status: string;
  finalized_at: Date | string | null;
  environment: string;
  competition: string;
  season_year: number;
  method_id: string;
  source_run_count: number;
  source_row_count: number;
  completed_match_count: number;
  actual_source_run_count: number;
  actual_source_row_count: number;
  actual_completed_match_count: number;
  factual_match_count: number;
  factual_appearance_count: number;
}

type CurrentResolution = AflTradeHpnPavSeasonInputSet['content']['rows'][number] extends infer Row
  ? Row extends { player: infer Resolution }
    ? Resolution
    : never
  : never;
type InputRow = AflTradeHpnPavSeasonInputSet['content']['rows'][number];
type PlayerInputRow = Extract<InputRow, { kind: 'player_match_stats' }>;
type UnboundInputRow =
  Exclude<InputRow, { kind: 'player_match_stats' }> | Omit<PlayerInputRow, 'acquisitionSpell'>;

function iso(value: Date | string | null, label: string): string {
  if (value === null)
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is missing.`);
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is invalid.`);
  }
  return parsed.toISOString();
}

function isoDate(value: Date | string | null, label: string): string {
  return iso(value, label).slice(0, 10);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is missing.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is invalid.`);
  }
  return value;
}

function asPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AflTradeHpnPavInputError('RESOLUTION_NOT_CURRENT', `${label} is invalid.`);
  }
  return value;
}

function digestFromId(identifier: string, prefix: string): string {
  const match = new RegExp(`^${prefix}:([a-f0-9]{64})$`).exec(identifier);
  if (!match?.[1]) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `Current ${prefix} identity is invalid.`
    );
  }
  return match[1];
}

function currentResolution(
  entityKind: 'player' | 'club' | 'match',
  unparsed: unknown
): CurrentResolution {
  const value = asObject(unparsed, `${entityKind} resolution`);
  const decisionId = asString(value.decisionId, `${entityKind} decision`);
  const assignmentDecisionId = asString(
    value.assignmentDecisionId,
    `${entityKind} assignment decision`
  );
  if (decisionId !== assignmentDecisionId || value.assignmentStatus !== 'active') {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `The ${entityKind} resolution does not own the current active assignment.`
    );
  }
  const sha256 = digestFromId(decisionId, 'provider-resolution-decision');
  return {
    entityKind,
    canonicalId: asString(value.canonicalId, `${entityKind} canonical ID`),
    revision: asPositiveInteger(value.revision, `${entityKind} revision`),
    status: 'current_approved',
    resolutionDecision: { id: decisionId, sha256 },
    assignmentDecision: { id: assignmentDecisionId, sha256 },
  };
}

function exactOneResolution(
  entityKind: 'club',
  unparsed: unknown,
  side: 'home' | 'away'
): CurrentResolution {
  if (!Array.isArray(unparsed) || unparsed.length !== 1) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `The ${side}-club resolution is absent or ambiguous.`
    );
  }
  return currentResolution(entityKind, unparsed[0]);
}

function decodedScalar(payload: unknown, field: string): string | number | boolean | null {
  const scalar = asObject(asObject(payload, 'typed payload')[field], `typed field ${field}`);
  const kind = scalar.kind;
  if (
    kind === 'missing' ||
    kind === 'nan' ||
    kind === 'positive_infinity' ||
    kind === 'negative_infinity'
  ) {
    return null;
  }
  if (kind === 'logical') {
    if (typeof scalar.value !== 'boolean') {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is not logical.`);
    }
    return scalar.value;
  }
  if (kind === 'integer' || kind === 'finite_number') {
    const number = Number(scalar.value);
    if (!Number.isFinite(number)) {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is not finite.`);
    }
    return number;
  }
  if (kind === 'text' || kind === 'factor' || kind === 'date' || kind === 'datetime') {
    return asString(scalar.value, field);
  }
  throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} has an unsupported type.`);
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AflTradeHpnPavInputError(
      'INCOMPLETE_SOURCE_ROWS',
      `${field} must be an observed nonnegative integer.`
    );
  }
  return value;
}

function sourceValues(row: DecodedRow, fieldMap: AflTradeHpnPavFieldMap) {
  const fields = aflTradeHpnPavReviewedFields(fieldMap.content);
  return Object.fromEntries(
    fields.map((field) => [field, decodedScalar(row.typed_payload, field)])
  );
}

function resolutionSql(entity: 'player' | 'match', candidateAlias: string): string {
  const table = `outcome_provider_${entity}_resolution`;
  const head = `outcome_provider_${entity}_resolution_head`;
  const candidateColumn = entity === 'player' ? 'identity_candidate_id' : 'match_candidate_id';
  const canonicalColumn = entity === 'player' ? 'player_id' : 'match_id';
  return `SELECT jsonb_build_object(
      'canonicalId', resolution.${canonicalColumn}, 'revision', head.revision,
      'decisionId', resolution.decision_id,
      'assignmentDecisionId', assignment.decision_id,
      'assignmentStatus', assignment.status) AS value
    FROM ${head} head
    JOIN ${table} resolution ON resolution.resolution_id=head.resolution_id
    JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE head.${candidateColumn}=${candidateAlias}.${candidateColumn}
      AND resolution.outcome='approved' AND assignment.decision_id=resolution.decision_id
      AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}

function clubResolutionSql(side: 'home' | 'away'): string {
  return `SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'canonicalId', resolution.club_id, 'revision', head.revision,
      'decisionId', resolution.decision_id,
      'assignmentDecisionId', assignment.decision_id,
      'assignmentStatus', assignment.status)), '[]'::jsonb) AS values
    FROM outcome_provider_club_resolution resolution
    JOIN outcome_provider_club_resolution_head head ON head.resolution_id=resolution.resolution_id
    JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE resolution.match_candidate_id=match_candidate.match_candidate_id
      AND resolution.side='${side}' AND resolution.outcome='approved'
      AND assignment.decision_id=resolution.decision_id AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}

async function loadDecodedRows(
  transaction: AflOutcomeSqlTransaction,
  runIds: readonly string[]
): Promise<readonly DecodedRow[]> {
  const result = await transaction.query<DecodedRow>(
    `SELECT decoded.provider_decoded_row_id, decoded.normalization_run_id,
            decoded.source_row_sha256, decoded.typed_payload, decoded.row_status,
            player_resolution.value AS player_resolution,
            match_resolution.value AS match_resolution,
            home_club.values AS home_club_resolutions,
            away_club.values AS away_club_resolutions,
            match_candidate.native_match_id, match_candidate.home_club_native_id,
            match_candidate.home_club_name, match_candidate.away_club_native_id,
            match_candidate.away_club_name, canonical_match.match_date AS canonical_match_date,
            canonical_match.home_club_id AS canonical_home_club_id,
            canonical_match.away_club_id AS canonical_away_club_id
       FROM outcome_provider_decoded_row decoded
       LEFT JOIN outcome_provider_identity_candidate identity_candidate
         ON identity_candidate.provider_decoded_row_id=decoded.provider_decoded_row_id
       LEFT JOIN outcome_provider_match_candidate match_candidate
         ON match_candidate.provider_decoded_row_id=decoded.provider_decoded_row_id
       LEFT JOIN LATERAL (${resolutionSql('player', 'identity_candidate')}) player_resolution ON TRUE
       LEFT JOIN LATERAL (${resolutionSql('match', 'match_candidate')}) match_resolution ON TRUE
       LEFT JOIN outcome_match canonical_match
         ON canonical_match.match_id=match_resolution.value->>'canonicalId'
       LEFT JOIN LATERAL (${clubResolutionSql('home')}) home_club ON TRUE
       LEFT JOIN LATERAL (${clubResolutionSql('away')}) away_club ON TRUE
      WHERE decoded.normalization_run_id = ANY($1::text[])
      ORDER BY decoded.provider_decoded_row_id`,
    [runIds]
  );
  return result.rows;
}

async function loadRuns(
  transaction: AflOutcomeSqlTransaction,
  selections: readonly SourceSelection[]
): Promise<Map<string, { row: RunRow; map: AflTradeHpnPavFieldMap; selection: SourceSelection }>> {
  const requested = canonicalizeAflTradeJson(selections);
  const result = await transaction.query<RunRow>(
    `SELECT run.normalization_run_id, run.capture_id, capture.source_snapshot_id,
            capture.source_artifact_id, capture.environment::text AS capture_environment,
            capture.status::text AS capture_status, capture.captured_at, run.finalized_at,
            run.staging_sha256, run.source_row_count, run.accepted_row_count,
            run.quarantined_row_count, run.issue_count, run.status::text AS run_status,
            decode_map.capability_id, decode_map.source_schema_sha256,
            pav_map.map_json AS field_map_json
       FROM jsonb_to_recordset($1::jsonb) AS requested(
         "normalizationRunId" text, "fieldMapId" text, "inputKind" text, role text)
       JOIN outcome_provider_normalization_run run
         ON run.normalization_run_id=requested."normalizationRunId"
       JOIN outcome_provider_field_map decode_map ON decode_map.field_map_id=run.field_map_id
       JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
       JOIN outcome_hpn_pav_field_map pav_map ON pav_map.field_map_id=requested."fieldMapId"
      ORDER BY run.normalization_run_id
      FOR SHARE OF run, capture, decode_map, pav_map`,
    [requested]
  );
  if (result.rows.length !== selections.length) {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      'One or more reviewed source runs or field maps do not exist.'
    );
  }
  const output = new Map<
    string,
    { row: RunRow; map: AflTradeHpnPavFieldMap; selection: SourceSelection }
  >();
  for (const row of result.rows) {
    const selection = selections.find(
      ({ normalizationRunId }) => normalizationRunId === row.normalization_run_id
    );
    if (!selection)
      throw new AflTradeHpnPavInputError('INVALID_REQUEST', 'Source selection drifted.');
    const map = aflTradeHpnPavFieldMapSchema.parse(row.field_map_json);
    output.set(row.normalization_run_id, { row, map, selection });
  }
  return output;
}

async function loadFactualUniverse(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeHpnPavSeasonInputRequest,
  createdAt: string
): Promise<AflTradeHpnPavSeasonInputSet['content']['factualUniverse']> {
  const run = await transaction.query<FactualRunRow>(
    `SELECT run.factual_run_id,run.policy_id,run.input_set_sha256,
            run.status::text AS status,run.conflict_count,run.finalized_at
       FROM outcome_factual_reconciliation_run run
       JOIN outcome_factual_reconciliation_policy policy ON policy.policy_id=run.policy_id
      WHERE run.factual_run_id=$1 AND run.environment=$2::"OutcomeEnvironment"
        AND run.competition=$3 AND run.season_year=$4
        AND run.status='approved' AND run.finalized_at IS NOT NULL AND run.conflict_count=0
        AND policy.status='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
          WHERE successor.supersedes_decision_id=policy.approval_decision_id)
      FOR SHARE OF run,policy`,
    [request.factualRunId, request.environment, request.competition, request.seasonYear]
  );
  const authority = run.rows[0];
  if (
    !authority ||
    authority.status !== 'approved' ||
    authority.conflict_count !== 0 ||
    authority.finalized_at === null ||
    Date.parse(iso(authority.finalized_at, 'factual finalization')) > Date.parse(createdAt)
  ) {
    throw new AflTradeHpnPavInputError(
      'FACTUAL_UNIVERSE_MISMATCH',
      'The factual reconciliation universe is not current, clean, finalized, and approved.'
    );
  }
  const [matches, appearances] = await Promise.all([
    transaction.query<FactualMatchRow>(
      `SELECT array_agg(input.match_fact_id ORDER BY input.match_fact_id) AS fact_ids,
              fact.match_id,fact.effective_at,fact_json->'content'->'match'->'homeClub'->>'clubId' AS home_club_id,
              fact_json->'content'->'match'->'awayClub'->>'clubId' AS away_club_id
         FROM outcome_factual_reconciliation_match_input input
         JOIN outcome_provider_match_universe_fact fact ON fact.match_fact_id=input.match_fact_id
        WHERE input.factual_run_id=$1 AND fact.availability='measured'
          AND fact.completion_state='completed'
        GROUP BY fact.match_id,fact.effective_at,home_club_id,away_club_id
        ORDER BY fact.match_id`,
      [request.factualRunId]
    ),
    transaction.query<FactualAppearanceRow>(
      `SELECT array_agg(input.appearance_fact_id ORDER BY input.appearance_fact_id) AS fact_ids,
              fact.match_id,fact.player_id,fact.represented_club_id AS club_id
         FROM outcome_factual_reconciliation_appearance_input input
         JOIN outcome_provider_player_appearance_fact fact
           ON fact.appearance_fact_id=input.appearance_fact_id
        WHERE input.factual_run_id=$1 AND fact.availability='measured' AND fact.appeared=TRUE
        GROUP BY fact.match_id,fact.player_id,fact.represented_club_id
        ORDER BY fact.match_id,fact.represented_club_id,fact.player_id`,
      [request.factualRunId]
    ),
  ]);
  if (matches.rows.length === 0 || appearances.rows.length === 0) {
    throw new AflTradeHpnPavInputError(
      'FACTUAL_UNIVERSE_MISMATCH',
      'The approved factual run has no complete match and appearance universe.'
    );
  }
  return {
    factualRunId: authority.factual_run_id,
    policyId: authority.policy_id,
    inputSetSha256: authority.input_set_sha256,
    status: 'approved',
    finalizedAt: iso(authority.finalized_at, 'factual finalization'),
    completedMatchFacts: matches.rows.map((match) => ({
      factIds: [...match.fact_ids],
      matchId: match.match_id,
      effectiveAt: iso(match.effective_at, 'factual match time'),
      homeClubId: match.home_club_id,
      awayClubId: match.away_club_id,
    })),
    playerAppearanceFacts: appearances.rows.map((appearance) => ({
      factIds: [...appearance.fact_ids],
      matchId: appearance.match_id,
      playerId: appearance.player_id,
      clubId: appearance.club_id,
    })),
  };
}

function requireRunAuthority(
  request: AflTradeHpnPavSeasonInputRequest,
  createdAt: string,
  context: { row: RunRow; map: AflTradeHpnPavFieldMap; selection: SourceSelection }
): void {
  const { row, map, selection } = context;
  if (
    row.capture_environment !== request.environment ||
    row.capture_status !== 'approved' ||
    row.run_status !== 'staged' ||
    row.finalized_at === null ||
    row.source_row_count !== row.accepted_row_count ||
    row.quarantined_row_count !== 0 ||
    row.issue_count !== 0 ||
    row.capability_id !== map.content.capabilityId ||
    row.source_schema_sha256 !== map.content.sourceSchemaSha256 ||
    map.fieldMapId !== selection.fieldMapId ||
    map.content.inputKind !== selection.inputKind ||
    map.content.environment !== request.environment ||
    map.content.competition !== request.competition ||
    request.seasonYear < map.content.validFromSeason ||
    request.seasonYear > map.content.validThroughSeason ||
    Date.parse(iso(row.captured_at, 'capture time')) > Date.parse(request.effectiveThrough) ||
    Date.parse(iso(row.finalized_at, 'run finalization')) > Date.parse(createdAt)
  ) {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      `Run ${row.normalization_run_id} is not an exact clean reviewed source.`
    );
  }
}

function choosePlayerClub(row: DecodedRow, sourceClub: unknown): CurrentResolution {
  if (typeof sourceClub !== 'string') {
    throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'Player club is not observed.');
  }
  const home = sourceClub === row.home_club_native_id || sourceClub === row.home_club_name;
  const away = sourceClub === row.away_club_native_id || sourceClub === row.away_club_name;
  if (home === away) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      'Player club cannot be assigned to exactly one match side.'
    );
  }
  return exactOneResolution(
    'club',
    home ? row.home_club_resolutions : row.away_club_resolutions,
    home ? 'home' : 'away'
  );
}

function buildRows(
  decodedRows: readonly DecodedRow[],
  contexts: ReadonlyMap<
    string,
    { row: RunRow; map: AflTradeHpnPavFieldMap; selection: SourceSelection }
  >
): UnboundInputRow[] {
  return decodedRows.map((decoded) => {
    const context = contexts.get(decoded.normalization_run_id);
    if (!context || decoded.row_status !== 'staged') {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'A decoded row is not clean.');
    }
    const values = sourceValues(decoded, context.map);
    const source = {
      normalizationRunId: decoded.normalization_run_id,
      providerDecodedRowId: decoded.provider_decoded_row_id,
      sourceRowSha256: decoded.source_row_sha256,
      typedPayloadSha256: sha256AflTradeCanonicalJson(decoded.typed_payload),
      sourceFields: Object.keys(values).sort(),
      sourceValues: values,
    };
    if (context.map.content.inputKind === 'completed_match_result') {
      const bindings = context.map.content.bindings;
      const status = values[bindings.completionStatus];
      if (typeof status !== 'string' || !bindings.completedValues.includes(status)) {
        throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'Match is not completed.');
      }
      return {
        kind: 'completed_match_result' as const,
        source,
        match: currentResolution('match', decoded.match_resolution),
        effectiveAt: iso(decoded.canonical_match_date, 'canonical match date'),
        homeClub: exactOneResolution('club', decoded.home_club_resolutions, 'home'),
        awayClub: exactOneResolution('club', decoded.away_club_resolutions, 'away'),
        homePoints: nonnegativeInteger(values[bindings.homePoints], bindings.homePoints),
        awayPoints: nonnegativeInteger(values[bindings.awayPoints], bindings.awayPoints),
        completionStatus: 'completed' as const,
      };
    }
    const bindings = context.map.content.bindings;
    const points =
      bindings.totalPoints.kind === 'total_points'
        ? nonnegativeInteger(
            values[bindings.totalPoints.totalPoints],
            bindings.totalPoints.totalPoints
          )
        : nonnegativeInteger(values[bindings.totalPoints.goals], bindings.totalPoints.goals) * 6 +
          nonnegativeInteger(values[bindings.totalPoints.behinds], bindings.totalPoints.behinds);
    return {
      kind: 'player_match_stats' as const,
      role: context.selection.role as 'primary' | 'corroborating',
      source,
      match: currentResolution('match', decoded.match_resolution),
      player: currentResolution('player', decoded.player_resolution),
      club: choosePlayerClub(decoded, values[bindings.club]),
      stats: {
        totalPoints: points,
        hitOuts: nonnegativeInteger(values[bindings.hitOuts], bindings.hitOuts),
        goalAssists: nonnegativeInteger(values[bindings.goalAssists], bindings.goalAssists),
        inside50s: nonnegativeInteger(values[bindings.inside50s], bindings.inside50s),
        marks: nonnegativeInteger(values[bindings.marks], bindings.marks),
        marksInside50: nonnegativeInteger(values[bindings.marksInside50], bindings.marksInside50),
        freeKicksFor: nonnegativeInteger(values[bindings.freeKicksFor], bindings.freeKicksFor),
        freeKicksAgainst: nonnegativeInteger(
          values[bindings.freeKicksAgainst],
          bindings.freeKicksAgainst
        ),
        rebound50s: nonnegativeInteger(values[bindings.rebound50s], bindings.rebound50s),
        onePercenters: nonnegativeInteger(values[bindings.onePercenters], bindings.onePercenters),
        clearances: nonnegativeInteger(values[bindings.clearances], bindings.clearances),
        tackles: nonnegativeInteger(values[bindings.tackles], bindings.tackles),
      },
    };
  });
}

async function bindAcquisitionSpells(
  transaction: AflOutcomeSqlTransaction,
  rows: readonly UnboundInputRow[],
  completedMatches: readonly AflTradeHpnPavSeasonInputSet['content']['completedMatches'][number][],
  createdAt: string
): Promise<AflTradeHpnPavSeasonInputSet['content']['rows']> {
  const matchTimes = new Map(completedMatches.map((match) => [match.matchId, match.effectiveAt]));
  const requested = rows
    .filter(
      (row): row is Omit<PlayerInputRow, 'acquisitionSpell'> => row.kind === 'player_match_stats'
    )
    .map((row) => {
      const effectiveAt = matchTimes.get(row.match.canonicalId);
      if (!effectiveAt) {
        throw new AflTradeHpnPavInputError(
          'FACTUAL_UNIVERSE_MISMATCH',
          'A player row has no completed-match time for acquisition-spell binding.'
        );
      }
      return {
        providerDecodedRowId: row.source.providerDecodedRowId,
        playerId: row.player.canonicalId,
        clubId: row.club.canonicalId,
        effectiveDate: effectiveAt.slice(0, 10),
      };
    });
  const result = await transaction.query<AcquisitionSpellRow>(
    `SELECT requested."providerDecodedRowId" AS provider_decoded_row_id,
            spell.spell_version_id,spell.spell_id,spell.version,spell.player_id,spell.club_id,
            spell.start_event_version_id,spell.start_asset_version_id,spell.start_date,
            spell.end_date,spell.end_reason,spell.rule_id,spell.status::text AS status,
            spell.supersedes_spell_version_id,spell.recorded_at
       FROM jsonb_to_recordset($1::jsonb) AS requested(
         "providerDecodedRowId" text,"playerId" text,"clubId" text,"effectiveDate" date)
       JOIN outcome_acquisition_spell_version spell
         ON spell.player_id=requested."playerId" AND spell.club_id=requested."clubId"
        AND spell.start_date<=requested."effectiveDate"
        AND (spell.end_date IS NULL OR spell.end_date>=requested."effectiveDate")
      WHERE spell.status='approved' AND spell.recorded_at<=$2::timestamptz
        AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
          WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
      ORDER BY requested."providerDecodedRowId",spell.spell_version_id
      FOR SHARE OF spell`,
    [canonicalizeAflTradeJson(requested), createdAt]
  );
  const byRow = new Map<string, AcquisitionSpellRow[]>();
  for (const spell of result.rows) {
    const matches = byRow.get(spell.provider_decoded_row_id) ?? [];
    matches.push(spell);
    byRow.set(spell.provider_decoded_row_id, matches);
  }
  return rows.map((row) => {
    if (row.kind !== 'player_match_stats') return row;
    const matches = byRow.get(row.source.providerDecodedRowId) ?? [];
    if (matches.length !== 1) {
      throw new AflTradeHpnPavInputError(
        'RESOLUTION_NOT_CURRENT',
        'Every player-stat row requires exactly one current approved acquisition spell.'
      );
    }
    const spell = matches[0]!;
    return {
      ...row,
      acquisitionSpell: {
        spellVersionId: spell.spell_version_id,
        spellId: spell.spell_id,
        version: spell.version,
        playerId: spell.player_id,
        clubId: spell.club_id,
        startEventVersionId: spell.start_event_version_id,
        startAssetVersionId: spell.start_asset_version_id,
        startDate: isoDate(spell.start_date, 'spell start date'),
        endDate: spell.end_date === null ? null : isoDate(spell.end_date, 'spell end date'),
        endReason: spell.end_reason,
        ruleId: spell.rule_id,
        status: 'approved' as const,
        supersedesSpellVersionId: spell.supersedes_spell_version_id,
        recordedAt: iso(spell.recorded_at, 'spell recorded time'),
      },
    };
  });
}

function requireFactualUniverseCoverage(
  rows: AflTradeHpnPavSeasonInputSet['content']['rows'],
  universe: AflTradeHpnPavSeasonInputSet['content']['factualUniverse'],
  contexts: ReadonlyMap<string, { map: AflTradeHpnPavFieldMap }>
): void {
  const exactSet = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  const factualMatchIds = universe.completedMatchFacts.map(({ matchId }) => matchId).sort();
  const resultMatchIds = rows
    .filter((row) => row.kind === 'completed_match_result')
    .map(({ match }) => match.canonicalId)
    .sort();
  if (!exactSet(factualMatchIds, resultMatchIds)) {
    throw new AflTradeHpnPavInputError(
      'FACTUAL_UNIVERSE_MISMATCH',
      'Result rows do not equal the approved completed-match universe.'
    );
  }
  const providers = new Set(
    rows
      .filter((row) => row.kind === 'player_match_stats')
      .map(({ source }) => contexts.get(source.normalizationRunId)?.map.content.provider)
  );
  for (const match of universe.completedMatchFacts) {
    for (const clubId of [match.homeClubId, match.awayClubId]) {
      const expected = universe.playerAppearanceFacts
        .filter(
          (appearance) => appearance.matchId === match.matchId && appearance.clubId === clubId
        )
        .map(({ playerId }) => playerId)
        .sort();
      for (const provider of providers) {
        const actual = rows
          .filter(
            (row) =>
              row.kind === 'player_match_stats' &&
              contexts.get(row.source.normalizationRunId)?.map.content.provider === provider &&
              row.match.canonicalId === match.matchId &&
              row.club.canonicalId === clubId
          )
          .map((row) => (row.kind === 'player_match_stats' ? row.player.canonicalId : ''))
          .sort();
        if (!provider || !exactSet(expected, actual)) {
          throw new AflTradeHpnPavInputError(
            'FACTUAL_UNIVERSE_MISMATCH',
            'Every selected provider must equal the approved player-appearance universe.'
          );
        }
      }
    }
  }
}

async function persistInputSet(
  transaction: AflOutcomeSqlTransaction,
  inputSet: AflTradeHpnPavSeasonInputSet,
  contexts: ReadonlyMap<string, { selection: SourceSelection }>
): Promise<void> {
  const content = inputSet.content;
  const inputSetSha256 = digestFromId(inputSet.inputSetId, 'hpn-pav-input-set');
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_set
      (input_set_id,factual_run_id,factual_input_set_sha256,factual_finalized_at,
       environment,competition,season_year,method_id,effective_through,created_at,
       input_set_sha256,status,source_run_count,source_row_count,completed_match_count,
       result_row_count,primary_player_row_count,corroborating_player_row_count,
       input_set_canonical_json,input_set_json)
     VALUES ($1,$2,$3,$4,$5::"OutcomeEnvironment",$6,$7,$8,$9,$10,$11,'building',
             $12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
    [
      inputSet.inputSetId,
      content.factualUniverse.factualRunId,
      content.factualUniverse.inputSetSha256,
      content.factualUniverse.finalizedAt,
      content.environment,
      content.competition,
      content.seasonYear,
      content.methodId,
      content.effectiveThrough,
      content.createdAt,
      inputSetSha256,
      content.sourceRuns.length,
      content.rows.length,
      content.counts.completedMatches,
      content.counts.resultRows,
      content.counts.primaryPlayerRows,
      content.counts.corroboratingPlayerRows,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(inputSet),
    ]
  );
  const runRows = content.sourceRuns.map((run, ordinal) => {
    const selection = contexts.get(run.normalizationRunId)?.selection;
    if (!selection)
      throw new AflTradeHpnPavInputError('PERSISTENCE_REJECTED', 'Run selection vanished.');
    return {
      inputSetId: inputSet.inputSetId,
      ordinal,
      normalizationRunId: run.normalizationRunId,
      fieldMapId: run.fieldMapId,
      inputKind: selection.inputKind,
      role: selection.role,
    };
  });
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_run
      (input_set_id,ordinal,normalization_run_id,field_map_id,input_kind,role)
     SELECT "inputSetId",ordinal,"normalizationRunId","fieldMapId","inputKind",role
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "inputSetId" text, ordinal integer, "normalizationRunId" text,
         "fieldMapId" text, "inputKind" text, role text)`,
    [canonicalizeAflTradeJson(runRows)]
  );
  const rowRows = content.rows.map((row, ordinal) => ({
    inputSetId: inputSet.inputSetId,
    ordinal,
    normalizationRunId: row.source.normalizationRunId,
    providerDecodedRowId: row.source.providerDecodedRowId,
    rowKind: row.kind,
    role: row.kind === 'player_match_stats' ? row.role : null,
    sourceRowSha256: row.source.sourceRowSha256,
    typedPayloadSha256: row.source.typedPayloadSha256,
    rowSha256: sha256AflTradeCanonicalJson(row),
    rowCanonicalJson: canonicalizeAflTradeJson(row),
    row,
  }));
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_row
      (input_set_id,ordinal,normalization_run_id,provider_decoded_row_id,row_kind,role,
       source_row_sha256,typed_payload_sha256,row_sha256,row_canonical_json,row_json)
     SELECT "inputSetId",ordinal,"normalizationRunId","providerDecodedRowId","rowKind",role,
            "sourceRowSha256","typedPayloadSha256","rowSha256","rowCanonicalJson",row
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "inputSetId" text, ordinal integer, "normalizationRunId" text,
         "providerDecodedRowId" text, "rowKind" text, role text,
         "sourceRowSha256" text, "typedPayloadSha256" text, "rowSha256" text,
         "rowCanonicalJson" text, row jsonb)`,
    [canonicalizeAflTradeJson(rowRows)]
  );
  const matchRows = content.completedMatches.map((match, ordinal) => {
    const result = content.rows.find(
      (row) => row.kind === 'completed_match_result' && row.match.canonicalId === match.matchId
    );
    if (!result) throw new AflTradeHpnPavInputError('PERSISTENCE_REJECTED', 'Result row vanished.');
    return {
      inputSetId: inputSet.inputSetId,
      ordinal,
      matchId: match.matchId,
      resultProviderDecodedRowId: result.source.providerDecodedRowId,
      effectiveAt: match.effectiveAt,
      homeClubId: match.homeClubId,
      awayClubId: match.awayClubId,
      matchSha256: sha256AflTradeCanonicalJson(match),
      matchCanonicalJson: canonicalizeAflTradeJson(match),
    };
  });
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_match
      (input_set_id,ordinal,match_id,result_provider_decoded_row_id,effective_at,
       home_club_id,away_club_id,match_sha256,match_canonical_json)
     SELECT "inputSetId",ordinal,"matchId","resultProviderDecodedRowId","effectiveAt"::timestamptz,
            "homeClubId","awayClubId","matchSha256","matchCanonicalJson"
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "inputSetId" text, ordinal integer, "matchId" text,
         "resultProviderDecodedRowId" text, "effectiveAt" text,
         "homeClubId" text, "awayClubId" text, "matchSha256" text,
         "matchCanonicalJson" text)`,
    [canonicalizeAflTradeJson(matchRows)]
  );
  const factualMatchMembers = content.factualUniverse.completedMatchFacts
    .flatMap(({ factIds }) => factIds)
    .map((factId, ordinal) => ({ inputSetId: inputSet.inputSetId, factId, ordinal }));
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_factual_match_member(input_set_id,fact_id,ordinal)
     SELECT "inputSetId","factId",ordinal
       FROM jsonb_to_recordset($1::jsonb) AS value("inputSetId" text,"factId" text,ordinal integer)`,
    [canonicalizeAflTradeJson(factualMatchMembers)]
  );
  const factualAppearanceMembers = content.factualUniverse.playerAppearanceFacts
    .flatMap(({ factIds }) => factIds)
    .map((factId, ordinal) => ({ inputSetId: inputSet.inputSetId, factId, ordinal }));
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_factual_appearance_member(input_set_id,fact_id,ordinal)
     SELECT "inputSetId","factId",ordinal
       FROM jsonb_to_recordset($1::jsonb) AS value("inputSetId" text,"factId" text,ordinal integer)`,
    [canonicalizeAflTradeJson(factualAppearanceMembers)]
  );
  await transaction.query(
    `UPDATE outcome_hpn_pav_input_set SET status='finalized', finalized_at=created_at
      WHERE input_set_id=$1 AND status='building'`,
    [inputSet.inputSetId]
  );
}

export class PostgresAflTradeHpnPavInputRepository implements AflTradeHpnPavInputRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async registerFieldMap(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavFieldMap> {
    let fieldMap: AflTradeHpnPavFieldMap;
    try {
      fieldMap = aflTradeHpnPavFieldMapSchema.parse(input);
    } catch (error) {
      throw new AflTradeHpnPavInputError(
        'INVALID_FIELD_MAP',
        error instanceof Error ? error.message : 'Invalid field map.'
      );
    }
    if (execution.environment !== fieldMap.content.environment) {
      throw new AflTradeHpnPavInputError('ENVIRONMENT_MISMATCH', 'Field-map environment mismatch.');
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `hpn-pav-field-map:${fieldMap.fieldMapId}`,
        ]);
        const existing = await transaction.query<{ map_json: unknown }>(
          `SELECT map_json FROM outcome_hpn_pav_field_map WHERE field_map_id=$1`,
          [fieldMap.fieldMapId]
        );
        if (existing.rows[0]) {
          if (
            canonicalizeAflTradeJson(existing.rows[0].map_json) !==
            canonicalizeAflTradeJson(fieldMap)
          ) {
            throw new AflTradeHpnPavInputError(
              'REPLAY_CONFLICT',
              'Field-map ID has conflicting content.'
            );
          }
          return fieldMap;
        }
        const digest = digestFromId(fieldMap.fieldMapId, 'hpn-pav-field-map');
        await transaction.query(
          `INSERT INTO outcome_hpn_pav_field_map
            (field_map_id,environment,competition,provider,capability_id,input_kind,
             source_schema_sha256,valid_from_season,valid_through_season,field_map_sha256,
             approval_decision_id,approval_decision_sha256,created_at,
             field_map_canonical_json,map_json)
           SELECT $1,$2::"OutcomeEnvironment",$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                  decision.decided_at,$13,$14::jsonb
             FROM outcome_review_decision decision WHERE decision.decision_id=$11`,
          [
            fieldMap.fieldMapId,
            fieldMap.content.environment,
            fieldMap.content.competition,
            fieldMap.content.provider,
            fieldMap.content.capabilityId,
            fieldMap.content.inputKind,
            fieldMap.content.sourceSchemaSha256,
            fieldMap.content.validFromSeason,
            fieldMap.content.validThroughSeason,
            digest,
            fieldMap.content.approvalDecision.id,
            fieldMap.content.approvalDecision.sha256,
            canonicalizeAflTradeJson(fieldMap.content),
            canonicalizeAflTradeJson(fieldMap),
          ]
        );
        return fieldMap;
      });
    } catch (error) {
      if (error instanceof AflTradeHpnPavInputError) throw error;
      throw new AflTradeHpnPavInputError(
        'FIELD_MAP_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the field map.'
      );
    }
  }

  async buildAndPersistSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<PersistedAflTradeHpnPavInputSet> {
    let request: AflTradeHpnPavSeasonInputRequest;
    try {
      request = aflTradeHpnPavSeasonInputRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradeHpnPavInputError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid PAV request.'
      );
    }
    if (execution.environment !== request.environment) {
      throw new AflTradeHpnPavInputError(
        'ENVIRONMENT_MISMATCH',
        'PAV execution environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `hpn-pav-input:${request.environment}:${request.competition}:${request.seasonYear}:${request.methodId}:${request.effectiveThrough}`,
        ]);
        const scopeReplay = await transaction.query<{
          input_set_json: unknown;
          finalized_at: Date | string | null;
        }>(
          `SELECT input_set_json,finalized_at
             FROM outcome_hpn_pav_input_set
            WHERE environment=$1::"OutcomeEnvironment" AND competition=$2 AND season_year=$3
              AND method_id=$4 AND effective_through=$5::timestamptz
            FOR SHARE`,
          [
            request.environment,
            request.competition,
            request.seasonYear,
            request.methodId,
            request.effectiveThrough,
          ]
        );
        if (scopeReplay.rows[0]) {
          let existing: AflTradeHpnPavSeasonInputSet;
          try {
            existing = aflTradeHpnPavSeasonInputSetSchema.parse(scopeReplay.rows[0].input_set_json);
          } catch {
            throw new AflTradeHpnPavInputError(
              'REPLAY_CONFLICT',
              'The logical PAV input scope contains an unauthenticated immutable record.'
            );
          }
          const requestedSources = request.sources
            .map(
              ({ normalizationRunId, fieldMapId, inputKind, role }) =>
                `${normalizationRunId}|${fieldMapId}|${inputKind}|${role ?? ''}`
            )
            .sort();
          const persistedMaps = new Map(
            existing.content.fieldMaps.map((fieldMap) => [fieldMap.fieldMapId, fieldMap])
          );
          const persistedSources = existing.content.sourceRuns
            .map((run) => {
              const fieldMap = persistedMaps.get(run.fieldMapId);
              if (fieldMap?.content.inputKind === 'completed_match_result') {
                return `${run.normalizationRunId}|${run.fieldMapId}|completed_match_result|`;
              }
              const roles = [
                ...new Set(
                  existing.content.rows.flatMap((row) =>
                    row.kind === 'player_match_stats' &&
                    row.source.normalizationRunId === run.normalizationRunId
                      ? [row.role]
                      : []
                  )
                ),
              ];
              return `${run.normalizationRunId}|${run.fieldMapId}|${fieldMap?.content.inputKind ?? ''}|${roles.length === 1 ? (roles[0] ?? '') : 'mixed'}`;
            })
            .sort();
          if (
            scopeReplay.rows[0].finalized_at === null ||
            existing.content.factualUniverse.factualRunId !== request.factualRunId ||
            requestedSources.length !== persistedSources.length ||
            requestedSources.some((source, index) => source !== persistedSources[index])
          ) {
            throw new AflTradeHpnPavInputError(
              'REPLAY_CONFLICT',
              'The logical PAV input scope already has different or unfinished immutable content.'
            );
          }
          return { inputSet: existing, idempotentReplay: true };
        }
        const clock = await transaction.query<{ created_at: Date | string }>(
          `SELECT transaction_timestamp() AS created_at`
        );
        const createdAt = iso(clock.rows[0]?.created_at, 'transaction time');
        if (Date.parse(request.effectiveThrough) > Date.parse(createdAt)) {
          throw new AflTradeHpnPavInputError(
            'INVALID_REQUEST',
            'PAV input creation precedes its evidence cutoff.'
          );
        }
        const factualUniverse = await loadFactualUniverse(transaction, request, createdAt);
        const contexts = await loadRuns(transaction, request.sources);
        for (const context of contexts.values()) requireRunAuthority(request, createdAt, context);
        const decodedRows = await loadDecodedRows(transaction, [...contexts.keys()]);
        const expectedRows = [...contexts.values()].reduce(
          (sum, context) => sum + context.row.source_row_count,
          0
        );
        if (decodedRows.length !== expectedRows) {
          throw new AflTradeHpnPavInputError(
            'INCOMPLETE_SOURCE_ROWS',
            'Not every finalized decoded row was loaded.'
          );
        }
        const unboundRows = buildRows(decodedRows, contexts);
        const sourceRuns = [...contexts.values()].map(({ row, map }) => ({
          normalizationRunId: row.normalization_run_id,
          captureId: row.capture_id,
          sourceSnapshotId: row.source_snapshot_id,
          sourceArtifactId: row.source_artifact_id,
          provider: map.content.provider,
          capabilityId: map.content.capabilityId,
          fieldMapId: map.fieldMapId,
          competition: request.competition,
          seasonYear: request.seasonYear,
          stagingSha256: row.staging_sha256,
          sourceRowCount: row.source_row_count,
          acceptedRowCount: row.accepted_row_count,
          issueCount: 0 as const,
          status: 'staged' as const,
          capturedAt: iso(row.captured_at, 'capture time'),
          finalizedAt: iso(row.finalized_at, 'run finalization'),
        }));
        const completedMatches = unboundRows
          .filter((row) => row.kind === 'completed_match_result')
          .map((row) => ({
            matchId: row.match.canonicalId,
            effectiveAt: row.effectiveAt,
            homeClubId: row.homeClub.canonicalId,
            awayClubId: row.awayClub.canonicalId,
          }));
        const rows = await bindAcquisitionSpells(
          transaction,
          unboundRows,
          completedMatches,
          createdAt
        );
        requireFactualUniverseCoverage(rows, factualUniverse, contexts);
        const inputSet = createAflTradeHpnPavSeasonInputSet({
          environment: request.environment,
          competition: request.competition,
          seasonYear: request.seasonYear,
          effectiveThrough: request.effectiveThrough,
          createdAt,
          methodId: request.methodId,
          factualUniverse,
          fieldMaps: [...contexts.values()].map(({ map }) => map),
          sourceRuns,
          completedMatches,
          rows,
        });
        const replay = await transaction.query<{
          input_set_json: unknown;
          finalized_at: Date | string | null;
        }>(
          `SELECT input_set_json,finalized_at FROM outcome_hpn_pav_input_set WHERE input_set_id=$1`,
          [inputSet.inputSetId]
        );
        if (replay.rows[0]) {
          if (
            replay.rows[0].finalized_at === null ||
            canonicalizeAflTradeJson(replay.rows[0].input_set_json) !==
              canonicalizeAflTradeJson(inputSet)
          ) {
            throw new AflTradeHpnPavInputError(
              'REPLAY_CONFLICT',
              'Input-set ID has conflicting or unfinished content.'
            );
          }
          return {
            inputSet: aflTradeHpnPavSeasonInputSetSchema.parse(replay.rows[0].input_set_json),
            idempotentReplay: true,
          };
        }
        await persistInputSet(transaction, inputSet, contexts);
        return { inputSet, idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof AflTradeHpnPavInputError) throw error;
      throw new AflTradeHpnPavInputError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the PAV input set.'
      );
    }
  }

  async loadFinalizedSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavSeasonInputSet> {
    let request: AflTradeFinalizedHpnPavInputSetRequest;
    try {
      request = aflTradeFinalizedHpnPavInputSetRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradeHpnPavInputError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid finalized PAV input request.'
      );
    }
    if (execution.environment !== request.environment) {
      throw new AflTradeHpnPavInputError(
        'ENVIRONMENT_MISMATCH',
        'PAV execution environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-hpn-pav-input:${request.inputSetId}`,
        ]);
        const result = await transaction.query<FinalizedInputSetRow>(
          `SELECT input_set.input_set_json,input_set.input_set_canonical_json,
                  input_set.input_set_sha256,input_set.status,input_set.finalized_at,
                  input_set.environment::text AS environment,input_set.competition,
                  input_set.season_year,input_set.method_id,input_set.source_run_count,
                  input_set.source_row_count,input_set.completed_match_count,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_input_run member
                    WHERE member.input_set_id=input_set.input_set_id) AS actual_source_run_count,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_input_row member
                    WHERE member.input_set_id=input_set.input_set_id) AS actual_source_row_count,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_input_match member
                    WHERE member.input_set_id=input_set.input_set_id)
                    AS actual_completed_match_count,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_input_factual_match_member member
                    WHERE member.input_set_id=input_set.input_set_id) AS factual_match_count,
                  (SELECT count(*)::integer
                     FROM outcome_hpn_pav_input_factual_appearance_member member
                    WHERE member.input_set_id=input_set.input_set_id) AS factual_appearance_count
             FROM outcome_hpn_pav_input_set input_set
            WHERE input_set.input_set_id=$1
            FOR SHARE`,
          [request.inputSetId]
        );
        const row = result.rows[0];
        if (
          !row ||
          row.status !== 'finalized' ||
          row.finalized_at === null ||
          row.environment !== request.environment ||
          row.competition !== request.competition ||
          row.season_year !== request.seasonYear ||
          row.method_id !== request.methodId
        ) {
          throw new AflTradeHpnPavInputError(
            'INPUT_SET_NOT_FINALIZED',
            'The exact scoped HPN PAV input set is not finalized.'
          );
        }
        const inputSet = aflTradeHpnPavSeasonInputSetSchema.parse(row.input_set_json);
        const factualMatchCount = inputSet.content.factualUniverse.completedMatchFacts.reduce(
          (count, member) => count + member.factIds.length,
          0
        );
        const factualAppearanceCount =
          inputSet.content.factualUniverse.playerAppearanceFacts.reduce(
            (count, member) => count + member.factIds.length,
            0
          );
        if (
          canonicalizeAflTradeJson(inputSet.content) !== row.input_set_canonical_json ||
          sha256AflTradeCanonicalJson(inputSet.content) !== row.input_set_sha256 ||
          inputSet.inputSetId !== request.inputSetId ||
          inputSet.content.sourceRuns.length !== row.source_run_count ||
          inputSet.content.rows.length !== row.source_row_count ||
          inputSet.content.completedMatches.length !== row.completed_match_count ||
          inputSet.content.sourceRuns.length !== row.actual_source_run_count ||
          inputSet.content.rows.length !== row.actual_source_row_count ||
          inputSet.content.completedMatches.length !== row.actual_completed_match_count ||
          factualMatchCount !== row.factual_match_count ||
          factualAppearanceCount !== row.factual_appearance_count
        ) {
          throw new AflTradeHpnPavInputError(
            'REPLAY_CONFLICT',
            'The finalized HPN PAV input envelope differs from durable membership.'
          );
        }
        return inputSet;
      });
    } catch (error) {
      if (error instanceof AflTradeHpnPavInputError) throw error;
      throw new AflTradeHpnPavInputError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the PAV input read.'
      );
    }
  }
}
