import { resolutionSql, clubResolutionSql } from './hpnCurrentResolutionSql';
import {
  digestFromId,
  currentPlayerResolution,
  currentResolution,
  exactOneResolution,
  choosePlayerClub,
} from './hpnCurrentResolution';
import { asObject, decodedScalar, nonnegativeInteger } from './hpnDecodedScalar';
import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnPavFieldMapSchema,
  aflTradeHpnPavExcludedSourceRowSchema,
  aflTradeHpnPavReviewedFields,
  aflTradeHpnPavSeasonInputSetSchema,
  createAflTradeHpnPavSeasonInputSet,
  type AflTradeHpnPavFieldMap,
  type AflTradeHpnPavInputFieldMap,
  type AflTradeHpnPavSeasonInputSet,
} from './hpnPavInputContracts';
import { loadAflTradeHpnStatisticalSelectionSet } from './postgresHpnStatisticalSelectionConsumption';
import {
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnSemanticBindingCandidate,
} from './hpnFieldMapCandidate';
import { type AflTradeHpnProjectedFieldMap } from './hpnProjectedFieldMap';
import {
  loadAflTradeHpnSourceRuns,
  requireAflTradeHpnSourceRunAuthority,
  type AflTradeHpnSourceSelection as SourceSelection,
  type AflTradeHpnSourceRunRow as RunRow,
} from './postgresHpnSourceAuthority';
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
  start_event_version_id: string | null;
  start_asset_version_id: string | null;
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
  actual_excluded_source_row_count?: number;
  actual_statistical_selection_count?: number;
  actual_completed_match_count: number;
  factual_match_count: number;
  factual_appearance_count: number;
}

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
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/u.exec(value);
    if (match?.[1]) return match[1];
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }
  throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is invalid.`);
}

function reviewedFields(fieldMap: AflTradeHpnPavInputFieldMap): string[] {
  if (isProjectedFieldMap(fieldMap)) {
    return [
      ...new Set(fieldMap.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)),
    ].sort();
  }
  return aflTradeHpnPavReviewedFields(fieldMap.content);
}

function isProjectedFieldMap(
  fieldMap: AflTradeHpnPavInputFieldMap
): fieldMap is AflTradeHpnProjectedFieldMap {
  return fieldMap.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1';
}

function sourceValues(row: DecodedRow, fieldMap: AflTradeHpnPavInputFieldMap) {
  const fields = reviewedFields(fieldMap);
  return Object.fromEntries(
    fields.map((field) => [field, decodedScalar(row.typed_payload, field)])
  );
}

function rowSource(decoded: DecodedRow, map: AflTradeHpnPavInputFieldMap) {
  const values = sourceValues(decoded, map);
  return {
    normalizationRunId: decoded.normalization_run_id,
    providerDecodedRowId: decoded.provider_decoded_row_id,
    sourceRowSha256: decoded.source_row_sha256,
    typedPayloadSha256: sha256AflTradeCanonicalJson(decoded.typed_payload),
    sourceFields: Object.keys(values).sort(),
    sourceValues: values,
  };
}

async function loadExcludedSourceRows(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeHpnPavSeasonInputRequest,
  decodedRows: readonly DecodedRow[],
  contexts: ReadonlyMap<string, { map: AflTradeHpnPavInputFieldMap }>,
  cutoff: string
) {
  const ids = request.reviewedNonparticipantDecisions ?? [];
  if (ids.length === 0) return [];
  await transaction.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:hpn_source_nonparticipant:' || subject_id,0))
    FROM outcome_review_decision WHERE decision_id=ANY($1::text[]) ORDER BY subject_id`,
    [ids]
  );
  const result = await transaction.query<{
    decision_id: string;
    decided_at: Date | string;
    evidence_json: { disposition: unknown };
  }>(
    `SELECT decision_id,decided_at,evidence_json FROM outcome_review_decision
    WHERE decision_id=ANY($1::text[]) AND subject_type='hpn_source_nonparticipant'
      AND outcome_hpn_pav_nonparticipant_review_current(decision_id,$2,$3,$4,$5,$6::timestamptz)
    ORDER BY decision_id FOR SHARE`,
    [
      ids,
      request.environment,
      request.competition,
      request.seasonYear,
      request.factualRunId,
      cutoff,
    ]
  );
  if (result.rows.length !== ids.length)
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      'A reviewed nonparticipant decision is missing, superseded, or not exact current source authority.'
    );
  return result.rows
    .map((decision) => {
      const disposition = asObject(
        decision.evidence_json.disposition,
        'nonparticipant disposition'
      );
      const row = aflTradeHpnPavExcludedSourceRowSchema.parse({
        reason: disposition.reason,
        source: disposition.source,
        player: disposition.player,
        match: disposition.match,
        club: disposition.club,
        review: {
          decision: {
            id: decision.decision_id,
            sha256: digestFromId(decision.decision_id, 'review-decision'),
          },
          decidedAt: iso(decision.decided_at, 'nonparticipant decision time'),
          evidenceArtifact: disposition.evidenceArtifact,
        },
      });
      const decoded = decodedRows.find(
        (value) => value.provider_decoded_row_id === row.source.providerDecodedRowId
      );
      const context = decoded ? contexts.get(decoded.normalization_run_id) : undefined;
      if (
        !decoded ||
        decoded.row_status !== 'staged' ||
        !context ||
        context.map.content.inputKind !== 'player_match_stats'
      ) {
        throw new AflTradeHpnPavInputError(
          'INCOMPLETE_SOURCE_ROWS',
          'Reviewed nonparticipant does not belong to the exact staged player source.'
        );
      }
      const source = rowSource(decoded, context.map);
      const clubField = isProjectedFieldMap(context.map)
        ? projectedDirectField(context.map, 'club')
        : context.map.content.bindings.club;
      const actual = {
        source,
        player: currentPlayerResolution(decoded.player_resolution),
        match: currentResolution('match', decoded.match_resolution),
        club: choosePlayerClub(decoded, source.sourceValues[clubField]),
      };
      const expected = { source: row.source, player: row.player, match: row.match, club: row.club };
      if (canonicalizeAflTradeJson(actual) !== canonicalizeAflTradeJson(expected)) {
        throw new AflTradeHpnPavInputError(
          'RESOLUTION_NOT_CURRENT',
          'Reviewed nonparticipant source or resolved context has changed.'
        );
      }
      return row;
    })
    .sort((left, right) =>
      left.source.providerDecodedRowId.localeCompare(right.source.providerDecodedRowId)
    );
}

function projectedBinding(
  fieldMap: AflTradeHpnProjectedFieldMap,
  semanticField: AflTradeHpnSemanticBindingCandidate['semanticField']
): AflTradeHpnSemanticBindingCandidate['mapping'] {
  const binding = fieldMap.content.semanticBindings.find(
    (candidate) => candidate.semanticField === semanticField
  );
  if (!binding) {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      `Projected field map is missing ${semanticField}.`
    );
  }
  return binding.mapping;
}

function projectedDirectField(
  fieldMap: AflTradeHpnProjectedFieldMap,
  semanticField: AflTradeHpnSemanticBindingCandidate['semanticField']
): string {
  const mapping = projectedBinding(fieldMap, semanticField);
  if (mapping.kind !== 'direct') {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      `Projected ${semanticField} must use one direct source field.`
    );
  }
  return mapping.sourceField;
}

function projectedNonnegativeInteger(
  values: Readonly<Record<string, unknown>>,
  fieldMap: AflTradeHpnProjectedFieldMap,
  semanticField: AflTradeHpnSemanticBindingCandidate['semanticField']
): number {
  const mapping = projectedBinding(fieldMap, semanticField);
  if (mapping.kind === 'direct') {
    return nonnegativeInteger(values[mapping.sourceField], mapping.sourceField);
  }
  if (semanticField === 'totalPoints' && mapping.kind === 'goals_plus_behinds') {
    return (
      nonnegativeInteger(values[mapping.goals], mapping.goals) * 6 +
      nonnegativeInteger(values[mapping.behinds], mapping.behinds)
    );
  }
  throw new AflTradeHpnPavInputError(
    'SOURCE_AUTHORITY_MISMATCH',
    `Projected ${semanticField} has an unsupported numeric mapping.`
  );
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
              fact.match_id,fact.effective_at,fact_json->'match'->'homeClub'->>'clubId' AS home_club_id,
              fact_json->'match'->'awayClub'->>'clubId' AS away_club_id
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

function buildRows(
  decodedRows: readonly DecodedRow[],
  contexts: ReadonlyMap<
    string,
    { row: RunRow; map: AflTradeHpnPavInputFieldMap; selection: SourceSelection }
  >
): UnboundInputRow[] {
  return decodedRows.map((decoded) => {
    const context = contexts.get(decoded.normalization_run_id);
    if (!context || decoded.row_status !== 'staged') {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'A decoded row is not clean.');
    }
    const values = sourceValues(decoded, context.map);
    const source = rowSource(decoded, context.map);
    if (context.map.content.inputKind === 'completed_match_result') {
      if (isProjectedFieldMap(context.map)) {
        const homePointsField = projectedDirectField(context.map, 'homePoints');
        const awayPointsField = projectedDirectField(context.map, 'awayPoints');
        const completion = projectedBinding(context.map, 'completionStatus');
        const completionRule = context.map.content.completionRule;
        const isCompleted =
          completionRule?.kind === 'source_status'
            ? completion.kind === 'direct' &&
              typeof values[completion.sourceField] === 'string' &&
              completionRule.completedValues.includes(values[completion.sourceField] as string)
            : completionRule?.kind === 'reviewed_final_score_presence' &&
              completion.kind === 'reviewed_final_scores' &&
              values[completion.homePointsField] !== null &&
              values[completion.awayPointsField] !== null;
        if (!isCompleted) {
          throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'Match is not completed.');
        }
        return {
          kind: 'completed_match_result' as const,
          source,
          match: currentResolution('match', decoded.match_resolution),
          effectiveAt: iso(decoded.canonical_match_date, 'canonical match date'),
          homeClub: exactOneResolution('club', decoded.home_club_resolutions, 'home'),
          awayClub: exactOneResolution('club', decoded.away_club_resolutions, 'away'),
          homePoints: nonnegativeInteger(values[homePointsField], homePointsField),
          awayPoints: nonnegativeInteger(values[awayPointsField], awayPointsField),
          completionStatus: 'completed' as const,
        };
      }
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
    if (isProjectedFieldMap(context.map)) {
      return {
        kind: 'player_match_stats' as const,
        role: context.selection.role as 'primary' | 'corroborating',
        source,
        match: currentResolution('match', decoded.match_resolution),
        player: currentPlayerResolution(decoded.player_resolution),
        club: choosePlayerClub(decoded, values[projectedDirectField(context.map, 'club')]),
        stats: {
          totalPoints: projectedNonnegativeInteger(values, context.map, 'totalPoints'),
          hitOuts: projectedNonnegativeInteger(values, context.map, 'hitOuts'),
          goalAssists: projectedNonnegativeInteger(values, context.map, 'goalAssists'),
          inside50s: projectedNonnegativeInteger(values, context.map, 'inside50s'),
          marks: projectedNonnegativeInteger(values, context.map, 'marks'),
          marksInside50: projectedNonnegativeInteger(values, context.map, 'marksInside50'),
          freeKicksFor: projectedNonnegativeInteger(values, context.map, 'freeKicksFor'),
          freeKicksAgainst: projectedNonnegativeInteger(values, context.map, 'freeKicksAgainst'),
          rebound50s: projectedNonnegativeInteger(values, context.map, 'rebound50s'),
          onePercenters: projectedNonnegativeInteger(values, context.map, 'onePercenters'),
          clearances: projectedNonnegativeInteger(values, context.map, 'clearances'),
          tackles: projectedNonnegativeInteger(values, context.map, 'tackles'),
        },
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
      player: currentPlayerResolution(decoded.player_resolution),
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
  createdAt: string,
  contexts: ReadonlyMap<string, { map: AflTradeHpnPavInputFieldMap }>
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
        normalizationRunId: row.source.normalizationRunId,
        fieldMapId: contexts.get(row.source.normalizationRunId)?.map.fieldMapId ?? null,
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
         "providerDecodedRowId" text,"normalizationRunId" text,"fieldMapId" text,
         "playerId" text,"clubId" text,"effectiveDate" date)
       JOIN outcome_acquisition_spell_version spell
         ON spell.player_id=requested."playerId" AND spell.club_id=requested."clubId"
        AND spell.start_date<=requested."effectiveDate"
        AND (spell.end_date IS NULL OR spell.end_date>=requested."effectiveDate")
      WHERE spell.status='approved' AND spell.recorded_at<=$2::timestamptz
        AND outcome_hpn_acquisition_spell_is_current(spell.spell_version_id,
          requested."providerDecodedRowId",requested."normalizationRunId",requested."fieldMapId",
          requested."effectiveDate",clock_timestamp())
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
  contexts: ReadonlyMap<string, { map: AflTradeHpnPavInputFieldMap }>
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
  contexts: ReadonlyMap<string, { selection: SourceSelection; map: AflTradeHpnPavInputFieldMap }>
): Promise<void> {
  const content = inputSet.content;
  const excluded = 'excludedSourceRows' in content ? content.excludedSourceRows : [];
  const inputSetSha256 = digestFromId(inputSet.inputSetId, 'hpn-pav-input-set');
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_set
      (input_set_id,factual_run_id,factual_input_set_sha256,factual_finalized_at,
       environment,competition,season_year,method_id,effective_through,created_at,
       input_set_sha256,status,source_run_count,source_row_count,completed_match_count,
       result_row_count,primary_player_row_count,corroborating_player_row_count,
       input_set_canonical_json,input_set_json,excluded_source_row_count)
     VALUES ($1,$2,$3,$4,$5::"OutcomeEnvironment",$6,$7,$8,$9,$10,$11,'building',
             $12,$13,$14,$15,$16,$17,$18,$19::jsonb,
             COALESCE(jsonb_array_length($19::jsonb#>'{content,excludedSourceRows}'),0))`,
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
      content.rows.length + excluded.length,
      content.counts.completedMatches,
      content.counts.resultRows,
      content.counts.primaryPlayerRows,
      content.counts.corroboratingPlayerRows,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(inputSet),
    ]
  );
  const runRows = content.sourceRuns.map((run, ordinal) => {
    const context = contexts.get(run.normalizationRunId);
    if (!context)
      throw new AflTradeHpnPavInputError('PERSISTENCE_REJECTED', 'Run selection vanished.');
    const { selection, map } = context;
    const projected = isProjectedFieldMap(map);
    return {
      inputSetId: inputSet.inputSetId,
      ordinal,
      normalizationRunId: run.normalizationRunId,
      legacyFieldMapId: projected ? null : run.fieldMapId,
      projectedFieldMapId: projected ? run.fieldMapId : null,
      inputKind: selection.inputKind,
      role: selection.role,
    };
  });
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_input_run
      (input_set_id,ordinal,normalization_run_id,field_map_id,projected_field_map_id,input_kind,role)
     SELECT "inputSetId",ordinal,"normalizationRunId","legacyFieldMapId","projectedFieldMapId","inputKind",role
       FROM jsonb_to_recordset($1::jsonb) AS value(
         "inputSetId" text, ordinal integer, "normalizationRunId" text,
         "legacyFieldMapId" text, "projectedFieldMapId" text, "inputKind" text, role text)`,
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
  if (excluded.length > 0)
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_input_excluded_source_row
      (input_set_id,ordinal,normalization_run_id,provider_decoded_row_id,review_decision_id,row_sha256,row_canonical_json,row_json)
     SELECT "inputSetId",ordinal,"normalizationRunId","providerDecodedRowId","reviewDecisionId","rowSha256","rowCanonicalJson",row
       FROM jsonb_to_recordset($1::jsonb) AS value("inputSetId" text,ordinal integer,"normalizationRunId" text,
         "providerDecodedRowId" text,"reviewDecisionId" text,"rowSha256" text,"rowCanonicalJson" text,row jsonb)`,
      [
        canonicalizeAflTradeJson(
          excluded.map((row, ordinal) => ({
            inputSetId: inputSet.inputSetId,
            ordinal,
            normalizationRunId: row.source.normalizationRunId,
            providerDecodedRowId: row.source.providerDecodedRowId,
            reviewDecisionId: row.review.decision.id,
            rowSha256: sha256AflTradeCanonicalJson(row),
            rowCanonicalJson: canonicalizeAflTradeJson(row),
            row,
          }))
        ),
      ]
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
  if (content.schemaVersion === 'afl-trade-hpn-pav-input-set/v5') {
    const statisticalMembers = content.statisticalSelections.membership.map(
      (member, ordinal) => ({
        inputSetId: inputSet.inputSetId,
        ordinal,
        ...member,
        selectionSha256: sha256AflTradeCanonicalJson(member),
        selectionCanonicalJson: canonicalizeAflTradeJson(member),
      })
    );
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_input_statistical_selection
        (input_set_id,ordinal,scope_key,candidate_id,decision_id,support_review_id,revision,
         applied_at,identity_json,identity_sha256,selection_sha256,selection_canonical_json,selection_json)
       SELECT value."inputSetId",value.ordinal,value."scopeKey",value."candidateId",value."decisionId",
              value."supportReviewId",value.revision,head.applied_at,head.identity_json,
              value."identitySha256",value."selectionSha256",value."selectionCanonicalJson",
              value."selectionCanonicalJson"::jsonb
         FROM jsonb_to_recordset($1::jsonb) AS value(
           "inputSetId" text,ordinal integer,"scopeKey" text,"candidateId" text,"decisionId" text,
           "supportReviewId" text,revision integer,"appliedAt" text,"identitySha256" text,
           "selectionSha256" text,"selectionCanonicalJson" text)
         JOIN outcome_hpn_statistical_current_selection head
           ON head.scope_key=value."scopeKey" AND head.decision_id=value."decisionId"
          AND head.support_review_id=value."supportReviewId" AND head.revision=value.revision
          AND head.applied_at=value."appliedAt"::timestamptz
          AND encode(sha256(convert_to(outcome_afl_trade_canonical_json(head.identity_json),'UTF8')),'hex')=value."identitySha256"`,
      [canonicalizeAflTradeJson(statisticalMembers)]
    );
  }
  await transaction.query(
    `UPDATE outcome_hpn_pav_input_set SET status='finalized', finalized_at=created_at
      WHERE input_set_id=$1 AND status='building'`,
    [inputSet.inputSetId]
  );
}

async function loadFinalizedInputSetInTransaction(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeFinalizedHpnPavInputSetRequest,
  requireCurrent: boolean
): Promise<AflTradeHpnPavSeasonInputSet> {
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
            (SELECT count(*)::integer FROM outcome_hpn_pav_input_excluded_source_row member
              WHERE member.input_set_id=input_set.input_set_id) AS actual_excluded_source_row_count,
            (SELECT count(*)::integer FROM outcome_hpn_pav_input_match member
              WHERE member.input_set_id=input_set.input_set_id)
              AS actual_completed_match_count,
            (SELECT count(*)::integer FROM outcome_hpn_pav_input_factual_match_member member
              WHERE member.input_set_id=input_set.input_set_id) AS factual_match_count,
            (SELECT count(*)::integer
               FROM outcome_hpn_pav_input_factual_appearance_member member
              WHERE member.input_set_id=input_set.input_set_id) AS factual_appearance_count,
            (SELECT count(*)::integer
               FROM outcome_hpn_pav_input_statistical_selection member
              WHERE member.input_set_id=input_set.input_set_id) AS actual_statistical_selection_count
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
  const excluded =
    'excludedSourceRows' in inputSet.content ? inputSet.content.excludedSourceRows : [];
  const factualMatchCount = inputSet.content.factualUniverse.completedMatchFacts.reduce(
    (count, member) => count + member.factIds.length,
    0
  );
  const factualAppearanceCount = inputSet.content.factualUniverse.playerAppearanceFacts.reduce(
    (count, member) => count + member.factIds.length,
    0
  );
  const statisticalSelectionCount =
    inputSet.content.schemaVersion === 'afl-trade-hpn-pav-input-set/v5'
      ? inputSet.content.statisticalSelections.membership.length
      : 0;
  if (
    canonicalizeAflTradeJson(inputSet.content) !== row.input_set_canonical_json ||
    sha256AflTradeCanonicalJson(inputSet.content) !== row.input_set_sha256 ||
    inputSet.inputSetId !== request.inputSetId ||
    inputSet.content.sourceRuns.length !== row.source_run_count ||
    inputSet.content.rows.length + excluded.length !== row.source_row_count ||
    excluded.length !== (row.actual_excluded_source_row_count ?? 0) ||
    inputSet.content.completedMatches.length !== row.completed_match_count ||
    inputSet.content.sourceRuns.length !== row.actual_source_run_count ||
    inputSet.content.rows.length !== row.actual_source_row_count ||
    inputSet.content.completedMatches.length !== row.actual_completed_match_count ||
    factualMatchCount !== row.factual_match_count ||
    factualAppearanceCount !== row.factual_appearance_count ||
    statisticalSelectionCount !== (row.actual_statistical_selection_count ?? 0)
  ) {
    throw new AflTradeHpnPavInputError(
      'REPLAY_CONFLICT',
      'The finalized HPN PAV input envelope differs from durable membership.'
    );
  }
  if (requireCurrent) {
    const content = inputSet.content;
    const maps = new Map(content.fieldMaps.map((map) => [map.fieldMapId, map]));
    const currentRequest = aflTradeHpnPavSeasonInputRequestSchema.parse({
      environment: content.environment,
      competition: content.competition,
      seasonYear: content.seasonYear,
      methodId: content.methodId,
      factualRunId: content.factualUniverse.factualRunId,
      effectiveThrough: content.effectiveThrough,
      ...(excluded.length === 0
        ? {}
        : { reviewedNonparticipantDecisions: excluded.map((row) => row.review.decision.id) }),
      ...(content.schemaVersion === 'afl-trade-hpn-pav-input-set/v5'
        ? {
            reviewedStatisticalDecisions: content.statisticalSelections.decisions.map(
              ({ decisionId }) => decisionId
            ),
          }
        : {}),
      ...('knowledgePolicy' in content
        ? {
            knowledgePolicy: content.knowledgePolicy,
            knowledgeCutoffAt: content.knowledgeCutoffAt,
          }
        : {}),
      sources: content.sourceRuns.map((run) => ({
        normalizationRunId: run.normalizationRunId,
        fieldMapId: run.fieldMapId,
        inputKind: maps.get(run.fieldMapId)?.content.inputKind,
        role:
          maps.get(run.fieldMapId)?.content.inputKind === 'completed_match_result'
            ? null
            : content.rows.flatMap((row) =>
                row.kind === 'player_match_stats' &&
                row.source.normalizationRunId === run.normalizationRunId
                  ? [row.role]
                  : []
              )[0],
      })),
    });
    const cutoff = 'knowledgeCutoffAt' in content ? content.knowledgeCutoffAt : content.createdAt;
    const universe = await loadFactualUniverse(transaction, currentRequest, cutoff);
    const contexts = await loadAflTradeHpnSourceRuns(transaction, currentRequest.sources);
    for (const run of content.sourceRuns) {
      const context = contexts.get(run.normalizationRunId);
      if (!context)
        throw new AflTradeHpnPavInputError(
          'SOURCE_AUTHORITY_MISMATCH',
          'Retained source authority is missing.'
        );
      await requireAflTradeHpnSourceRunAuthority(transaction, currentRequest, cutoff, context);
      const actual = context.row;
      if (
        canonicalizeAflTradeJson(context.map) !==
          canonicalizeAflTradeJson(maps.get(run.fieldMapId)) ||
        actual.capture_id !== run.captureId ||
        actual.source_snapshot_id !== run.sourceSnapshotId ||
        actual.source_artifact_id !== run.sourceArtifactId ||
        actual.staging_sha256 !== run.stagingSha256 ||
        actual.source_row_count !== run.sourceRowCount ||
        actual.accepted_row_count !== run.acceptedRowCount ||
        iso(actual.captured_at, 'capture time') !== run.capturedAt ||
        iso(actual.finalized_at, 'run finalization') !== run.finalizedAt
      ) {
        throw new AflTradeHpnPavInputError(
          'SOURCE_AUTHORITY_MISMATCH',
          'Retained source custody differs from current authority.'
        );
      }
    }
    const decoded = await loadDecodedRows(transaction, [...contexts.keys()]);
    const currentExcluded = await loadExcludedSourceRows(
      transaction,
      currentRequest,
      decoded,
      contexts,
      cutoff
    );
    const excludedIds = new Set(currentExcluded.map((row) => row.source.providerDecodedRowId));
    const currentRows = await bindAcquisitionSpells(
      transaction,
      buildRows(
        decoded.filter((row) => !excludedIds.has(row.provider_decoded_row_id)),
        contexts
      ),
      content.completedMatches,
      cutoff,
      contexts
    );
    requireFactualUniverseCoverage(currentRows, universe, contexts);
    if (content.schemaVersion === 'afl-trade-hpn-pav-input-set/v5') {
      const currentSelections = await loadAflTradeHpnStatisticalSelectionSet(
        transaction,
        currentRequest,
        inputSet,
        cutoff
      );
      if (
        canonicalizeAflTradeJson(currentSelections) !==
        canonicalizeAflTradeJson(content.statisticalSelections)
      ) {
        throw new AflTradeHpnPavInputError(
          'RESOLUTION_NOT_CURRENT',
          'Retained statistical selection membership is no longer current.'
        );
      }
    }
    const reconstructed = createAflTradeHpnPavSeasonInputSet({
      ...content,
      ...(excluded.length === 0 ? {} : { excludedSourceRows: currentExcluded }),
      factualUniverse: universe,
      rows: currentRows,
    });
    if (reconstructed.inputSetId !== inputSet.inputSetId) {
      throw new AflTradeHpnPavInputError(
        'FACTUAL_UNIVERSE_MISMATCH',
        'Retained input differs from current factual or resolution authority.'
      );
    }
  }
  return inputSet;
}

function persistedSourceKeys(existing: AflTradeHpnPavSeasonInputSet) {
  const persistedMaps = new Map(
    existing.content.fieldMaps.map((fieldMap) => [fieldMap.fieldMapId, fieldMap])
  );
  return existing.content.sourceRuns
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
}

function requireExactScopeReplay(
  request: AflTradeHpnPavSeasonInputRequest,
  record: { input_set_json: unknown; finalized_at: Date | string | null }
): AflTradeHpnPavSeasonInputSet {
  let existing: AflTradeHpnPavSeasonInputSet;
  try {
    existing = aflTradeHpnPavSeasonInputSetSchema.parse(record.input_set_json);
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
  const persistedSources = persistedSourceKeys(existing);

  if (
    record.finalized_at === null ||
    ('knowledgePolicy' in existing.content ? existing.content.knowledgePolicy : undefined) !==
      request.knowledgePolicy ||
    ('knowledgeCutoffAt' in existing.content ? existing.content.knowledgeCutoffAt : undefined) !==
      request.knowledgeCutoffAt ||
    existing.content.factualUniverse.factualRunId !== request.factualRunId ||
    canonicalizeAflTradeJson(
      ('excludedSourceRows' in existing.content
        ? existing.content.excludedSourceRows.map((row) => row.review.decision.id)
        : []
      ).sort()
    ) !== canonicalizeAflTradeJson([...(request.reviewedNonparticipantDecisions ?? [])].sort()) ||
    canonicalizeAflTradeJson(
      (existing.content.schemaVersion === 'afl-trade-hpn-pav-input-set/v5'
        ? existing.content.statisticalSelections.decisions.map(({ decisionId }) => decisionId)
        : []
      ).sort()
    ) !== canonicalizeAflTradeJson([...(request.reviewedStatisticalDecisions ?? [])].sort()) ||
    requestedSources.length !== persistedSources.length ||
    requestedSources.some((source, index) => source !== persistedSources[index])
  ) {
    throw new AflTradeHpnPavInputError(
      'REPLAY_CONFLICT',
      'The logical PAV input scope already has different or unfinished immutable content.'
    );
  }

  return existing;
}

async function applyReviewedStatisticalSelections(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeHpnPavSeasonInputRequest,
  inputSet: AflTradeHpnPavSeasonInputSet,
  custodyCutoff: string,
  buildInputSet: (
    selections: Awaited<ReturnType<typeof loadAflTradeHpnStatisticalSelectionSet>>
  ) => AflTradeHpnPavSeasonInputSet
): Promise<AflTradeHpnPavSeasonInputSet> {
  if (request.reviewedStatisticalDecisions === undefined) return inputSet;
  if (
    inputSet.content.schemaVersion !== 'afl-trade-hpn-pav-input-set/v3' &&
    inputSet.content.schemaVersion !== 'afl-trade-hpn-pav-input-set/v4'
  ) {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      'Statistical selection consumption requires private projected retrospective inputs.'
    );
  }
  const selections = await loadAflTradeHpnStatisticalSelectionSet(
    transaction,
    request,
    inputSet,
    custodyCutoff
  );
  try {
    return buildInputSet(selections);
  } catch (error) {
    throw new AflTradeHpnPavInputError(
      'STATISTICAL_COVERAGE_INCOMPLETE',
      error instanceof Error
        ? error.message
        : 'Statistical decisions do not exactly cover the source discrepancies.'
    );
  }
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
          const existing = requireExactScopeReplay(request, scopeReplay.rows[0]);
          const current = await loadFinalizedInputSetInTransaction(
            transaction,
            {
              environment: request.environment,
              competition: request.competition,
              seasonYear: request.seasonYear,
              methodId: request.methodId,
              inputSetId: existing.inputSetId,
            },
            true
          );
          return { inputSet: current, idempotentReplay: true };
        }
        const clock = await transaction.query<{ created_at: Date | string }>(
          `SELECT transaction_timestamp() AS created_at`
        );
        const createdAt = iso(clock.rows[0]?.created_at, 'transaction time');
        if (
          Date.parse(request.knowledgeCutoffAt ?? request.effectiveThrough) > Date.parse(createdAt)
        ) {
          throw new AflTradeHpnPavInputError(
            'INVALID_REQUEST',
            'PAV input creation precedes its evidence cutoff.'
          );
        }
        const custodyCutoff = request.knowledgeCutoffAt ?? createdAt;
        const factualUniverse = await loadFactualUniverse(transaction, request, custodyCutoff);
        const contexts = await loadAflTradeHpnSourceRuns(transaction, request.sources);
        for (const context of contexts.values())
          await requireAflTradeHpnSourceRunAuthority(transaction, request, custodyCutoff, context);
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
        const excludedSourceRows = await loadExcludedSourceRows(
          transaction,
          request,
          decodedRows,
          contexts,
          custodyCutoff
        );
        const excludedIds = new Set(
          excludedSourceRows.map((row) => row.source.providerDecodedRowId)
        );
        const unboundRows = buildRows(
          decodedRows.filter((row) => !excludedIds.has(row.provider_decoded_row_id)),
          contexts
        );
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
          custodyCutoff,
          contexts
        );
        requireFactualUniverseCoverage(rows, factualUniverse, contexts);
        const fieldMaps = [...contexts.values()].map(({ map }) => map);
        const inputSetBase = {
          ...(excludedSourceRows.length === 0 ? {} : { excludedSourceRows }),
          ...(request.knowledgePolicy === undefined
            ? {}
            : {
                knowledgePolicy: request.knowledgePolicy,
                knowledgeCutoffAt: request.knowledgeCutoffAt!,
              }),
          competition: request.competition,
          seasonYear: request.seasonYear,
          effectiveThrough: request.effectiveThrough,
          createdAt,
          methodId: request.methodId,
          factualUniverse,
          sourceRuns,
          completedMatches,
          rows,
        };
        let inputSet = fieldMaps.every(isProjectedFieldMap)
          ? createAflTradeHpnPavSeasonInputSet({
              ...inputSetBase,
              environment: 'non_production',
              fieldMaps,
            })
          : fieldMaps.every((fieldMap) => !isProjectedFieldMap(fieldMap))
            ? createAflTradeHpnPavSeasonInputSet({
                ...inputSetBase,
                environment: request.environment,
                fieldMaps: fieldMaps as AflTradeHpnPavFieldMap[],
              })
            : (() => {
                throw new AflTradeHpnPavInputError(
                  'SOURCE_AUTHORITY_MISMATCH',
                  'One HPN input set cannot mix legacy and projected field-map authority.'
                );
              })();
        inputSet = await applyReviewedStatisticalSelections(
          transaction,
          request,
          inputSet,
          custodyCutoff,
          (statisticalSelections) =>
            createAflTradeHpnPavSeasonInputSet({
              ...inputSetBase,
              environment: 'non_production',
              fieldMaps: fieldMaps.filter(isProjectedFieldMap),
              excludedSourceRows,
              statisticalSelections,
            })
        );
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
            inputSet: await loadFinalizedInputSetInTransaction(
              transaction,
              {
                environment: request.environment,
                competition: request.competition,
                seasonYear: request.seasonYear,
                methodId: request.methodId,
                inputSetId: inputSet.inputSetId,
              },
              true
            ),
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
    return this.loadSeasonInputSet(input, execution, false);
  }

  async loadCurrentFinalizedSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavSeasonInputSet> {
    return this.loadSeasonInputSet(input, execution, true);
  }

  private async loadSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext,
    requireCurrent: boolean
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
      return await this.client.transaction((transaction) =>
        loadFinalizedInputSetInTransaction(transaction, request, requireCurrent)
      );
    } catch (error) {
      if (error instanceof AflTradeHpnPavInputError) throw error;
      throw new AflTradeHpnPavInputError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the PAV input read.'
      );
    }
  }
}
