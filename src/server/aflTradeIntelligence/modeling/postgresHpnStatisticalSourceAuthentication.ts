import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { decodedScalar } from './hpnDecodedScalar';
import type { AflTradeHpnPavInputFieldMap } from './hpnPavInputContracts';
import {
  aflTradeHpnStatisticalCellSchema,
  type AflTradeHpnStatisticalCell,
} from './hpnStatisticalAdjudication';
import { inspectAflTradeHpnStatisticalIdentity } from './postgresHpnStatisticalIdentityInspection';
import {
  loadAflTradeHpnSourceRuns,
  requireAflTradeHpnSourceRunAuthority,
} from './postgresHpnSourceAuthority';

interface RetainedRow {
  provider_decoded_row_id: string;
  normalization_run_id: string;
  capture_id: string;
  competition: string;
  season_year: number;
  row_status: string;
  source_row_sha256: string;
  typed_payload: unknown;
  recorded_at: Date | string;
}

function numericMapping(map: AflTradeHpnPavInputFieldMap, statistic: string) {
  if (map.content.inputKind !== 'player_match_stats')
    throw new Error('Expected a player-stat map.');
  if (map.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1') {
    const mapping = map.content.semanticBindings.find(
      (binding) => binding.semanticField === statistic
    )?.mapping;
    if (mapping?.kind === 'direct') return { fields: [mapping.sourceField], weights: [1] };
    if (statistic === 'totalPoints' && mapping?.kind === 'goals_plus_behinds') {
      return { fields: [mapping.goals, mapping.behinds], weights: [6, 1] };
    }
  } else {
    const bindings = map.content.bindings as Record<string, unknown>;
    const mapping = bindings[statistic];
    if (typeof mapping === 'string') return { fields: [mapping], weights: [1] };
    if (statistic === 'totalPoints') {
      const points = map.content.bindings.totalPoints;
      if (points.kind === 'total_points') return { fields: [points.totalPoints], weights: [1] };
      return { fields: [points.goals, points.behinds], weights: [6, 1] };
    }
  }
  throw new Error('Statistic has no supported reviewed numeric mapping.');
}

function retainedValue(
  payload: unknown,
  mapping: ReturnType<typeof numericMapping>,
  reviewedZero = false
) {
  const values = mapping.fields.map((field) => decodedScalar(payload, field));
  if (
    values.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error('Retained statistic must contain measured safe nonnegative integers.');
  }
  if (values.some((value) => value === 0) && !reviewedZero) {
    throw new Error('Zero values require separate governed representation evidence.');
  }
  const value = values.reduce<number>(
    (sum, scalar, index) => sum + (scalar as number) * mapping.weights[index],
    0
  );
  if (!Number.isSafeInteger(value))
    throw new Error('Projected statistic exceeds safe integer precision.');
  return value;
}

type SourceContext =
  Awaited<ReturnType<typeof loadAflTradeHpnSourceRuns>> extends Map<string, infer Context>
    ? Context
    : never;
function requireExactObservationCustody(
  cell: AflTradeHpnStatisticalCell,
  observation: AflTradeHpnStatisticalCell['primary'],
  context: SourceContext,
  row: RetainedRow | undefined
): asserts row is RetainedRow {
  const expected = {
    normalizationRunId: context.row.normalization_run_id,
    stagingSha256: context.row.staging_sha256,
    provider: context.row.capture_provider,
    capabilityId: context.row.capture_capability_id,
    captureId: context.row.capture_id,
    sourceSnapshotId: context.row.source_snapshot_id,
    sourceArtifactId: context.row.source_artifact_id,
    sourceRowSha256: row?.source_row_sha256,
    typedPayloadSha256: row && sha256AflTradeCanonicalJson(row.typed_payload),
    fieldMapId: context.map.fieldMapId,
    fieldMapSha256: sha256AflTradeCanonicalJson(context.map.content),
  };
  if (
    !row ||
    Object.entries(expected).some(
      ([key, value]) => observation[key as keyof typeof observation] !== value
    ) ||
    row.normalization_run_id !== observation.normalizationRunId ||
    row.capture_id !== observation.captureId ||
    row.competition !== cell.scope.competitionId ||
    row.season_year !== cell.scope.season ||
    row.row_status !== 'staged' ||
    !(Date.parse(new Date(row.recorded_at).toISOString()) <= Date.parse(cell.createdAt)) ||
    !(
      Date.parse(new Date(context.row.finalized_at!).toISOString()) <= Date.parse(cell.createdAt)
    ) ||
    (context.map.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1' &&
      Date.parse(context.map.content.createdAt) > Date.parse(cell.createdAt))
  ) {
    throw new Error('Statistical observation does not match exact retained source custody.');
  }
}

/**
 * Authenticate both retained source observations in the caller's transaction. This is a source
 * comparison, not a decision approval: identity snapshots require locked rechecks at promotion;
 * reviewer/evidence authority and current heads remain separate. Never cache as calculation authority.
 */
export async function authenticateAflTradeHpnStatisticalSources(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  support?: { decisionId: string; reviewId: string }
) {
  const cell = aflTradeHpnStatisticalCellSchema.parse(input);
  if (cell.scope.competitionId !== 'AFLM' || cell.scope.season < 1998 || cell.scope.season > 2200) {
    throw new Error('Statistical source authentication requires the supported AFLM season scope.');
  }
  const clock = await transaction.query<{ checked_at: Date }>(
    "SELECT date_trunc('milliseconds',clock_timestamp()) AS checked_at"
  );
  const checkedAt = new Date(clock.rows[0].checked_at).toISOString();
  if (Date.parse(cell.createdAt) > Date.parse(checkedAt))
    throw new Error('Candidate is future-dated.');
  let reviewedZero = false;
  if (support) {
    const verified = await transaction.query<{ current: boolean }>(
      `SELECT outcome_hpn_statistical_support_is_current($1) AND EXISTS (
        SELECT 1 FROM outcome_hpn_statistical_support_review r
        JOIN outcome_hpn_statistical_decision_custody d USING(decision_id)
        WHERE r.review_id=$1 AND r.decision_id=$2
          AND d.decision_json#>>'{candidate,candidateId}'=$3) AS current`,
      [support.reviewId, support.decisionId, cell.candidateId]
    );
    if (verified.rows[0]?.current !== true)
      throw new Error('Current exact statistical support is required.');
    reviewedZero = true;
  }
  const roles = ['primary', 'corroborating'] as const;
  const contexts = await loadAflTradeHpnSourceRuns(
    transaction,
    roles.map((role) => ({
      normalizationRunId: cell[role].normalizationRunId,
      fieldMapId: cell[role].fieldMapId,
      inputKind: 'player_match_stats',
      role,
    }))
  );
  const rows = await transaction.query<RetainedRow>(
    `SELECT provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
            row_status::text,source_row_sha256,typed_payload,recorded_at
       FROM outcome_provider_decoded_row WHERE provider_decoded_row_id=ANY($1::text[])
      ORDER BY provider_decoded_row_id FOR SHARE`,
    [roles.map((role) => cell[role].providerDecodedRowId)]
  );
  if (rows.rows.length !== 2) throw new Error('Both exact retained source rows are required.');
  const identities = [];
  for (const role of roles) {
    const observation = cell[role];
    const context = contexts.get(observation.normalizationRunId)!;
    await requireAflTradeHpnSourceRunAuthority(
      transaction,
      {
        environment: cell.scope.environment,
        competition: 'AFLM',
        seasonYear: cell.scope.season,
        effectiveThrough: cell.createdAt,
        knowledgeCutoffAt: cell.createdAt,
      },
      checkedAt,
      context,
      support ? { ...support, candidateId: cell.candidateId } : undefined
    );
    const row = rows.rows.find(
      (item) => item.provider_decoded_row_id === observation.providerDecodedRowId
    )!;
    requireExactObservationCustody(cell, observation, context, row);
    if (observation.representation !== 'measured' && !reviewedZero) {
      throw new Error(
        'A non-measured zero representation requires separate governed representation evidence.'
      );
    }
    if (
      reviewedZero &&
      observation.value === 0 &&
      observation.representation !== 'retained_zero_origin_unknown'
    ) {
      throw new Error('A retained zero must preserve unknown original provenance.');
    }
    const mapping = numericMapping(context.map, cell.scope.statistic);
    if (
      canonicalizeAflTradeJson([...observation.sourceFields].sort()) !==
        canonicalizeAflTradeJson([...mapping.fields].sort()) ||
      retainedValue(row.typed_payload, mapping, reviewedZero) !== observation.value
    ) {
      throw new Error('Statistical observation changes the reviewed fields or retained value.');
    }
    identities.push({
      role,
      ...(await inspectAflTradeHpnStatisticalIdentity(
        transaction,
        cell,
        row.provider_decoded_row_id,
        context.map,
        row.typed_payload
      )),
    });
  }
  return {
    candidateId: cell.candidateId,
    checkedAt,
    status: 'retained_sources_match' as const,
    identities,
    identityAuthority: 'read_only_snapshot_requires_locked_recheck' as const,
    calculationEligible: false as const,
    publicationEligible: false as const,
  };
}
