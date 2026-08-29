import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  type AflTradePrivateReviewedEvidenceBundle,
} from '../valuation/privateReviewedEvidenceEvaluation';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from './localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from './localOfficialAfl2026Review';

export const LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY =
  'afl-player-match-reviewed-2021-2026' as const;

const HISTORICAL_REVIEWER = 'local-five-season-evidence-reviewer';
const OFFICIAL_REVIEWER = 'local-workbook-evidence-reviewer';
const HISTORICAL_REVIEW_SET_DECISION_ID =
  `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}` as const;
const OFFICIAL_REVIEW_SET_DECISION_ID =
  `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}` as const;
const REQUIRED_CAPTURE_TUPLE_KEYS = new Set([
  'afl_tables\u0000afl-tables-player-stats\u00002021',
  'afl_tables\u0000afl-tables-player-stats\u00002022',
  'afl_tables\u0000afl-tables-player-stats\u00002023',
  'afl_tables\u0000afl-tables-player-stats\u00002024',
  'afl_tables\u0000afl-tables-player-stats\u00002025',
  'official_afl\u0000official-afl-player-stats\u00002026',
  'afl_tables\u0000afl-tables-results\u00002026',
]);

const instantSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const publicIdSchema = z.string().trim().min(1).max(1_000);
const reviewSetEvidenceSchema = z
  .object({
    evidenceSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    appearanceCount: z.number().int().positive(),
    decisionCount: z.number().int().positive().optional(),
  })
  .passthrough();

interface ReviewSetRow extends Record<string, unknown> {
  decision_id: string;
  subject_type: string;
  subject_id: string;
  decision: string;
  canonical_record_type: string;
  canonical_record_id: string;
  supersedes_decision_id: string | null;
  rationale: string;
  evidence_json: unknown;
  decided_by: string;
  decided_at: Date | string;
  current: boolean;
}

interface ReviewHealthRow extends Record<string, unknown> {
  candidate_count: number | string;
  identity_count: number | string;
  match_count: number | string;
  factual_count: number | string;
}

interface OfficialHealthRow extends ReviewHealthRow {
  expected_count: number | string;
  approved_count: number | string;
}

interface CaptureRow extends Record<string, unknown> {
  capture_id: string;
  provider: string;
  capability_id: string;
  anchor_season_year: number | string;
  source_artifact_id: string;
  capture_manifest_json: unknown;
  artifact_content_sha256: string;
  artifact_storage_uri: string;
  artifact_media_type: string;
  artifact_byte_length: number | string;
  artifact_created_at: Date | string;
  artifact_verified_at: Date | string | null;
  rights_artifact_id: string;
  rights_proposed_at: Date | string;
  rights_content_json: unknown;
}

function isoTimestamp(value: Date | string): string {
  return new Date(instantSchema.parse(value)).toISOString();
}

function reviewSetSnapshot(row: ReviewSetRow) {
  return {
    decisionId: row.decision_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    decision: row.decision,
    canonicalRecordType: row.canonical_record_type,
    canonicalRecordId: row.canonical_record_id,
    supersedesDecisionId: row.supersedes_decision_id,
    rationale: row.rationale,
    evidence: row.evidence_json,
    decidedBy: row.decided_by,
    decidedAt: isoTimestamp(row.decided_at),
  };
}

function count(value: number | string): number {
  return z.coerce.number().int().nonnegative().parse(value);
}

function captureTupleKey(provider: string, capabilityId: string, seasonYear: number): string {
  return `${provider}\u0000${capabilityId}\u0000${seasonYear}`;
}

export function assertExactLocalReviewedProviderCaptureTuples(
  captures: readonly { provider: string; capabilityId: string; seasonYear: number }[]
): void {
  const captureTupleKeys = new Set(
    captures.map((capture) =>
      captureTupleKey(capture.provider, capture.capabilityId, capture.seasonYear)
    )
  );
  if (
    captures.length !== REQUIRED_CAPTURE_TUPLE_KEYS.size ||
    captureTupleKeys.size !== REQUIRED_CAPTURE_TUPLE_KEYS.size ||
    [...REQUIRED_CAPTURE_TUPLE_KEYS].some((tupleKey) => !captureTupleKeys.has(tupleKey))
  ) {
    throw new TypeError(
      'The retained provider capture set must contain exactly one capture for each required provider, capability, and season.'
    );
  }
}

async function loadReviewSets(transaction: AflOutcomeSqlTransaction) {
  const result = await transaction.query<ReviewSetRow>(
    `SELECT marker.*,
            NOT EXISTS (
              SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id=marker.decision_id
            ) AS current
       FROM outcome_review_decision marker
      WHERE marker.decision_id=ANY($1::text[])
      ORDER BY marker.subject_id
      FOR KEY SHARE OF marker`,
    [[HISTORICAL_REVIEW_SET_DECISION_ID, OFFICIAL_REVIEW_SET_DECISION_ID]]
  );
  if (result.rows.length !== 2) {
    throw new TypeError('Both exact retained provider review sets must exist.');
  }
  return result.rows.map((row) => {
    const evidence = reviewSetEvidenceSchema.parse(row.evidence_json);
    const expectedReviewer =
      row.subject_id === LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256
        ? HISTORICAL_REVIEWER
        : row.subject_id === LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256
          ? OFFICIAL_REVIEWER
          : null;
    if (
      expectedReviewer === null ||
      evidence.evidenceSetSha256 !== row.subject_id ||
      row.subject_type !== 'local_review_set' ||
      row.decision !== 'approved' ||
      row.canonical_record_type !== 'local_review_set' ||
      row.canonical_record_id !== row.subject_id ||
      row.supersedes_decision_id !== null ||
      row.decided_by !== expectedReviewer ||
      !row.current
    ) {
      throw new TypeError('A retained provider review set is not exact, approved, and current.');
    }
    const decisionCount = evidence.decisionCount ?? evidence.appearanceCount * 3;
    return {
      reviewSetId: row.subject_id,
      reviewSetDecisionId: row.decision_id,
      reviewerId: row.decided_by,
      candidateCount: evidence.appearanceCount,
      decisionCount,
      reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
        reviewSetSnapshot(row),
        isoTimestamp(row.decided_at)
      ),
    };
  });
}

async function assertHistoricalHealth(transaction: AflOutcomeSqlTransaction): Promise<void> {
  const result = await transaction.query<ReviewHealthRow>(
    `WITH candidates AS MATERIALIZED (
       SELECT decoded.provider_decoded_row_id,identity.identity_candidate_id,
              match.match_candidate_id,metric.availability::text AS availability,
              metric.numeric_value,metric.definition_version
         FROM outcome_provider_decoded_row decoded
         JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
         JOIN outcome_provider_normalization_run run
           ON run.normalization_run_id=decoded.normalization_run_id
          AND run.capture_id=decoded.capture_id
         JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
         JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
         JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
        WHERE capture.provider='afl_tables'
          AND capture.capability_id='afl-tables-player-stats'
          AND capture.environment='non_production'
          AND capture.status='staged'
          AND decoded.season_year BETWEEN 2021 AND 2025
          AND run.finalized_at IS NOT NULL
          AND identity.native_entity_id IS NOT NULL
          AND metric.metric_code='goals'
     )
     SELECT count(*)::integer AS candidate_count,
            count(identity_review.decision_id)::integer AS identity_count,
            count(match_review.decision_id)::integer AS match_count,
            count(factual_review.decision_id)::integer AS factual_count
       FROM candidates candidate
       LEFT JOIN outcome_review_decision identity_review
         ON identity_review.decision_id=
              'local-afl-tables-review:identity:'||candidate.identity_candidate_id
        AND identity_review.subject_type='provider_identity_candidate'
        AND identity_review.subject_id=candidate.identity_candidate_id
        AND identity_review.decision='approved'
        AND identity_review.decided_by=$2
        AND identity_review.evidence_json->>'evidenceSetSha256'=$1
        AND NOT EXISTS (
          SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id=identity_review.decision_id
        )
       LEFT JOIN outcome_review_decision match_review
         ON match_review.decision_id='local-afl-tables-review:match:'||candidate.match_candidate_id
        AND match_review.subject_type='provider_match_candidate'
        AND match_review.subject_id=candidate.match_candidate_id
        AND match_review.decision='approved'
        AND match_review.decided_by=$2
        AND match_review.evidence_json->>'evidenceSetSha256'=$1
        AND NOT EXISTS (
          SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id=match_review.decision_id
        )
       LEFT JOIN outcome_review_decision factual_review
         ON factual_review.decision_id=
              'local-afl-tables-review:fact:'||candidate.provider_decoded_row_id
        AND factual_review.subject_type='local_reconciled_player_match_fact'
        AND factual_review.subject_id=candidate.provider_decoded_row_id
        AND factual_review.decision='approved'
        AND factual_review.decided_by=$2
        AND factual_review.evidence_json->>'evidenceSetSha256'=$1
        AND factual_review.evidence_json->>'identityCandidateId'=candidate.identity_candidate_id
        AND factual_review.evidence_json->>'matchCandidateId'=candidate.match_candidate_id
        AND factual_review.evidence_json->>'metricCode'='goals'
        AND factual_review.evidence_json->>'definitionVersion'=candidate.definition_version
        AND factual_review.evidence_json->>'metricAvailability'=candidate.availability
        AND (factual_review.evidence_json->>'numericValue')::numeric
              IS NOT DISTINCT FROM candidate.numeric_value
        AND NOT EXISTS (
          SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id=factual_review.decision_id
        )`,
    [LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256, HISTORICAL_REVIEWER]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    !row ||
    count(row.candidate_count) !== 48_769 ||
    count(row.identity_count) !== 48_769 ||
    count(row.match_count) !== 48_769 ||
    count(row.factual_count) !== 48_769
  ) {
    throw new TypeError('The exact historical provider review set is not current and complete.');
  }
}

async function assertOfficialHealth(transaction: AflOutcomeSqlTransaction): Promise<void> {
  const result = await transaction.query<OfficialHealthRow>(
    `WITH marker AS MATERIALIZED (
       SELECT evidence_json FROM outcome_review_decision
        WHERE decision_id=$1 AND subject_id=$2 AND decision='approved'
          AND decided_by=$3
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=outcome_review_decision.decision_id
          )
     ), expected AS MATERIALIZED (
       SELECT value AS decision_id
         FROM marker,jsonb_array_elements_text(marker.evidence_json->'decisionIds') ids(value)
     ), approved AS MATERIALIZED (
       SELECT decision.*
         FROM expected
         JOIN outcome_review_decision decision USING (decision_id)
        WHERE decision.decision='approved'
          AND decision.decided_by=$3
          AND decision.evidence_json->>'evidenceSetSha256'=$2
          AND decision.subject_type=ANY($4::text[])
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
     ), exact_facts AS MATERIALIZED (
       SELECT approved.decision_id
         FROM approved
         JOIN outcome_provider_decoded_row decoded
           ON decoded.provider_decoded_row_id=approved.subject_id
         JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
         JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
         JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
         JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
        WHERE approved.subject_type='local_reconciled_player_match_fact'
          AND capture.provider='official_afl'
          AND capture.capability_id='official-afl-player-stats'
          AND capture.environment='non_production'
          AND capture.status='staged'
          AND decoded.season_year=2026
          AND match.provider_status='CONCLUDED'
          AND metric.metric_code='goals'
          AND approved.evidence_json->>'identityCandidateId'=identity.identity_candidate_id
          AND approved.evidence_json->>'matchCandidateId'=match.match_candidate_id
          AND approved.evidence_json->>'definitionVersion'=metric.definition_version
          AND approved.evidence_json->>'metricAvailability'=metric.availability::text
          AND (approved.evidence_json->>'numericValue')::numeric
                IS NOT DISTINCT FROM metric.numeric_value
     )
     SELECT (SELECT count(*) FROM expected)::integer AS expected_count,
            (SELECT count(*) FROM approved)::integer AS approved_count,
            count(*) FILTER (WHERE subject_type='provider_identity_candidate')::integer
              AS identity_count,
            count(*) FILTER (WHERE subject_type='provider_match_candidate')::integer
              AS match_count,
            (SELECT count(*) FROM exact_facts)::integer AS factual_count,
            (SELECT count(*) FROM exact_facts)::integer AS candidate_count
       FROM approved`,
    [
      OFFICIAL_REVIEW_SET_DECISION_ID,
      LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
      OFFICIAL_REVIEWER,
      [
        'provider_identity_candidate',
        'provider_match_candidate',
        'local_reconciled_player_match_fact',
      ],
    ]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    !row ||
    count(row.expected_count) !== 36 ||
    count(row.approved_count) !== 36 ||
    count(row.identity_count) !== 12 ||
    count(row.match_count) !== 12 ||
    count(row.factual_count) !== 12 ||
    count(row.candidate_count) !== 12
  ) {
    throw new TypeError('The exact official provider review set is not current and complete.');
  }
}

async function loadCaptureEvidence(transaction: AflOutcomeSqlTransaction): Promise<{
  sourceCaptures: Array<{
    captureId: string;
    provider: string;
    capabilityId: string;
    seasonYear: number;
    sourceArtifact: AflTradeArtifactRef;
  }>;
  sourceRightsEvidenceRefs: AflTradeArtifactRef[];
}> {
  const result = await transaction.query<CaptureRow>(
    `SELECT capture.capture_id,capture.provider,capture.capability_id,
            capture.anchor_season_year,capture.source_artifact_id,
            capture.manifest_json AS capture_manifest_json,
            custody.content_sha256 AS artifact_content_sha256,
            custody.storage_uri AS artifact_storage_uri,
            custody.media_type AS artifact_media_type,
            custody.byte_length AS artifact_byte_length,
            custody.created_at AS artifact_created_at,
            custody.verified_at AS artifact_verified_at,
            rights.rights_artifact_id,rights.proposed_at AS rights_proposed_at,
            rights.content_json AS rights_content_json
       FROM outcome_source_capture capture
       JOIN outcome_artifact_custody custody
         ON custody.artifact_id=capture.source_artifact_id
        AND custody.environment='non_production'
       JOIN outcome_source_rights_proposal rights
         ON rights.rights_artifact_id=
              capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'
      WHERE capture.environment='non_production' AND capture.status='staged'
        AND ((capture.provider='afl_tables'
              AND capture.capability_id='afl-tables-player-stats'
              AND capture.anchor_season_year BETWEEN 2021 AND 2025)
          OR (capture.provider='official_afl'
              AND capture.capability_id='official-afl-player-stats'
              AND capture.anchor_season_year=2026)
          OR (capture.provider='afl_tables'
              AND capture.capability_id='afl-tables-results'
              AND capture.anchor_season_year=2026))
        AND 1 = (
          SELECT count(*)
            FROM outcome_provider_normalization_run run
           WHERE run.capture_id=capture.capture_id
             AND run.status IN ('staged','needs_review')
             AND run.finalized_at IS NOT NULL
        )
      ORDER BY capture.capture_id
      FOR KEY SHARE OF capture,custody,rights`
  );
  if (result.rows.length !== 7) {
    throw new TypeError('The exact retained provider capture set must contain seven captures.');
  }
  const rightsByArtifactId = new Map<string, AflTradeArtifactRef>();
  const sourceCaptures = result.rows.map((row) => {
    const rights = aflTradeSourceRightsProposalSchema.parse(row.rights_content_json);
    if (
      row.artifact_verified_at === null ||
      rights.rightsArtifactId !== row.rights_artifact_id ||
      rights.content.proposedAt !== isoTimestamp(row.rights_proposed_at) ||
      canonicalizeAflTradeJson(row.capture_manifest_json) !==
        canonicalizeAflTradeJson({
          ...(row.capture_manifest_json as Record<string, unknown>),
          sourceRightsProposal: rights,
        })
    ) {
      throw new TypeError('Retained provider capture or source-rights custody is inconsistent.');
    }
    rightsByArtifactId.set(
      rights.rightsArtifactId,
      createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt)
    );
    return {
      captureId: publicIdSchema.parse(row.capture_id),
      provider: publicIdSchema.parse(row.provider),
      capabilityId: publicIdSchema.parse(row.capability_id),
      seasonYear: z.coerce.number().int().parse(row.anchor_season_year),
      sourceArtifact: aflTradeArtifactRefSchema.parse({
        artifactId: row.source_artifact_id,
        contentSha256: row.artifact_content_sha256,
        storageUri: row.artifact_storage_uri,
        mediaType: row.artifact_media_type,
        byteLength: Number(row.artifact_byte_length),
        createdAt: isoTimestamp(row.artifact_created_at),
      }),
    };
  });
  assertExactLocalReviewedProviderCaptureTuples(sourceCaptures);
  if (rightsByArtifactId.size !== 3) {
    throw new TypeError(
      'The exact retained provider capture set must retain three rights artifacts.'
    );
  }
  return {
    sourceCaptures,
    sourceRightsEvidenceRefs: [...rightsByArtifactId.values()].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId)
    ),
  };
}

/**
 * Authenticates the complete retained AFL Tables 2021-2025 player data, official-AFL 2026 player
 * data, and AFL Tables 2026 results evidence in one database snapshot. Missing, superseded, extra,
 * or custody-mismatched evidence fails before an evaluation bundle can exist.
 */
export async function loadExactLocalReviewedProviderEvidenceBundle(
  transaction: AflOutcomeSqlTransaction,
  createdAt: string
): Promise<AflTradePrivateReviewedEvidenceBundle> {
  await assertHistoricalHealth(transaction);
  await assertOfficialHealth(transaction);
  const [reviewSets, captures] = await Promise.all([
    loadReviewSets(transaction),
    loadCaptureEvidence(transaction),
  ]);
  return createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY,
    reviewSets,
    sourceCaptures: captures.sourceCaptures,
    sourceRightsEvidenceRefs: captures.sourceRightsEvidenceRefs,
    createdAt,
  });
}
