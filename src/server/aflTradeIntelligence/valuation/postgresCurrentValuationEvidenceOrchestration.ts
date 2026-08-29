import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { aflTradeSourceSnapshotManifestSchema } from '../artifacts/sourceSnapshotManifest';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '../development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '../development/localOfficialAfl2026Authority';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { AflTradeFitzRoyCaptureError } from '../source/fitzRoyCaptureRuntime';
import { AflTradeFitzRoyStagingError } from '../source/fitzRoyCaptureToStaging';
import { requireCurrentAflTradeFitzRoyCaptureAuthority } from '../source/fitzRoyProviderIngestion';
import { AflTradeFitzRoyDecodeError } from '../source/fitzRoyObservationDecodeRuntime';
import { createAflTradeFitzRoyFieldMapSha256 } from '../source/fitzRoyObservationContracts';
import {
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES,
  aflTradeCurrentValuationEvidenceOrchestrationResultSchema,
  type AflTradeCurrentValuationEvidenceOrchestrationRepository,
  type AflTradeCurrentValuationEvidenceOrchestrationResult,
  type AflTradeCurrentValuationEvidenceSource,
  type AflTradeCurrentValuationEvidenceSourceRuntime,
  type AflTradeCurrentValuationNormalizedSource,
} from './currentValuationEvidenceOrchestration';
import type {
  AflTradeCurrentValuationRefreshRequest,
  AflTradeCurrentValuationRefreshResult,
} from './currentValuationRefresh';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

interface LoadedOperationRow {
  readonly result_json: unknown | null;
  readonly retained_source_keys: string[];
}

interface RetainedOperationRow {
  readonly operation_id: string;
  readonly operation_json: unknown;
  readonly result_json: unknown;
}

type SourceAuthority = ReturnType<typeof createLocalAflTradeFiveSeasonAflTablesAuthority>;

interface FieldMapAuthorityRow extends Record<string, unknown> {
  readonly map_json: unknown;
  readonly field_map_sha256: string;
  readonly approval_decision_id: string;
  readonly subject_type: string | null;
  readonly subject_id: string | null;
  readonly decision: string;
  readonly evidence_json: unknown;
  readonly current: boolean;
}

interface CurrentSourceRow extends Record<string, unknown> {
  readonly capture_id: string;
  readonly source_snapshot_id: string;
  readonly manifest_json: unknown;
  readonly normalization_run_id: string | null;
}

interface CurrentSourceWorkInput {
  readonly source: AflTradeCurrentValuationEvidenceSource;
  readonly authority: SourceAuthority;
}

interface ResumeSourceWorkInput extends CurrentSourceWorkInput {
  readonly snapshot: ReturnType<typeof aflTradeSourceSnapshotManifestSchema.parse>;
}

function sourceAuthority(source: AflTradeCurrentValuationEvidenceSource): SourceAuthority {
  if (source.capabilityId === 'official-afl-player-stats') {
    return createLocalAflTradeOfficialAfl2026Authority();
  }
  if (source.capabilityId === 'afl-tables-results') {
    return createLocalAflTradeAflTablesResultsAuthority(source.seasonYear);
  }
  return createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
}

function unavailable(
  stage: 'capture_authority' | 'capture' | 'normalization_authority' | 'normalization',
  cause: 'missing' | 'stale' | 'mismatched' | 'unauthenticated'
) {
  return { state: 'unavailable' as const, stage, cause };
}

function sourceFailure(
  error: unknown,
  defaultStage: 'capture' | 'normalization'
): ReturnType<typeof unavailable> {
  if (error instanceof AflTradeFitzRoyStagingError) {
    if (error.code === 'AUTHORITY_INVALID') {
      return unavailable('normalization_authority', 'unauthenticated');
    }
    if (error.code === 'INVALID_REQUEST') {
      return unavailable('normalization', 'unauthenticated');
    }
    if (error.code === 'STAGING_FAILED' && error.cause !== undefined) {
      return sourceFailure(error.cause, 'normalization');
    }
    return unavailable('normalization', 'missing');
  }
  if (error instanceof AflTradeFitzRoyDecodeError) {
    if (error.code === 'CUSTODY_MISMATCH') {
      return unavailable('normalization', 'unauthenticated');
    }
    if (error.code === 'INVALID_REQUEST' || error.code === 'OUTPUT_INVALID') {
      return unavailable('normalization', 'mismatched');
    }
    return unavailable('normalization', 'missing');
  }
  if (error instanceof AflTradeFitzRoyCaptureError) {
    if (
      error.code === 'RUNTIME_IDENTITY_MISMATCH' ||
      error.code === 'PRODUCTION_EXECUTION_DISABLED'
    ) {
      return unavailable('capture', 'unauthenticated');
    }
    if (
      error.code === 'INVALID_REQUEST' ||
      error.code === 'OUTPUT_INVALID' ||
      error.code === 'SCHEMA_DRIFT'
    ) {
      return unavailable('capture', 'mismatched');
    }
    if (error.code === 'AUTHORIZATION_BLOCKED') {
      return unavailable('capture_authority', 'stale');
    }
  }
  return unavailable(defaultStage, 'missing');
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function parseRetainedResult(
  request: AflTradeCurrentValuationRefreshRequest,
  row: RetainedOperationRow | undefined,
  rowCount: number
): AflTradeCurrentValuationEvidenceOrchestrationResult {
  if (row === undefined || rowCount !== 1) {
    throw new TypeError(
      'Current valuation evidence orchestration did not retain exactly one result.'
    );
  }
  const result = aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse(row.result_json);
  if (result.operationId !== row.operation_id) {
    throw new TypeError('Evidence orchestration result disagrees with retained operation custody.');
  }
  if (
    result.scopeKey !== request.scopeKey ||
    result.trigger !== request.trigger ||
    result.stableOperationKey !== request.stableOperationKey
  ) {
    throw new TypeError('Evidence orchestration result conflicts with the requested operation.');
  }
  return result;
}

export class PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository implements AflTradeCurrentValuationEvidenceOrchestrationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadOperation(request: AflTradeCurrentValuationRefreshRequest) {
    const loaded = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<LoadedOperationRow>(
        'SELECT * FROM load_outcome_current_valuation_evidence($1,$2,$3)',
        [request.scopeKey, request.trigger, request.stableOperationKey]
      );
    });
    const row = loaded.rows[0];
    if (row === undefined || loaded.rows.length !== 1) {
      throw new TypeError('Current valuation evidence orchestration state is unavailable.');
    }
    const knownSourceKeys = new Set(
      AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(({ sourceKey }) => sourceKey)
    );
    if (
      new Set(row.retained_source_keys).size !== row.retained_source_keys.length ||
      row.retained_source_keys.some((sourceKey) => !knownSourceKeys.has(sourceKey))
    ) {
      throw new TypeError('Retained evidence orchestration source custody is inconsistent.');
    }
    return {
      terminalResult:
        row.result_json === null
          ? null
          : aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse(row.result_json),
      retainedSourceKeys: row.retained_source_keys,
    };
  }

  async retainNormalizedSource(
    input: Parameters<
      AflTradeCurrentValuationEvidenceOrchestrationRepository['retainNormalizedSource']
    >[0]
  ): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(
        'SELECT retain_outcome_current_valuation_evidence_source($1,$2,$3,$4,$5,$6)',
        [
          input.request.scopeKey,
          input.request.trigger,
          input.request.stableOperationKey,
          input.sourceKey,
          input.captureId,
          input.normalizationRunId,
        ]
      );
    });
  }

  async retainUnavailable(
    request: AflTradeCurrentValuationRefreshRequest,
    unavailable: Parameters<
      AflTradeCurrentValuationEvidenceOrchestrationRepository['retainUnavailable']
    >[1]
  ) {
    const retained = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<RetainedOperationRow>(
        'SELECT * FROM retain_outcome_current_valuation_evidence_unavailable($1,$2,$3,$4,$5)',
        [
          request.scopeKey,
          request.trigger,
          request.stableOperationKey,
          unavailable.stage,
          unavailable.cause,
        ]
      );
    });
    return parseRetainedResult(request, retained.rows[0], retained.rows.length);
  }

  async retainComplete(
    request: AflTradeCurrentValuationRefreshRequest,
    factualRefresh: AflTradeCurrentValuationRefreshResult
  ) {
    const retained = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<RetainedOperationRow>(
        'SELECT * FROM retain_outcome_current_valuation_evidence_complete($1,$2,$3,$4)',
        [request.scopeKey, request.trigger, request.stableOperationKey, factualRefresh]
      );
    });
    return parseRetainedResult(request, retained.rows[0], retained.rows.length);
  }
}

export function createPostgresAflTradeCurrentValuationEvidenceSourceRuntime(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'resolveAuthorization'>;
  readonly clock: { now(): string };
  readonly captureAndNormalize: (
    input: CurrentSourceWorkInput
  ) => Promise<AflTradeCurrentValuationNormalizedSource>;
  readonly resumeNormalization: (
    input: ResumeSourceWorkInput
  ) => Promise<AflTradeCurrentValuationNormalizedSource>;
}): AflTradeCurrentValuationEvidenceSourceRuntime {
  return {
    async ensureCurrent(source) {
      const authority = sourceAuthority(source);
      let resolved: Awaited<ReturnType<typeof dependencies.gateRepository.resolveAuthorization>>;
      try {
        resolved = await dependencies.gateRepository.resolveAuthorization(
          authority.capture.sourceRights.rightsArtifactId
        );
      } catch {
        return unavailable('capture_authority', 'missing');
      }
      if (
        !exactJson(resolved.sourceRights, authority.capture.sourceRights) ||
        !resolved.ledger.decisions.some(({ decisionId }) => decisionId === authority.gateDecisionId)
      ) {
        return unavailable('capture_authority', 'mismatched');
      }
      try {
        const evaluatedAt = dependencies.clock.now();
        requireCurrentAflTradeFitzRoyCaptureAuthority({
          ledger: resolved.ledger,
          sourceRights: resolved.sourceRights,
          request: { ...authority.capture.gateRequest, evaluatedAt },
          capturedDecisionId: authority.gateDecisionId,
          evaluatedAt,
        });
      } catch {
        return unavailable('capture_authority', 'stale');
      }

      const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(authority.fieldMap);
      const fieldMapResult = await dependencies.client.query<FieldMapAuthorityRow>(
        `SELECT map.map_json,map.field_map_sha256,map.approval_decision_id,
                decision.subject_type,decision.subject_id,
                decision.decision,decision.evidence_json,
                NOT EXISTS (
                  SELECT 1 FROM outcome_review_decision successor
                   WHERE successor.supersedes_decision_id=decision.decision_id
                ) AS current
           FROM outcome_provider_field_map map
           LEFT JOIN outcome_review_decision decision
             ON decision.decision_id=map.approval_decision_id
          WHERE map.field_map_id=$1`,
        [authority.fieldMap.mapId]
      );
      const fieldMapRow = fieldMapResult.rows[0];
      if (fieldMapResult.rows.length === 0) {
        return unavailable('normalization_authority', 'missing');
      }
      if (
        fieldMapResult.rows.length !== 1 ||
        !fieldMapRow ||
        fieldMapRow.field_map_sha256 !== fieldMapSha256 ||
        fieldMapRow.approval_decision_id !== authority.fieldMap.approvalDecisionId ||
        !exactJson(fieldMapRow.map_json, authority.fieldMap)
      ) {
        return unavailable('normalization_authority', 'mismatched');
      }
      const evidence = fieldMapRow.evidence_json as Record<string, unknown> | null;
      if (!fieldMapRow.current) {
        return unavailable('normalization_authority', 'stale');
      }
      if (
        fieldMapRow.subject_type !== 'provider_field_map' ||
        fieldMapRow.subject_id !== authority.fieldMap.mapId ||
        fieldMapRow.decision !== 'approved' ||
        evidence?.fieldMapSha256 !== fieldMapSha256
      ) {
        return unavailable('normalization_authority', 'unauthenticated');
      }

      const current = await dependencies.client.query<CurrentSourceRow>(
        `SELECT capture.capture_id,capture.source_snapshot_id,capture.manifest_json,
                run.normalization_run_id
           FROM outcome_source_capture capture
           LEFT JOIN outcome_provider_normalization_run run
             ON run.capture_id=capture.capture_id
            AND run.field_map_id=$4
            AND run.status IN ('staged','needs_review')
            AND run.finalized_at IS NOT NULL
          WHERE capture.environment='non_production'
            AND capture.provider=$1
            AND capture.capability_id=$2
            AND capture.anchor_season_year=$3
            AND capture.status='staged'
            AND capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'=$5
            AND capture.manifest_json->'gate0aDecision'->>'decisionId'=$6
          ORDER BY capture.capture_id,run.normalization_run_id`,
        [
          source.provider,
          source.capabilityId,
          source.seasonYear,
          authority.fieldMap.mapId,
          authority.capture.sourceRights.rightsArtifactId,
          authority.gateDecisionId,
        ]
      );
      if (current.rows.length > 1) {
        return unavailable('normalization', 'mismatched');
      }
      const retained = current.rows[0];
      if (retained?.normalization_run_id) {
        return {
          state: 'ready',
          sourceKey: source.sourceKey,
          captureId: retained.capture_id,
          normalizationRunId: retained.normalization_run_id,
        };
      }
      const exactAuthority: SourceAuthority = {
        ...authority,
        capture: {
          ...authority.capture,
          ledger: resolved.ledger,
          sourceRights: resolved.sourceRights,
        },
      };
      if (retained) {
        let snapshot: ResumeSourceWorkInput['snapshot'];
        try {
          snapshot = aflTradeSourceSnapshotManifestSchema.parse({
            snapshotId: retained.source_snapshot_id,
            content: retained.manifest_json,
          });
        } catch {
          return unavailable('capture', 'unauthenticated');
        }
        try {
          const resumed = await dependencies.resumeNormalization({
            source,
            authority: exactAuthority,
            snapshot,
          });
          return resumed.sourceKey === source.sourceKey
            ? resumed
            : unavailable('normalization', 'mismatched');
        } catch (error) {
          return sourceFailure(error, 'normalization');
        }
      }
      try {
        const captured = await dependencies.captureAndNormalize({
          source,
          authority: exactAuthority,
        });
        return captured.sourceKey === source.sourceKey
          ? captured
          : unavailable('capture', 'mismatched');
      } catch (error) {
        return sourceFailure(error, 'capture');
      }
    },
  };
}
