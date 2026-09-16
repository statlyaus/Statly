import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnPavFieldMapSchema,
  type AflTradeHpnPavInputFieldMap,
} from './hpnPavInputContracts';
import type { AflTradeHpnProjectedFieldMap } from './hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from './postgresHpnProjectedFieldMapAuthority';
import {
  AflTradeHpnPavInputError,
  type AflTradeHpnPavSeasonInputRequest,
} from './hpnPavInputRepository';

export type AflTradeHpnSourceSelection = AflTradeHpnPavSeasonInputRequest['sources'][number];

export interface AflTradeHpnSourceRunRow {
  normalization_run_id: string;
  capture_id: string;
  source_snapshot_id: string;
  source_artifact_id: string;
  capture_environment: string;
  capture_provider: string;
  capture_capability_id: string | null;
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
}

function iso(value: Date | string | null, label: string): string {
  if (value === null)
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is missing.`);
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is invalid.`);
  }
  return parsed.toISOString();
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

/**
 * Load retained source/map context using validated selections with unique run IDs.
 * Loading alone does not authorize use: verify every returned context below in this transaction.
 */
export async function loadAflTradeHpnSourceRuns(
  transaction: AflOutcomeSqlTransaction,
  selections: readonly AflTradeHpnSourceSelection[]
): Promise<
  Map<
    string,
    {
      row: AflTradeHpnSourceRunRow;
      map: AflTradeHpnPavInputFieldMap;
      selection: AflTradeHpnSourceSelection;
    }
  >
> {
  const requested = canonicalizeAflTradeJson(selections);
  const result = await transaction.query<AflTradeHpnSourceRunRow>(
    `SELECT run.normalization_run_id, run.capture_id, capture.source_snapshot_id,
            capture.source_artifact_id, capture.environment::text AS capture_environment,
            capture.provider AS capture_provider,
            capture.capability_id AS capture_capability_id,
            capture.status::text AS capture_status, capture.captured_at, run.finalized_at,
            run.staging_sha256, run.source_row_count, run.accepted_row_count,
            run.quarantined_row_count, run.issue_count, run.status::text AS run_status,
            decode_map.capability_id, decode_map.source_schema_sha256
       FROM jsonb_to_recordset($1::jsonb) AS requested(
         "normalizationRunId" text, "fieldMapId" text, "inputKind" text, role text)
       JOIN outcome_provider_normalization_run run
         ON run.normalization_run_id=requested."normalizationRunId"
       JOIN outcome_provider_field_map decode_map ON decode_map.field_map_id=run.field_map_id
       JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
      ORDER BY run.normalization_run_id
      FOR SHARE OF run, capture, decode_map`,
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
    {
      row: AflTradeHpnSourceRunRow;
      map: AflTradeHpnPavInputFieldMap;
      selection: AflTradeHpnSourceSelection;
    }
  >();
  for (const fieldMapId of [...new Set(selections.map(({ fieldMapId }) => fieldMapId))].sort()) {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `outcome-review-subject:provider_field_map:${fieldMapId}`,
    ]);
  }
  for (const row of result.rows) {
    const selection = selections.find(
      ({ normalizationRunId }) => normalizationRunId === row.normalization_run_id
    );
    if (!selection)
      throw new AflTradeHpnPavInputError('INVALID_REQUEST', 'Source selection drifted.');
    const storedMap = await transaction.query<{
      legacy_map_json: unknown;
      current_approval: boolean;
    }>(
      `SELECT legacy.map_json AS legacy_map_json,
              EXISTS (SELECT 1 FROM outcome_review_decision decision
                WHERE decision.decision_id=legacy.approval_decision_id
                  AND decision.subject_type='provider_field_map'
                  AND decision.subject_id=legacy.field_map_id
                  AND decision.decision='approved'
                  AND legacy.map_json#>>'{content,approvalDecision,id}'=decision.decision_id
                  AND legacy.map_json#>>'{content,approvalDecision,sha256}'=legacy.approval_decision_sha256
                  AND legacy.approval_decision_sha256=split_part(decision.decision_id,':',2)
                  AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                    WHERE successor.supersedes_decision_id=decision.decision_id)
              ) AS current_approval
         FROM outcome_hpn_pav_field_map legacy
        WHERE legacy.field_map_id=$1 FOR SHARE OF legacy`,
      [selection.fieldMapId]
    );
    const legacyMap = storedMap.rows[0]?.legacy_map_json
      ? aflTradeHpnPavFieldMapSchema.parse(storedMap.rows[0].legacy_map_json)
      : null;
    if (legacyMap && storedMap.rows[0]?.current_approval !== true) {
      throw new AflTradeHpnPavInputError(
        'SOURCE_AUTHORITY_MISMATCH',
        'The retained legacy HPN field-map approval is unavailable or superseded.'
      );
    }
    let projectedMap: AflTradeHpnProjectedFieldMap | null;
    try {
      projectedMap = await new PostgresAflTradeHpnProjectedFieldMapAuthority(
        transactionClient(transaction)
      ).loadCurrentExact(selection.fieldMapId);
    } catch (error) {
      throw new AflTradeHpnPavInputError(
        'SOURCE_AUTHORITY_MISMATCH',
        error instanceof Error
          ? error.message
          : 'The projected HPN field map failed exact authentication.'
      );
    }
    if ((legacyMap === null) === (projectedMap === null)) {
      throw new AflTradeHpnPavInputError(
        'SOURCE_AUTHORITY_MISMATCH',
        'Each selected HPN field map must resolve to exactly one current authority.'
      );
    }
    const map = legacyMap ?? projectedMap!;
    output.set(row.normalization_run_id, { row, map, selection });
  }
  return output;
}

/**
 * Requires validated scope/cutoff timestamps and context loaded above in this same transaction.
 * Never accept caller-supplied context as authority; this check relies on the loader's locks.
 */
export async function requireAflTradeHpnSourceRunAuthority(
  transaction: AflOutcomeSqlTransaction,
  request: Pick<
    AflTradeHpnPavSeasonInputRequest,
    'environment' | 'competition' | 'seasonYear' | 'effectiveThrough' | 'knowledgeCutoffAt'
  >,
  createdAt: string,
  context: {
    row: AflTradeHpnSourceRunRow;
    map: AflTradeHpnPavInputFieldMap;
    selection: AflTradeHpnSourceSelection;
  }
): Promise<void> {
  const { row, map, selection } = context;
  let captureAuthorized = row.capture_status === 'approved';
  if (
    row.capture_status === 'staged' &&
    request.environment === 'non_production' &&
    map.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1'
  ) {
    const authority = await transaction.query<{ staged_source_authority: boolean }>(
      `SELECT outcome_hpn_source_first_projected_map_is_exact($1)
        AND outcome_hpn_projected_field_map_authority_for_source_is_exact($1,$2,$3,$4::timestamptz)
        AS staged_source_authority`,
      [map.fieldMapId, row.capture_id, row.normalization_run_id, createdAt]
    );
    captureAuthorized = authority.rows[0]?.staged_source_authority === true;
  }
  if (
    row.capture_environment !== request.environment ||
    row.capture_provider !== map.content.provider ||
    row.capture_capability_id !== map.content.capabilityId ||
    !captureAuthorized ||
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
    Date.parse(iso(row.captured_at, 'capture time')) >
      Date.parse(request.knowledgeCutoffAt ?? request.effectiveThrough) ||
    Date.parse(iso(row.finalized_at, 'run finalization')) > Date.parse(createdAt)
  ) {
    throw new AflTradeHpnPavInputError(
      'SOURCE_AUTHORITY_MISMATCH',
      `Run ${row.normalization_run_id} is not an exact clean reviewed source.`
    );
  }
}
