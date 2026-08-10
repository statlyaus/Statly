import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeSourceSnapshotManifestContentSchema } from '../artifacts/sourceSnapshotManifest';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { AFL_TRADE_FITZROY_DECODER_VERSION } from './fitzRoyObservationDecodeRuntime';
import {
  createAflTradeFitzRoyFieldMapSha256,
  type AflTradeFitzRoyFieldMap,
} from './fitzRoyObservationContracts';
import {
  AFL_TRADE_FITZROY_NORMALIZER_VERSION,
  type AflTradeProviderObservationBatch,
} from './fitzRoyObservationNormalizer';
import { AFL_TRADE_FITZROY_PINNED_VERSION } from './fitzRoyProviderCapabilities';

export interface PersistAflTradeProviderObservationInput {
  captureId: string;
  fieldMapId: string;
  fieldMap: AflTradeFitzRoyFieldMap;
  decodedSha256: string;
  batch: AflTradeProviderObservationBatch;
  startedAt: string;
  completedAt: string;
}

export interface PersistedAflTradeProviderObservation {
  normalizationRunId: string;
  captureId: string;
  rowCount: number;
  issueCount: number;
  status: 'staged' | 'needs_review';
  idempotentReplay: boolean;
}

export interface RecordAflTradeProviderNormalizationFailureInput {
  captureId: string;
  fieldMapId: string | null;
  failureCode:
    | 'decoder_failed'
    | 'output_invalid'
    | 'custody_mismatch'
    | 'field_map_unavailable'
    | 'persistence_failed';
  publicSafeReason: string;
  captureReceiptSha256: string;
  startedAt: string;
  completedAt: string;
}

export class AflTradeProviderObservationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'CAPTURE_MISMATCH'
      | 'FIELD_MAP_MISMATCH'
      | 'NORMALIZATION_CONFLICT'
      | 'NORMALIZATION_INCOMPLETE',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeProviderObservationPersistenceError';
  }
}

function isoInstant(value: string, field: string): string {
  let normalized: string | null = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    normalized = null;
  }
  if (normalized !== value) {
    throw new AflTradeProviderObservationPersistenceError(
      'INVALID_REQUEST',
      `${field} must be an exact UTC ISO-8601 instant.`
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

async function requireCaptureAndMap(
  transaction: AflOutcomeSqlTransaction,
  input: PersistAflTradeProviderObservationInput
) {
  const result = await transaction.query<{
    provider: string;
    manifest_json: unknown;
    capability_id: string | null;
    competition: string;
    status: string;
    content_sha256: string;
    field_capability_id: string;
    field_fitzroy_version: string;
    source_schema_sha256: string;
    field_map_sha256: string;
    field_map_approval_current: boolean;
    map_json: unknown;
  }>(
    `SELECT capture.provider,
            capture.manifest_json,
            capture.capability_id,
            capture.competition,
            capture.status,
            artifact.content_sha256,
            field_map.capability_id AS field_capability_id,
            field_map.fitzroy_version AS field_fitzroy_version,
            field_map.source_schema_sha256,
            field_map.field_map_sha256,
            NOT EXISTS (
              SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id = field_map.approval_decision_id
            ) AS field_map_approval_current,
            field_map.map_json
       FROM outcome_source_capture capture
       JOIN outcome_artifact_custody artifact ON artifact.artifact_id = capture.source_artifact_id
       JOIN outcome_provider_field_map field_map ON field_map.field_map_id = $2
      WHERE capture.capture_id = $1
      FOR SHARE OF capture, artifact, field_map`,
    [input.captureId, input.fieldMapId]
  );
  if (result.rows.length !== 1) {
    throw new AflTradeProviderObservationPersistenceError(
      'CAPTURE_MISMATCH',
      'The exact provider capture or approved field map is unavailable.'
    );
  }
  const row = result.rows[0]!;
  const receipt = input.batch.receipt;
  const manifestResult = aflTradeSourceSnapshotManifestContentSchema.safeParse(row.manifest_json);
  const manifest = manifestResult.success ? manifestResult.data : null;
  const storedCaptureReceipt = manifest?.fitzRoyCaptureReceipt ?? null;
  if (manifest?.capture.kind !== 'fitzroy' || storedCaptureReceipt === null) {
    throw new AflTradeProviderObservationPersistenceError(
      'CAPTURE_MISMATCH',
      'Provider staging requires an authenticated fitzRoy source snapshot manifest.'
    );
  }
  const captureContent = storedCaptureReceipt.content;
  if (
    row.provider !== manifest.capture.upstreamProvider ||
    manifest.capture.packageVersion !== AFL_TRADE_FITZROY_PINNED_VERSION ||
    row.capability_id !== receipt.capabilityId ||
    row.competition !== receipt.competition ||
    row.status === 'rejected' ||
    row.status === 'superseded' ||
    row.content_sha256 !== receipt.sourceRdsSha256 ||
    sha256AflTradeCanonicalJson(storedCaptureReceipt) !== receipt.captureReceiptSha256 ||
    captureContent.invocationCustody.artifact.contentSha256 !== receipt.invocationSha256 ||
    sha256AflTradeCanonicalJson(captureContent.invocation.arguments) !==
      receipt.invocationArgumentsSha256 ||
    captureContent.diagnosticsCustody.artifact.contentSha256 !== receipt.diagnosticsSha256 ||
    captureContent.sourceCustody.artifact.contentSha256 !== receipt.sourceRdsSha256 ||
    captureContent.schemaFingerprint.replace(/^sha256:/, '') !== receipt.sourceSchemaSha256 ||
    captureContent.invocation.capabilityId !== receipt.capabilityId ||
    captureContent.invocation.provider !== receipt.provider ||
    captureContent.invocation.fitzRoyVersion !== AFL_TRADE_FITZROY_PINNED_VERSION ||
    captureContent.authorizationReceipt.content.request.competition !== receipt.competition ||
    captureContent.authorizationReceipt.content.request.season !== receipt.authorizationSeason
  ) {
    throw new AflTradeProviderObservationPersistenceError(
      'CAPTURE_MISMATCH',
      'Provider staging does not match its immutable capture, capability, competition, or exact RDS bytes.'
    );
  }
  const scope = await transaction.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM outcome_source_capture_season
        WHERE capture_id = $1 AND competition = $2 AND season_year = $3
     ) AS found`,
    [input.captureId, receipt.competition, receipt.authorizationSeason]
  );
  if (scope.rows[0]?.found !== true) {
    throw new AflTradeProviderObservationPersistenceError(
      'CAPTURE_MISMATCH',
      'Provider staging season is outside the immutable capture scope.'
    );
  }
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(input.fieldMap);
  if (
    row.field_capability_id !== receipt.capabilityId ||
    row.field_fitzroy_version !== AFL_TRADE_FITZROY_PINNED_VERSION ||
    row.source_schema_sha256 !== receipt.sourceSchemaSha256 ||
    row.field_map_sha256 !== fieldMapSha256 ||
    row.field_map_approval_current !== true ||
    receipt.fieldMapSha256 !== fieldMapSha256 ||
    !sameJson(row.map_json, input.fieldMap)
  ) {
    throw new AflTradeProviderObservationPersistenceError(
      'FIELD_MAP_MISMATCH',
      'Provider staging does not match the exact reviewed schema and field map.'
    );
  }
}

async function insertRows(
  transaction: AflOutcomeSqlTransaction,
  input: PersistAflTradeProviderObservationInput,
  normalizationRunId: string,
  recordedAt: string
) {
  const rows = input.batch.rows.map((row) => ({
    provider_decoded_row_id: row.providerDecodedRowId,
    source_row_number: row.sourceRowNumber,
    source_row_sha256: row.sourceRowSha256,
    row_status: row.rowStatus,
    typed_payload: {
      observedSeasonText: row.observedSeasonText,
      roundLabel: row.roundLabel,
      observedDateText: row.observedDateText,
      appearanceCandidate: row.appearanceCandidate,
      semanticNaturalKeySha256: row.semanticNaturalKeySha256,
      values: row.typedPayload,
    },
  }));
  await transaction.query(
    `INSERT INTO outcome_provider_decoded_row
      (provider_decoded_row_id, normalization_run_id, capture_id, competition, season_year,
       source_row_number, source_row_sha256, row_status, typed_payload, recorded_at)
     SELECT source.provider_decoded_row_id, $2, $3, $4, $5,
            source.source_row_number, source.source_row_sha256, source.row_status::"OutcomeRecordStatus",
            source.typed_payload, $6
       FROM jsonb_to_recordset($1::jsonb) AS source(
         provider_decoded_row_id text,
         source_row_number integer,
         source_row_sha256 text,
         row_status text,
         typed_payload jsonb
       )`,
    [
      canonicalizeAflTradeJson(rows),
      normalizationRunId,
      input.captureId,
      input.batch.receipt.competition,
      input.batch.receipt.authorizationSeason,
      recordedAt,
    ]
  );
}

async function insertCandidates(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeProviderObservationBatch
) {
  const identities = batch.rows.flatMap((row) =>
    row.identityCandidate === null
      ? []
      : [
          {
            candidate_id: row.identityCandidate.candidateId,
            provider_decoded_row_id: row.providerDecodedRowId,
            provider: row.identityCandidate.provider,
            entity_kind: row.identityCandidate.entityKind,
            native_entity_id: row.identityCandidate.nativeEntityId,
            recorded_name: row.identityCandidate.recordedName,
            recorded_club_id: row.identityCandidate.recordedClubId,
            recorded_club_name: row.identityCandidate.recordedClubName,
            locator_sha256: row.identityCandidate.locatorSha256,
            candidate_sha256: sha256AflTradeCanonicalJson(row.identityCandidate),
            candidate_canonical_json: canonicalizeAflTradeJson(row.identityCandidate),
            candidate_json: row.identityCandidate,
          },
        ]
  );
  if (identities.length > 0) {
    await transaction.query(
      `INSERT INTO outcome_provider_identity_candidate
        (identity_candidate_id, provider_decoded_row_id, provider, entity_kind, native_entity_id,
         recorded_name, recorded_club_id, recorded_club_name, locator_sha256, candidate_sha256,
         candidate_canonical_json, candidate_json)
       SELECT candidate_id, provider_decoded_row_id, provider, entity_kind, native_entity_id,
              recorded_name, recorded_club_id, recorded_club_name, locator_sha256, candidate_sha256,
              candidate_canonical_json, candidate_json
         FROM jsonb_to_recordset($1::jsonb) AS source(
           candidate_id text, provider_decoded_row_id text, provider text, entity_kind text,
           native_entity_id text, recorded_name text, recorded_club_id text,
           recorded_club_name text, locator_sha256 text, candidate_sha256 text,
           candidate_canonical_json text, candidate_json jsonb
         )`,
      [canonicalizeAflTradeJson(identities)]
    );
  }
  const matches = batch.rows.flatMap((row) =>
    row.matchCandidate === null
      ? []
      : [
          {
            candidate_id: row.matchCandidate.candidateId,
            provider_decoded_row_id: row.providerDecodedRowId,
            provider: row.matchCandidate.provider,
            native_match_id: row.matchCandidate.nativeMatchId,
            round_label: row.matchCandidate.roundLabel,
            match_date_text: row.matchCandidate.matchDateText,
            home_club_native_id: row.matchCandidate.homeClubNativeId,
            home_club_name: row.matchCandidate.homeClubName,
            away_club_native_id: row.matchCandidate.awayClubNativeId,
            away_club_name: row.matchCandidate.awayClubName,
            provider_status: row.matchCandidate.providerStatus,
            order_independent_sha256: row.matchCandidate.orderIndependentSha256,
            candidate_sha256: sha256AflTradeCanonicalJson(row.matchCandidate),
            candidate_canonical_json: canonicalizeAflTradeJson(row.matchCandidate),
            candidate_json: row.matchCandidate,
          },
        ]
  );
  if (matches.length > 0) {
    await transaction.query(
      `INSERT INTO outcome_provider_match_candidate
        (match_candidate_id, provider_decoded_row_id, provider, native_match_id, round_label,
         match_date_text, home_club_native_id, home_club_name, away_club_native_id,
         away_club_name, provider_status, order_independent_sha256, candidate_sha256,
         candidate_canonical_json, candidate_json)
       SELECT candidate_id, provider_decoded_row_id, provider, native_match_id, round_label,
              match_date_text, home_club_native_id, home_club_name, away_club_native_id,
              away_club_name, provider_status, order_independent_sha256, candidate_sha256,
              candidate_canonical_json, candidate_json
         FROM jsonb_to_recordset($1::jsonb) AS source(
           candidate_id text, provider_decoded_row_id text, provider text, native_match_id text,
           round_label text, match_date_text text, home_club_native_id text, home_club_name text,
           away_club_native_id text, away_club_name text, provider_status text,
           order_independent_sha256 text, candidate_sha256 text,
           candidate_canonical_json text, candidate_json jsonb
         )`,
      [canonicalizeAflTradeJson(matches)]
    );
  }
  const metrics = batch.rows.flatMap((row) =>
    row.metricCandidates.map((metric) => ({
      provider_decoded_row_id: row.providerDecodedRowId,
      metric_code: metric.metricCode,
      definition_version: metric.definitionVersion,
      availability: metric.availability,
      numeric_value: metric.numericValue,
      unit: metric.unit,
      source_field: metric.sourceField,
      missing_reason: metric.missingReason,
      candidate_json: metric,
    }))
  );
  if (metrics.length > 0) {
    await transaction.query(
      `INSERT INTO outcome_provider_metric_candidate
        (provider_decoded_row_id, metric_code, definition_version, availability,
         numeric_value, unit, source_field, missing_reason, candidate_json)
       SELECT provider_decoded_row_id, metric_code, definition_version,
              availability::"OutcomeMetricAvailability", numeric_value::decimal(20,6), unit,
              source_field, missing_reason, candidate_json
         FROM jsonb_to_recordset($1::jsonb) AS source(
           provider_decoded_row_id text, metric_code text, definition_version text,
           availability text, numeric_value text, unit text, source_field text,
           missing_reason text, candidate_json jsonb
         )`,
      [canonicalizeAflTradeJson(metrics)]
    );
  }
  const achievements = batch.rows.flatMap((row) =>
    row.achievementCandidate === null
      ? []
      : [
          {
            candidate_id: row.achievementCandidate.candidateId,
            provider_decoded_row_id: row.providerDecodedRowId,
            achievement_code: row.achievementCandidate.achievementCode,
            evidence_value: row.achievementCandidate.evidenceValue,
            candidate_json: row.achievementCandidate,
          },
        ]
  );
  if (achievements.length > 0) {
    await transaction.query(
      `INSERT INTO outcome_provider_achievement_candidate
        (achievement_candidate_id, provider_decoded_row_id, achievement_code,
         evidence_value, candidate_json)
       SELECT candidate_id, provider_decoded_row_id, achievement_code, evidence_value, candidate_json
         FROM jsonb_to_recordset($1::jsonb) AS source(
           candidate_id text, provider_decoded_row_id text, achievement_code text,
           evidence_value text, candidate_json jsonb
         )`,
      [canonicalizeAflTradeJson(achievements)]
    );
  }
}

async function insertIssues(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeProviderObservationBatch,
  normalizationRunId: string,
  detectedAt: string
) {
  if (batch.issues.length === 0) return;
  const issues = batch.issues.map((issue, index) => ({
    issue_id: createAflTradeContentAddress('provider-normalization-issue', {
      normalizationRunId,
      ordinal: index + 1,
      issue,
    }),
    row_number: issue.rowNumber,
    code: issue.code,
    field: issue.field,
    details_json: issue,
  }));
  await transaction.query(
    `INSERT INTO outcome_provider_normalization_issue
      (issue_id, normalization_run_id, source_row_number, issue_code, source_field,
       details_json, detected_at)
     SELECT issue_id, $2, row_number, code, field, details_json, $3
       FROM jsonb_to_recordset($1::jsonb) AS source(
         issue_id text, row_number integer, code text, field text, details_json jsonb
       )`,
    [canonicalizeAflTradeJson(issues), normalizationRunId, detectedAt]
  );
}

export class PostgresAflTradeProviderObservationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async recordFailure(input: RecordAflTradeProviderNormalizationFailureInput): Promise<string> {
    const startedAt = isoInstant(input.startedAt, 'startedAt');
    const completedAt = isoInstant(input.completedAt, 'completedAt');
    if (
      Date.parse(completedAt) < Date.parse(startedAt) ||
      !/^[a-f0-9]{64}$/.test(input.captureReceiptSha256) ||
      input.publicSafeReason.trim().length === 0 ||
      input.publicSafeReason.length > 2_000
    ) {
      throw new AflTradeProviderObservationPersistenceError(
        'INVALID_REQUEST',
        'Normalization failure evidence is invalid or unbounded.'
      );
    }
    const evidence = {
      schemaVersion: 'afl-trade-provider-normalization-failure/v1',
      captureId: input.captureId,
      fieldMapId: input.fieldMapId,
      decoderVersion: AFL_TRADE_FITZROY_DECODER_VERSION,
      failureCode: input.failureCode,
      publicSafeReason: input.publicSafeReason,
      captureReceiptSha256: input.captureReceiptSha256,
      startedAt,
      completedAt,
      createsSuccessfulRun: false,
      publicationEligible: false,
    } as const;
    const attemptSha256 = sha256AflTradeCanonicalJson(evidence);
    const attemptId = createAflTradeContentAddress('provider-normalization-attempt', evidence);
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `outcome-provider-normalization-attempt:${input.captureId}`,
      ]);
      const capture = await transaction.query<{ manifest_json: unknown }>(
        `SELECT manifest_json FROM outcome_source_capture WHERE capture_id = $1 FOR SHARE`,
        [input.captureId]
      );
      const manifestResult = aflTradeSourceSnapshotManifestContentSchema.safeParse(
        capture.rows[0]?.manifest_json
      );
      const captureReceipt = manifestResult.success
        ? manifestResult.data.fitzRoyCaptureReceipt
        : null;
      if (
        captureReceipt === null ||
        captureReceipt === undefined ||
        sha256AflTradeCanonicalJson(captureReceipt) !== input.captureReceiptSha256
      ) {
        throw new AflTradeProviderObservationPersistenceError(
          'CAPTURE_MISMATCH',
          'Normalization failure must bind the exact authenticated fitzRoy capture receipt.'
        );
      }
      await transaction.query(
        `INSERT INTO outcome_provider_normalization_attempt
          (normalization_attempt_id, capture_id, field_map_id, decoder_version, attempt_sha256,
           failure_code, started_at, completed_at, evidence_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (normalization_attempt_id) DO NOTHING`,
        [
          attemptId,
          input.captureId,
          input.fieldMapId,
          AFL_TRADE_FITZROY_DECODER_VERSION,
          attemptSha256,
          input.failureCode,
          startedAt,
          completedAt,
          evidence,
        ]
      );
    });
    return attemptId;
  }

  async persist(
    input: PersistAflTradeProviderObservationInput
  ): Promise<PersistedAflTradeProviderObservation> {
    const startedAt = isoInstant(input.startedAt, 'startedAt');
    const completedAt = isoInstant(input.completedAt, 'completedAt');
    if (
      Date.parse(completedAt) < Date.parse(startedAt) ||
      !/^[a-f0-9]{64}$/.test(input.decodedSha256) ||
      input.decodedSha256 !== input.batch.receipt.decodedSha256
    ) {
      throw new AflTradeProviderObservationPersistenceError(
        'INVALID_REQUEST',
        'Normalization chronology or decoded artifact digest is invalid.'
      );
    }
    const receiptSha256 = sha256AflTradeCanonicalJson(input.batch.receipt);
    const stagingSha256 = sha256AflTradeCanonicalJson({
      normalizerVersion: AFL_TRADE_FITZROY_NORMALIZER_VERSION,
      receipt: input.batch.receipt,
      rows: input.batch.rows,
      issues: input.batch.issues,
    });
    const normalizationRunId = createAflTradeContentAddress('provider-normalization-run', {
      captureId: input.captureId,
      fieldMapId: input.fieldMapId,
      decoderVersion: AFL_TRADE_FITZROY_DECODER_VERSION,
      normalizerVersion: AFL_TRADE_FITZROY_NORMALIZER_VERSION,
      decodedSha256: input.decodedSha256,
      receiptSha256,
      stagingSha256,
    });
    const status = input.batch.receipt.status === 'candidate' ? 'staged' : 'needs_review';
    const identityCandidateCount = input.batch.rows.filter(
      ({ identityCandidate }) => identityCandidate !== null
    ).length;
    const matchCandidateCount = input.batch.rows.filter(
      ({ matchCandidate }) => matchCandidate !== null
    ).length;
    const metricCandidateCount = input.batch.rows.reduce(
      (count, candidate) => count + candidate.metricCandidates.length,
      0
    );
    const achievementCandidateCount = input.batch.rows.filter(
      ({ achievementCandidate }) => achievementCandidate !== null
    ).length;

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `outcome-provider-normalization:${input.captureId}:${input.fieldMapId}:${AFL_TRADE_FITZROY_DECODER_VERSION}:${AFL_TRADE_FITZROY_NORMALIZER_VERSION}`,
      ]);
      await requireCaptureAndMap(transaction, input);
      const existing = await transaction.query<{
        normalization_run_id: string;
        decoded_sha256: string;
        receipt_sha256: string;
        staging_sha256: string;
        normalizer_version: string;
        source_row_count: number | string;
        issue_count: number | string;
        identity_candidate_count: number | string;
        match_candidate_count: number | string;
        metric_candidate_count: number | string;
        achievement_candidate_count: number | string;
        status: 'staged' | 'needs_review';
        finalized_at: string | Date | null;
      }>(
        `SELECT normalization_run_id, decoded_sha256, receipt_sha256, staging_sha256,
                normalizer_version,
                source_row_count, issue_count, identity_candidate_count, match_candidate_count,
                metric_candidate_count, achievement_candidate_count, status, finalized_at
           FROM outcome_provider_normalization_run
          WHERE capture_id = $1 AND field_map_id = $2 AND decoder_version = $3
            AND normalizer_version = $4
          FOR SHARE`,
        [
          input.captureId,
          input.fieldMapId,
          AFL_TRADE_FITZROY_DECODER_VERSION,
          AFL_TRADE_FITZROY_NORMALIZER_VERSION,
        ]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0]!;
        if (
          existing.rows.length !== 1 ||
          row.normalization_run_id !== normalizationRunId ||
          row.decoded_sha256 !== input.decodedSha256 ||
          row.receipt_sha256 !== receiptSha256 ||
          row.staging_sha256 !== stagingSha256 ||
          row.normalizer_version !== AFL_TRADE_FITZROY_NORMALIZER_VERSION ||
          Number(row.source_row_count) !== input.batch.rows.length ||
          Number(row.issue_count) !== input.batch.issues.length ||
          Number(row.identity_candidate_count) !== identityCandidateCount ||
          Number(row.match_candidate_count) !== matchCandidateCount ||
          Number(row.metric_candidate_count) !== metricCandidateCount ||
          Number(row.achievement_candidate_count) !== achievementCandidateCount ||
          row.status !== status ||
          row.finalized_at === null
        ) {
          throw new AflTradeProviderObservationPersistenceError(
            'NORMALIZATION_CONFLICT',
            'Provider normalization idempotency key already binds different evidence.'
          );
        }
        return {
          normalizationRunId,
          captureId: input.captureId,
          rowCount: input.batch.rows.length,
          issueCount: input.batch.issues.length,
          status,
          idempotentReplay: true,
        };
      }

      await transaction.query(
        `INSERT INTO outcome_provider_normalization_run
          (normalization_run_id, capture_id, field_map_id, decoder_version, normalizer_version,
           source_rds_sha256, decoded_sha256, receipt_sha256, staging_sha256, status,
           source_row_count, accepted_row_count,
           quarantined_row_count, issue_count, identity_candidate_count, match_candidate_count,
           metric_candidate_count, achievement_candidate_count, started_at, completed_at,
           finalized_at, receipt_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NULL,$21)`,
        [
          normalizationRunId,
          input.captureId,
          input.fieldMapId,
          AFL_TRADE_FITZROY_DECODER_VERSION,
          AFL_TRADE_FITZROY_NORMALIZER_VERSION,
          input.batch.receipt.sourceRdsSha256,
          input.decodedSha256,
          receiptSha256,
          stagingSha256,
          status,
          input.batch.receipt.sourceRowCount,
          input.batch.receipt.acceptedRowCount,
          input.batch.receipt.quarantinedRowCount,
          input.batch.receipt.issueCount,
          identityCandidateCount,
          matchCandidateCount,
          metricCandidateCount,
          achievementCandidateCount,
          startedAt,
          completedAt,
          input.batch.receipt,
        ]
      );
      await insertRows(transaction, input, normalizationRunId, completedAt);
      await insertCandidates(transaction, input.batch);
      await insertIssues(transaction, input.batch, normalizationRunId, completedAt);
      const finalization = await transaction.query(
        `UPDATE outcome_provider_normalization_run
            SET finalized_at = $2
          WHERE normalization_run_id = $1 AND finalized_at IS NULL`,
        [normalizationRunId, completedAt]
      );
      if (finalization.rowCount !== 1) {
        throw new AflTradeProviderObservationPersistenceError(
          'NORMALIZATION_CONFLICT',
          'Provider normalization could not complete its exact finalization transition.'
        );
      }
      return {
        normalizationRunId,
        captureId: input.captureId,
        rowCount: input.batch.rows.length,
        issueCount: input.batch.issues.length,
        status,
        idempotentReplay: false,
      };
    });
  }
}
