import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import {
  createLocalAflTradeHpnCompletedResultFieldMapCandidate,
  createLocalAflTradeHpnPlayerFieldMapCandidate,
} from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { assessAflTradeHpnPrivateCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION,
  AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION,
  aflTradePrivateValuationCaptureBindingSchema,
  type AflTradePrivateValuationCaptureBinding,
} from '@/server/aflTradeIntelligence/valuation/privateValuationCaptureBinding';
import { createAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import { createAflTradePrivateValuationHpnSourceAdmission } from '@/server/aflTradeIntelligence/valuation/privateValuationHpnSourceAdmission';
import { createAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/privateValuationSourceAdmission';
import { PostgresAflTradePrivateValuationHpnPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnPreparation';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import {
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_hpn_projected_input_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(outcomesPool);

const seasonYear = 2026;
const competition = 'AFLM';
const matchId = 'match:fixture-final';
const homeClubId = 'club:home';
const awayClubId = 'club:away';
const playerIds = ['player:home', 'player:away'] as const;
const fixtureAt = '2026-08-09T00:00:00.000Z';
const finalizedAt = '2026-08-09T02:00:00.000Z';
const legacyReviewAt = '2026-08-14T00:00:00.000Z';
const projectionAt = '2026-08-15T00:00:00.000Z';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (prefix: string, value: string) => `${prefix}:${sha256(value)}`;
const scalar = (value: string | number) =>
  typeof value === 'number' ? { kind: 'integer', value: String(value) } : { kind: 'text', value };

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

type Lane = Readonly<{
  inputKind: 'completed_match_result' | 'player_match_stats';
  role: 'primary' | 'corroborating' | null;
  suffix: string;
  sourceRole:
    'hpn_completed_results' | 'hpn_primary_player_stats' | 'hpn_corroborating_player_stats';
  authority:
    | ReturnType<typeof createLocalAflTradeFiveSeasonAflTablesAuthority>
    | ReturnType<typeof createLocalAflTradeOfficialAfl2026Authority>;
}>;

type ReviewedCaptureSource = Readonly<{
  suffix: string;
  seasonYear: number;
  authority: Lane['authority'];
}>;

const lanes: readonly Lane[] = [
  {
    inputKind: 'completed_match_result',
    role: null,
    suffix: 'results',
    sourceRole: 'hpn_completed_results',
    authority: createLocalAflTradeAflTablesResultsAuthority(seasonYear),
  },
  {
    inputKind: 'player_match_stats',
    role: 'primary',
    suffix: 'primary',
    sourceRole: 'hpn_primary_player_stats',
    authority: createLocalAflTradeFiveSeasonAflTablesAuthority(seasonYear),
  },
  {
    inputKind: 'player_match_stats',
    role: 'corroborating',
    suffix: 'corroborating',
    sourceRole: 'hpn_corroborating_player_stats',
    authority: createLocalAflTradeOfficialAfl2026Authority(),
  },
];

const reviewedCaptureSources = [
  ...[2021, 2022, 2023, 2024, 2025].map((reviewedSeasonYear) => ({
    suffix: `reviewed-afl-tables-${reviewedSeasonYear}`,
    seasonYear: reviewedSeasonYear,
    authority: createLocalAflTradeFiveSeasonAflTablesAuthority(reviewedSeasonYear),
  })),
  {
    suffix: 'corroborating',
    seasonYear,
    authority: createLocalAflTradeOfficialAfl2026Authority(),
  },
  {
    suffix: 'results',
    seasonYear,
    authority: createLocalAflTradeAflTablesResultsAuthority(seasonYear),
  },
] as const satisfies readonly ReviewedCaptureSource[];

let retainedBackdatedAdmissionFixture:
  | Readonly<{
      requestId: string;
      originalClaimId: string;
      binding: AflTradePrivateValuationCaptureBinding;
      projected: ReturnType<typeof projection>;
    }>
  | undefined;

const reviewedSourceArtifact = (suffix: string) =>
  createAflTradeCanonicalJsonArtifactRef({ sourceCapture: suffix }, fixtureAt);

function reviewedEvaluation(
  valuationScopeKey = 'afl-men:2026-trades',
  includeResults = true,
  createdAt = projectionAt,
  revision = 1,
  supersedesDecisionId: string | null = null,
  sources: readonly ReviewedCaptureSource[] = reviewedCaptureSources
) {
  const includedSources = sources.filter(
    ({ authority }) => includeResults || authority.fieldMap.capabilityId !== 'afl-tables-results'
  );
  const sourceRightsEvidenceRefs = [
    ...new Map(
      includedSources.map(({ authority }) => {
        const reference = createAflTradeCanonicalJsonArtifactRef(
          authority.capture.sourceRights,
          authority.capture.sourceRights.content.proposedAt
        );
        return [reference.artifactId, reference] as const;
      })
    ).values(),
  ].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const evidenceBundle = createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [
      {
        reviewSetId: sha256('projected-hpn-input-review-set'),
        reviewSetDecisionId: 'projected-hpn-input-review-set-decision',
        reviewerId: 'projected-hpn-input-fixture-reviewer',
        candidateCount: 1,
        decisionCount: 1,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { reviewSet: 'projected-hpn-input' },
          legacyReviewAt
        ),
      },
    ],
    sourceCaptures: includedSources.map((source) => ({
      captureId: id('source-capture', source.suffix),
      provider: source.authority.capture.sourceRights.content.provider,
      capabilityId: source.authority.fieldMap.capabilityId,
      seasonYear: source.seasonYear,
      sourceArtifact: reviewedSourceArtifact(source.suffix),
    })),
    sourceRightsEvidenceRefs,
    createdAt,
  });
  const evidenceBundleArtifact = createAflTradeCanonicalJsonArtifactRef(evidenceBundle, createdAt);
  const evaluationDecision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
    status: 'authorized',
    valuationScopeKey,
    evidenceBundle,
    evidenceBundleArtifact,
    revision,
    supersedesDecisionId,
    reviewerId: 'projected-hpn-input-fixture-reviewer',
    rationale: 'Authorize exact retained review evidence for the private HPN fixture.',
    decidedAt: createdAt,
  });
  return { evidenceBundle, evidenceBundleArtifact, evaluationDecision };
}

function reviewedEvaluationSuccessor(
  valuationScopeKey = 'afl-men:2026-trades',
  sources: readonly ReviewedCaptureSource[] = reviewedCaptureSources
) {
  const legacy = reviewedEvaluation(valuationScopeKey, false, legacyReviewAt);
  return {
    legacy,
    successor: reviewedEvaluation(
      valuationScopeKey,
      true,
      projectionAt,
      2,
      legacy.evaluationDecision.decisionId,
      sources
    ),
  };
}

function projection(
  lane: Lane,
  valuationScopeKey = 'afl-men:2026-trades',
  reviewed = reviewedEvaluationSuccessor(valuationScopeKey).successor
) {
  const decodeMap = lane.authority.fieldMap;
  const decodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(decodeMap, projectionAt);
  const candidate =
    lane.inputKind === 'completed_match_result'
      ? createLocalAflTradeHpnCompletedResultFieldMapCandidate({
          seasonYear,
          providerDecodeMap: decodeMap,
          providerDecodeMapArtifact: decodeMapArtifact,
          createdAt: projectionAt,
        })
      : createLocalAflTradeHpnPlayerFieldMapCandidate({
          provider: lane.suffix === 'corroborating' ? 'official_afl' : 'afl_tables',
          seasonYear,
          providerDecodeMap: decodeMap,
          providerDecodeMapArtifact: decodeMapArtifact,
          createdAt: projectionAt,
        });
  const exactOrderedFields = [
    ...new Set(candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)),
  ].sort();
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, projectionAt);
  const sourceUseAssessment = assessAflTradeHpnPrivateCalculationSourceUse({
    rights: lane.authority.capture.sourceRights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(
      lane.authority.capture.sourceRights,
      lane.authority.capture.sourceRights.content.proposedAt
    ),
    evidenceBundle: reviewed.evidenceBundle,
    admission: createAflTradePrivateReviewedEvidenceEvaluationAdmission(
      reviewed.evaluationDecision
    ),
    competition,
    seasonYear,
    sourceFields: exactOrderedFields,
    evaluatedAt: projectionAt,
  });
  const sourceUseAssessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
    sourceUseAssessment,
    projectionAt
  );
  const reviewDecision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    decision: 'approved',
    reviewerId: 'projected-hpn-input-fixture-reviewer',
    rationale: 'Approve the exact disposable PostgreSQL projection.',
    decidedAt: projectionAt,
  });
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(reviewDecision, projectionAt);
  const projectedFieldMap = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision: reviewDecision,
    decisionArtifact,
  });
  return {
    lane,
    decodeMap,
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    reviewDecision,
    decisionArtifact,
    projectedFieldMap,
  };
}

async function seedSourceAndFactualAuthority(
  projections: readonly ReturnType<typeof projection>[]
): Promise<void> {
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    const reviewed = reviewedEvaluationSuccessor();
    const bundleCanonical = canonicalizeAflTradeJson(reviewed.legacy.evidenceBundle.content);
    const decisionCanonical = canonicalizeAflTradeJson(reviewed.legacy.evaluationDecision.content);
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle
        (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
         source_capture_count,source_rights_count,created_at,bundle_sha256,
         bundle_content_canonical_json,bundle_json,registered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$7)`,
      [
        reviewed.legacy.evidenceBundle.evidenceBundleId,
        reviewed.legacy.evidenceBundle.content.evidenceScopeKey,
        reviewed.legacy.evidenceBundle.content.candidateCount,
        reviewed.legacy.evidenceBundle.content.decisionCount,
        reviewed.legacy.evidenceBundle.content.sourceCaptures.length,
        reviewed.legacy.evidenceBundle.content.sourceRightsEvidenceRefs.length,
        reviewed.legacy.evidenceBundle.content.createdAt,
        reviewed.legacy.evidenceBundle.evidenceBundleId.split(':').at(-1),
        bundleCanonical,
        canonicalizeAflTradeJson(reviewed.legacy.evidenceBundle),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_decision
        (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
         supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
         decision_content_canonical_json,decision_json,registered_at)
       VALUES ($1,$2,$3,'authorized',1,NULL,$4,$5,$6,$7,$8::jsonb,$5)`,
      [
        reviewed.legacy.evaluationDecision.decisionId,
        reviewed.legacy.evaluationDecision.content.valuationScopeKey,
        reviewed.legacy.evidenceBundle.evidenceBundleId,
        reviewed.legacy.evaluationDecision.content.reviewerId,
        reviewed.legacy.evaluationDecision.content.decidedAt,
        reviewed.legacy.evaluationDecision.decisionId.split(':').at(-1),
        decisionCanonical,
        canonicalizeAflTradeJson(reviewed.legacy.evaluationDecision),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_head
        (valuation_scope_key,evidence_scope_key,revision,decision_id,
         evidence_bundle_id,status,updated_at)
       VALUES ($1,$2,1,$3,$4,'authorized',$5)`,
      [
        reviewed.legacy.evaluationDecision.content.valuationScopeKey,
        reviewed.legacy.evidenceBundle.content.evidenceScopeKey,
        reviewed.legacy.evaluationDecision.decisionId,
        reviewed.legacy.evidenceBundle.evidenceBundleId,
        reviewed.legacy.evaluationDecision.content.decidedAt,
      ]
    );
    for (const source of reviewedCaptureSources) {
      const sourceRights = source.authority.capture.sourceRights;
      const sourceArtifact = reviewedSourceArtifact(source.suffix);
      await transaction.query(
        `INSERT INTO outcome_source_rights_proposal
          (rights_artifact_id,provider,dataset,dataset_version,capability_id,
           proposed_at,content_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (rights_artifact_id) DO NOTHING`,
        [
          sourceRights.rightsArtifactId,
          sourceRights.content.provider,
          sourceRights.content.dataset,
          sourceRights.content.datasetVersion,
          source.authority.fieldMap.capabilityId,
          sourceRights.content.proposedAt,
          canonicalizeAflTradeJson(sourceRights),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,custody_profile_id,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,'{}'::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          sourceArtifact.artifactId,
          sourceArtifact.contentSha256,
          sourceArtifact.storageUri,
          sourceArtifact.mediaType,
          sourceArtifact.byteLength,
          sourceArtifact.createdAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,
           provider,dataset,dataset_version,access_mechanism,capability_id,competition,
           anchor_season_year,effective_at,captured_at,status,manifest_json)
         VALUES ($1,$2,$3,$4,'non_production',$5,$6,'fixture','fixture',$7,$8,$9,$10,$10,
                 'staged',$11::jsonb)
         ON CONFLICT (capture_id) DO NOTHING`,
        [
          id('source-capture', source.suffix),
          id('source-capture-attempt', source.suffix),
          id('source-snapshot', source.suffix),
          sourceArtifact.artifactId,
          sourceRights.content.provider,
          sourceRights.content.dataset,
          source.authority.fieldMap.capabilityId,
          competition,
          source.seasonYear,
          fixtureAt,
          canonicalizeAflTradeJson({
            gate0aReceipt: {
              content: { request: { rightsArtifactId: sourceRights.rightsArtifactId } },
            },
            sourceRightsProposal: sourceRights,
          }),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id('source-capture', source.suffix), competition, source.seasonYear]
      );
      const decodeMap = source.authority.fieldMap;
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,
           decided_by,decided_at)
         VALUES ($1,'provider_field_map',$2,'approved',$3,
                 jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
         ON CONFLICT (decision_id) DO NOTHING`,
        [
          decodeMap.approvalDecisionId,
          decodeMap.mapId,
          'Approve the exact disposable reviewed-evidence decode map.',
          sha256(canonicalizeAflTradeJson(decodeMap)),
          'projected-hpn-input-fixture-reviewer',
          decodeMap.approvedAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_provider_field_map
          (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
           field_map_sha256,approval_decision_id,approved_at,map_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (field_map_id) DO NOTHING`,
        [
          decodeMap.mapId,
          decodeMap.capabilityId,
          decodeMap.fitzRoyVersion,
          decodeMap.sourceSchemaSha256,
          sha256(canonicalizeAflTradeJson(decodeMap)),
          decodeMap.approvalDecisionId,
          decodeMap.approvedAt,
          canonicalizeAflTradeJson(decodeMap),
        ]
      );
      if (source.suffix !== 'results' && source.suffix !== 'corroborating') {
        await transaction.query(
          `INSERT INTO outcome_provider_normalization_run
          (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
           source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,
           source_row_count,accepted_row_count,quarantined_row_count,issue_count,
           identity_candidate_count,match_candidate_count,metric_candidate_count,
           achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json)
         VALUES ($1,$2,$3,'reviewed-fixture','reviewed-fixture',$4,$5,$6,$7,
                 'staged',0,0,0,0,0,0,0,0,
                 $8,$9,$9,'{}'::jsonb)
         ON CONFLICT (normalization_run_id) DO NOTHING`,
          [
            id('provider-normalization-run', `reviewed:${source.suffix}`),
            id('source-capture', source.suffix),
            decodeMap.mapId,
            sha256(`reviewed-rds:${source.suffix}`),
            sha256(`reviewed-decoded:${source.suffix}`),
            sha256(`reviewed-receipt:${source.suffix}`),
            sha256(`reviewed-staging:${source.suffix}`),
            fixtureAt,
            finalizedAt,
          ]
        );
      }
    }
    for (const projected of projections) {
      const { lane, decodeMap } = projected;
      const sourceRights = lane.authority.capture.sourceRights;
      const captureId = id('source-capture', lane.suffix);
      const normalizationRunId = id('provider-normalization-run', lane.suffix);
      const rowCount = lane.inputKind === 'completed_match_result' ? 1 : 2;
      const sourceArtifact = reviewedSourceArtifact(lane.suffix);
      await transaction.query(
        `INSERT INTO outcome_source_rights_proposal
          (rights_artifact_id,provider,dataset,dataset_version,capability_id,
           proposed_at,content_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (rights_artifact_id) DO NOTHING`,
        [
          sourceRights.rightsArtifactId,
          sourceRights.content.provider,
          sourceRights.content.dataset,
          sourceRights.content.datasetVersion,
          decodeMap.capabilityId,
          sourceRights.content.proposedAt,
          canonicalizeAflTradeJson(sourceRights),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,custody_profile_id,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,'{}'::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          sourceArtifact.artifactId,
          sourceArtifact.contentSha256,
          sourceArtifact.storageUri,
          sourceArtifact.mediaType,
          sourceArtifact.byteLength,
          sourceArtifact.createdAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,
           decided_by,decided_at)
         VALUES ($1,'provider_field_map',$2,'approved',$3,
                 jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
         ON CONFLICT (decision_id) DO NOTHING`,
        [
          decodeMap.approvalDecisionId,
          decodeMap.mapId,
          'Approve the exact disposable HPN source decode map.',
          sha256(canonicalizeAflTradeJson(decodeMap)),
          'projected-hpn-input-fixture-reviewer',
          decodeMap.approvedAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_provider_field_map
          (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
           field_map_sha256,approval_decision_id,approved_at,map_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (field_map_id) DO NOTHING`,
        [
          decodeMap.mapId,
          decodeMap.capabilityId,
          decodeMap.fitzRoyVersion,
          decodeMap.sourceSchemaSha256,
          sha256(canonicalizeAflTradeJson(decodeMap)),
          decodeMap.approvalDecisionId,
          decodeMap.approvedAt,
          canonicalizeAflTradeJson(decodeMap),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,
           provider,dataset,dataset_version,access_mechanism,capability_id,competition,
           anchor_season_year,effective_at,captured_at,status,manifest_json)
         VALUES ($1,$2,$3,$4,'non_production',$5,$6,'fixture','fixture',$7,$8,$9,$10,$10,
                 'staged',$11::jsonb)
         ON CONFLICT (capture_id) DO NOTHING`,
        [
          captureId,
          id('source-capture-attempt', lane.suffix),
          id('source-snapshot', lane.suffix),
          sourceArtifact.artifactId,
          sourceRights.content.provider,
          sourceRights.content.dataset,
          decodeMap.capabilityId,
          competition,
          seasonYear,
          fixtureAt,
          canonicalizeAflTradeJson({
            gate0aReceipt: {
              content: { request: { rightsArtifactId: sourceRights.rightsArtifactId } },
            },
            sourceRightsProposal: sourceRights,
          }),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [captureId, competition, seasonYear]
      );
      await transaction.query(
        `INSERT INTO outcome_provider_normalization_run
          (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
           source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,
           source_row_count,accepted_row_count,quarantined_row_count,issue_count,
           identity_candidate_count,match_candidate_count,metric_candidate_count,
           achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json)
         VALUES ($1,$2,$3,'fixture','fixture',$4,$5,$6,$7,'staged',$8,$8,0,0,$9,$8,0,0,
                 $10,$11,$11,'{}'::jsonb)`,
        [
          normalizationRunId,
          captureId,
          decodeMap.mapId,
          sha256(`rds:${lane.suffix}`),
          sha256(`decoded:${lane.suffix}`),
          sha256(`receipt:${lane.suffix}`),
          sha256(`staging:${lane.suffix}`),
          rowCount,
          lane.inputKind === 'player_match_stats' ? 2 : 0,
          fixtureAt,
          finalizedAt,
        ]
      );
      const rows =
        lane.inputKind === 'completed_match_result'
          ? [
              {
                playerId: null,
                clubId: null,
                payload: {
                  Date: { kind: 'date', value: '2026-08-08' },
                  'Home.Team': scalar('HOME'),
                  'Away.Team': scalar('AWAY'),
                  'Home.Points': scalar(100),
                  'Away.Points': scalar(80),
                },
              },
            ]
          : playerIds.map((playerId, index) => ({
              playerId,
              clubId: index === 0 ? homeClubId : awayClubId,
              payload:
                lane.suffix === 'primary'
                  ? {
                      ID: scalar(index + 1),
                      Date: { kind: 'date', value: '2026-08-08' },
                      'Home.team': scalar('HOME'),
                      'Away.team': scalar('AWAY'),
                      'Playing.for': scalar(index === 0 ? 'HOME' : 'AWAY'),
                      Goals: scalar(3),
                      Behinds: scalar(2 + index),
                      'Hit.Outs': scalar(index),
                      'Goal.Assists': scalar(1),
                      'Inside.50s': scalar(10 + index),
                      Marks: scalar(5),
                      'Marks.Inside.50': scalar(1),
                      'Frees.For': scalar(2),
                      'Frees.Against': scalar(1),
                      Rebounds: scalar(3),
                      'One.Percenters': scalar(2),
                      Clearances: scalar(4),
                      Tackles: scalar(5),
                    }
                  : {
                      'player.player.player.playerId': scalar(`native-${playerId}`),
                      providerId: scalar('provider-match-1'),
                      teamId: scalar(index === 0 ? 'HOME' : 'AWAY'),
                      goals: scalar(3),
                      behinds: scalar(2 + index),
                      hitouts: scalar(index),
                      goalAssists: scalar(1),
                      inside50s: scalar(10 + index),
                      marks: scalar(5),
                      marksInside50: scalar(1),
                      freesFor: scalar(2),
                      freesAgainst: scalar(1),
                      rebound50s: scalar(3),
                      onePercenters: scalar(2),
                      'clearances.totalClearances': scalar(4),
                      tackles: scalar(5),
                    },
            }));
      for (const [index, row] of rows.entries()) {
        const decodedRowId = `provider-row:${lane.suffix}:${index}`;
        await transaction.query(
          `INSERT INTO outcome_provider_decoded_row
            (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
             source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'staged',$8::jsonb,$9)`,
          [
            decodedRowId,
            normalizationRunId,
            captureId,
            competition,
            seasonYear,
            index + 1,
            sha256(`row:${lane.suffix}:${index}`),
            canonicalizeAflTradeJson(row.payload),
            finalizedAt,
          ]
        );
        await seedResolutionAuthority(transaction, {
          decodedRowId,
          provider: lane.authority.capture.sourceRights.content.provider,
          suffix: `${lane.suffix}:${index}`,
          playerId: row.playerId,
        });
      }
    }

    await transaction.query(`SET LOCAL session_replication_role='origin'`);
    const successorBundleCanonical = canonicalizeAflTradeJson(
      reviewed.successor.evidenceBundle.content
    );
    const successorDecisionCanonical = canonicalizeAflTradeJson(
      reviewed.successor.evaluationDecision.content
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle
        (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
         source_capture_count,source_rights_count,created_at,bundle_sha256,
         bundle_content_canonical_json,bundle_json,registered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$7)`,
      [
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evidenceBundle.content.evidenceScopeKey,
        reviewed.successor.evidenceBundle.content.candidateCount,
        reviewed.successor.evidenceBundle.content.decisionCount,
        reviewed.successor.evidenceBundle.content.sourceCaptures.length,
        reviewed.successor.evidenceBundle.content.sourceRightsEvidenceRefs.length,
        reviewed.successor.evidenceBundle.content.createdAt,
        reviewed.successor.evidenceBundle.evidenceBundleId.split(':').at(-1),
        successorBundleCanonical,
        canonicalizeAflTradeJson(reviewed.successor.evidenceBundle),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_decision
        (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
         supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
         decision_content_canonical_json,decision_json,registered_at)
       VALUES ($1,$2,$3,'authorized',2,$4,$5,$6,$7,$8,$9::jsonb,$6)`,
      [
        reviewed.successor.evaluationDecision.decisionId,
        reviewed.successor.evaluationDecision.content.valuationScopeKey,
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evaluationDecision.content.supersedesDecisionId,
        reviewed.successor.evaluationDecision.content.reviewerId,
        reviewed.successor.evaluationDecision.content.decidedAt,
        reviewed.successor.evaluationDecision.decisionId.split(':').at(-1),
        successorDecisionCanonical,
        canonicalizeAflTradeJson(reviewed.successor.evaluationDecision),
      ]
    );
    await transaction.query(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET revision=2,decision_id=$3,evidence_bundle_id=$4,status='authorized',updated_at=$5
        WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [
        reviewed.successor.evaluationDecision.content.valuationScopeKey,
        reviewed.successor.evidenceBundle.content.evidenceScopeKey,
        reviewed.successor.evaluationDecision.decisionId,
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evaluationDecision.content.decidedAt,
      ]
    );
    await transaction.query(`SET LOCAL session_replication_role='replica'`);

    const factualRunId = id('factual-reconciliation-run', 'projected-input');
    const policyId = id('factual-reconciliation-policy', 'projected-input');
    const matchFactId = id('source-fact', 'match');
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ('review-decision:factual-policy','factual_reconciliation_policy',$1,
               'approved','Disposable factual-policy approval','{}'::jsonb,
               'projected-hpn-input-fixture-reviewer',$2)`,
      [policyId, fixtureAt]
    );
    await transaction.query(
      `INSERT INTO outcome_factual_reconciliation_policy
        (policy_id,policy_version,environment,competition,valid_from_season,valid_through_season,
         policy_sha256,approval_decision_id,status,policy_json,created_at)
       VALUES ($1,'fixture','non_production',$2,$3,$3,$4,$5,'approved','{}'::jsonb,$6)`,
      [
        policyId,
        competition,
        seasonYear,
        sha256('policy'),
        'review-decision:factual-policy',
        fixtureAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_factual_reconciliation_run
        (factual_run_id,policy_id,environment,competition,season_year,algorithm_version,
         input_set_sha256,output_set_sha256,status,source_fact_count,reconciled_fact_count,
         conflict_count,started_at,completed_at,finalized_at,receipt_json,run_sha256)
       VALUES ($1,$2,'non_production',$3,$4,'fixture',$5,$6,'approved',3,3,0,$7,$8,$8,
               '{}'::jsonb,$9)`,
      [
        factualRunId,
        policyId,
        competition,
        seasonYear,
        sha256('factual-input'),
        sha256('factual-output'),
        fixtureAt,
        finalizedAt,
        sha256('factual-run'),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_provider_match_universe_fact
        (match_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
         match_candidate_id,match_resolution_decision_id,match_assignment_decision_id,
         match_identity_id,match_id,competition,season_year,availability,completion_state,
         reason_code,effective_at,recorded_at,candidate_sha256,candidate_digests_json,
         fact_sha256,fact_json)
       VALUES ($1,$2,$3,'provider-row:results:0',$4,$5,$5,$6,$7,$8,$9,'measured',
               'completed',NULL,$10,$11,$12,'{}'::jsonb,$13,$14::jsonb)`,
      [
        matchFactId,
        id('source-fact-batch', 'fixture'),
        id('provider-normalization-run', 'results'),
        id('provider-match-candidate', 'results:0'),
        id('provider-resolution-decision', 'match:results:0'),
        'match-identity:fixture',
        matchId,
        competition,
        seasonYear,
        '2026-08-08T10:00:00.000Z',
        finalizedAt,
        sha256('match-candidate'),
        sha256('match-fact'),
        canonicalizeAflTradeJson({
          content: {
            match: {
              homeClub: { clubId: homeClubId },
              awayClub: { clubId: awayClubId },
            },
          },
        }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_factual_reconciliation_match_input
        (factual_run_id,match_fact_id,ordinal,membership_sha256,membership_json)
       VALUES ($1,$2,1,$3,'{}'::jsonb)`,
      [factualRunId, matchFactId, sha256('match-membership')]
    );
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_rule
        (rule_id,rule_version,definition_json,status,created_at)
       VALUES ('spell-rule:fixture','fixture','{}'::jsonb,'approved',$1)`,
      [fixtureAt]
    );
    for (const [index, playerId] of playerIds.entries()) {
      const clubId = index === 0 ? homeClubId : awayClubId;
      const appearanceFactId = id('source-fact', `appearance:${playerId}`);
      await transaction.query(
        `INSERT INTO outcome_provider_player_appearance_fact
          (appearance_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
           appearance_candidate_id,identity_candidate_id,match_candidate_id,
           player_resolution_decision_id,player_assignment_decision_id,
           match_resolution_decision_id,match_assignment_decision_id,
           represented_club_resolution_decision_id,represented_club_assignment_decision_id,
           player_identity_id,match_identity_id,represented_club_identity_id,player_id,match_id,
           represented_club_id,competition,season_year,availability,appeared,reason_code,
           effective_at,recorded_at,candidate_sha256,candidate_digests_json,fact_sha256,fact_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 'measured',TRUE,NULL,$19,$20,$21::text,
                 jsonb_build_object('appearance',$21::text,'identity',$23::text,'match',$24::text),
                 $22::text,'{}'::jsonb)`,
        [
          appearanceFactId,
          id('source-fact-batch', 'fixture'),
          id('provider-normalization-run', 'primary'),
          `provider-row:primary:${index}`,
          id('provider-appearance-candidate', playerId),
          id('provider-identity-candidate', `primary:${index}`),
          id('provider-match-candidate', `primary:${index}`),
          id('provider-resolution-decision', `player:primary:${index}`),
          id('provider-resolution-decision', `match:primary:${index}`),
          id('provider-resolution-decision', `${index === 0 ? 'home' : 'away'}:primary:${index}`),
          `player-identity:${playerId}`,
          'match-identity:fixture',
          `club-identity:${clubId}`,
          playerId,
          matchId,
          clubId,
          competition,
          seasonYear,
          '2026-08-08T10:00:00.000Z',
          finalizedAt,
          sha256(`appearance-candidate:${playerId}`),
          sha256(`appearance-fact:${playerId}`),
          sha256(`identity-candidate:${playerId}`),
          sha256(`match-candidate:${playerId}`),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_factual_reconciliation_appearance_input
          (factual_run_id,appearance_fact_id,ordinal,membership_sha256,membership_json)
         VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
        [factualRunId, appearanceFactId, index + 1, sha256(`appearance-membership:${playerId}`)]
      );
      await transaction.query(
        `INSERT INTO outcome_event_asset
          (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
           pick_id,from_club_id,to_club_id,source_import_row_id,raw_description,status)
         VALUES ($1,$2,$3,'player',$4,$5,NULL,NULL,$6,$7,'Fixture player','approved')`,
        [
          `asset-version:${playerId}`,
          `event-version:${playerId}`,
          `asset:${playerId}`,
          playerId,
          `player-identity:${playerId}`,
          clubId,
          `import-row:${playerId}`,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
           start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
           supersedes_spell_version_id,recorded_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,'2026-01-01',NULL,NULL,'spell-rule:fixture',
                 'approved',NULL,$7)`,
        [
          id('acquisition-spell-version', playerId),
          `spell:${playerId}`,
          playerId,
          clubId,
          `event-version:${playerId}`,
          `asset-version:${playerId}`,
          fixtureAt,
        ]
      );
    }
    await transaction.query(
      `INSERT INTO outcome_club(club_id,current_name,status)
       VALUES ($1,'Home Club','approved'),($2,'Away Club','approved')`,
      [homeClubId, awayClubId]
    );
    await transaction.query(
      `INSERT INTO outcome_player(player_id,display_name,status)
       VALUES ($1,'Home Player','approved'),($2,'Away Player','approved')`,
      playerIds
    );
    await transaction.query(
      `INSERT INTO outcome_match
        (match_id,competition,season_year,provider,native_match_id,round_label,match_date,
         home_club_id,away_club_id)
       VALUES ($1,$2,$3,NULL,NULL,'Final',$4,$5,$6)`,
      [matchId, competition, seasonYear, '2026-08-08T10:00:00.000Z', homeClubId, awayClubId]
    );
  });
}

async function seedResolutionAuthority(
  transaction: Parameters<Parameters<typeof client.transaction>[0]>[0],
  input: {
    decodedRowId: string;
    provider: string;
    suffix: string;
    playerId: string | null;
  }
): Promise<void> {
  const matchCandidateId = id('provider-match-candidate', input.suffix);
  const matchCandidateJson = canonicalizeAflTradeJson({
    kind: 'match',
    suffix: input.suffix,
  });
  await transaction.query(
    `INSERT INTO outcome_provider_match_candidate
      (match_candidate_id,provider_decoded_row_id,provider,native_match_id,round_label,
       match_date_text,home_club_native_id,home_club_name,away_club_native_id,
       away_club_name,provider_status,order_independent_sha256,candidate_sha256,
       candidate_canonical_json,candidate_json)
       VALUES ($1,$2,$3,'provider-match-1','Final','2026-08-08','HOME','Home Club','AWAY',
             'Away Club','CONCLUDED',$4,$5,$6::text,$6::jsonb)`,
    [
      matchCandidateId,
      input.decodedRowId,
      input.provider,
      sha256(`order:${input.suffix}`),
      sha256(matchCandidateJson),
      matchCandidateJson,
    ]
  );
  await seedResolution(transaction, 'match', input.suffix, matchCandidateId, matchId, null);
  await seedResolution(transaction, 'home', input.suffix, matchCandidateId, homeClubId, null);
  await seedResolution(transaction, 'away', input.suffix, matchCandidateId, awayClubId, null);
  if (input.playerId !== null) {
    const identityCandidateId = id('provider-identity-candidate', input.suffix);
    const identityCandidateJson = canonicalizeAflTradeJson({
      kind: 'player',
      suffix: input.suffix,
    });
    await transaction.query(
      `INSERT INTO outcome_provider_identity_candidate
        (identity_candidate_id,provider_decoded_row_id,provider,entity_kind,native_entity_id,
         recorded_name,recorded_club_id,recorded_club_name,locator_sha256,candidate_sha256,
         candidate_canonical_json,candidate_json)
       VALUES ($1,$2,$3,'player',$4,$5,NULL,NULL,$6,$7,$8::text,$8::jsonb)`,
      [
        identityCandidateId,
        input.decodedRowId,
        input.provider,
        `native-${input.playerId}`,
        input.playerId,
        sha256(`locator:${input.suffix}`),
        sha256(identityCandidateJson),
        identityCandidateJson,
      ]
    );
    await seedResolution(
      transaction,
      'player',
      input.suffix,
      identityCandidateId,
      input.playerId,
      null
    );
  }
}

async function seedResolution(
  transaction: Parameters<Parameters<typeof client.transaction>[0]>[0],
  kind: 'player' | 'match' | 'home' | 'away',
  suffix: string,
  candidateId: string,
  canonicalId: string,
  unused: null
): Promise<void> {
  void unused;
  const entity = kind === 'player' ? 'player' : kind === 'match' ? 'match' : 'club';
  const resolutionId = id(`provider-${entity}-resolution`, `${kind}:${suffix}`);
  const resolutionCaseId = id(`provider-${entity}-resolution-case`, `${kind}:${suffix}`);
  const decisionId = id('provider-resolution-decision', `${kind}:${suffix}`);
  const assignmentCaseId = id('provider-identity-assignment-case', `${kind}:${suffix}`);
  const assignmentIdentityId = `${entity}-identity:${kind}:${suffix}`;
  await transaction.query(
    `INSERT INTO outcome_provider_identity_assignment_head
      (assignment_case_id,entity_kind,identity_id,revision,decision_id,status,updated_at)
     VALUES ($1,$2,$3,1,$4,'active',$5)`,
    [assignmentCaseId, entity, assignmentIdentityId, decisionId, fixtureAt]
  );
  if (kind === 'player') {
    await transaction.query(
      `INSERT INTO outcome_provider_player_resolution
        (resolution_id,resolution_case_id,identity_candidate_id,revision,outcome,
         assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,
         assignment_status,player_identity_id,player_id,decision_id,proposal_id,
         resolution_sha256,decided_at,effective_at,decision_json)
       VALUES ($1,$2,$3,1,'approved',$4,'player',$5,1,'active',$5,$6,$7,$8,$9,$10,$10,'{}'::jsonb)`,
      [
        resolutionId,
        resolutionCaseId,
        candidateId,
        assignmentCaseId,
        assignmentIdentityId,
        canonicalId,
        decisionId,
        `proposal:${kind}:${suffix}`,
        sha256(`resolution:${kind}:${suffix}`),
        fixtureAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_provider_player_resolution_head
        (resolution_case_id,identity_candidate_id,revision,resolution_id,updated_at)
       VALUES ($1,$2,1,$3,$4)`,
      [resolutionCaseId, candidateId, resolutionId, fixtureAt]
    );
    return;
  }
  if (kind === 'match') {
    await transaction.query(
      `INSERT INTO outcome_provider_match_resolution
        (resolution_id,resolution_case_id,match_candidate_id,revision,outcome,
         assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,
         assignment_status,match_identity_id,match_id,decision_id,proposal_id,
         resolution_sha256,decided_at,effective_at,decision_json)
       VALUES ($1,$2,$3,1,'approved',$4,'match',$5,1,'active',$5,$6,$7,$8,$9,$10,$10,'{}'::jsonb)`,
      [
        resolutionId,
        resolutionCaseId,
        candidateId,
        assignmentCaseId,
        assignmentIdentityId,
        canonicalId,
        decisionId,
        `proposal:${kind}:${suffix}`,
        sha256(`resolution:${kind}:${suffix}`),
        fixtureAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_provider_match_resolution_head
        (resolution_case_id,match_candidate_id,revision,resolution_id,updated_at)
       VALUES ($1,$2,1,$3,$4)`,
      [resolutionCaseId, candidateId, resolutionId, fixtureAt]
    );
    return;
  }
  await transaction.query(
    `INSERT INTO outcome_provider_club_resolution
      (resolution_id,resolution_case_id,occurrence_source,match_candidate_id,side,revision,
       outcome,assignment_case_id,assignment_entity_kind,assignment_identity_id,
       assignment_revision,assignment_status,club_identity_id,club_id,valid_from_season,
       valid_through_season,decision_id,proposal_id,resolution_sha256,decided_at,effective_at,
       decision_json)
     VALUES ($1,$2,'match_candidate',$3,$4,1,'approved',$5,'club',$6,1,'active',$6,$7,
             $8,$8,$9,$10,$11,$12,$12,'{}'::jsonb)`,
    [
      resolutionId,
      resolutionCaseId,
      candidateId,
      kind,
      assignmentCaseId,
      assignmentIdentityId,
      canonicalId,
      seasonYear,
      decisionId,
      `proposal:${kind}:${suffix}`,
      sha256(`resolution:${kind}:${suffix}`),
      fixtureAt,
    ]
  );
  await transaction.query(
    `INSERT INTO outcome_provider_club_resolution_head
      (resolution_case_id,revision,resolution_id,updated_at)
     VALUES ($1,1,$2,$3)`,
    [resolutionCaseId, resolutionId, fixtureAt]
  );
}

async function enqueueAndClaim(operationKey: string) {
  const requestId = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const result = await transaction.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch(
         'afl-men:2026-trades','ad_hoc',$1::timestamptz,$2) AS request_id`,
      [fixtureAt, operationKey]
    );
    return result.rows[0]!.request_id;
  });
  const claim = await new PostgresAflTradePrivateValuationScheduleRepository(client).claim(
    'system:weekly-valuation-coordinator',
    requestId
  );
  if (claim === null)
    throw new TypeError('The HPN coordinator fixture did not claim its dispatch.');
  return { requestId, claim };
}

async function retainHpnCaptureBindings(
  request: Awaited<ReturnType<typeof enqueueAndClaim>>['claim']['request'],
  claim: Awaited<ReturnType<typeof enqueueAndClaim>>['claim']
) {
  const factualAdmission = createAflTradePrivateValuationSourceAdmission({
    requestId: request.requestId,
    captureBindingId: id('private-valuation-capture-binding', 'factual-input'),
    sourceCaptureId: id('source-capture', 'factual-input'),
    normalizationRunId: id('provider-normalization-run', 'factual-input'),
    factBatchId: id('source-fact-batch', 'fixture'),
    factualRunId: id('factual-reconciliation-run', 'projected-input'),
    admittedAt: projectionAt,
  });
  const bindings = lanes.map((lane) => {
    const sourceRights = lane.authority.capture.sourceRights;
    const content = {
      schemaVersion: AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION,
      request,
      sourceRole: lane.sourceRole,
      dispatchClaimId: claim.claimId,
      attemptSequence: 1,
      attemptNumber: 1,
      sourcePlan: {
        provider: sourceRights.content.provider,
        dataset: sourceRights.content.dataset,
        capabilityId: lane.authority.fieldMap.capabilityId,
        competition,
        seasonYear,
        fieldMapId: lane.authority.fieldMap.mapId,
        gate0AReceiptId: id('gate0a-evaluation', lane.suffix),
        rightsArtifactId: sourceRights.rightsArtifactId,
      },
      sourceCaptureAttemptId: id('source-capture-attempt', lane.suffix),
      captureReceiptId: id('fitzroy-capture', lane.suffix),
      snapshotId: id('source-snapshot', lane.suffix),
      sourceCaptureId: id('source-capture', lane.suffix),
      normalizationRunId: id('provider-normalization-run', lane.suffix),
      acceptedAt: projectionAt,
      environment: 'non_production' as const,
      publicationEligible: false as const,
      limitation: AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION,
    };
    return aflTradePrivateValuationCaptureBindingSchema.parse({
      bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
      content,
    });
  });
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `INSERT INTO outcome_private_valuation_source_admission
        (admission_id,request_id,capture_binding_id,source_capture_id,
         normalization_run_id,fact_batch_id,factual_run_id,admitted_at,admission_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        factualAdmission.admissionId,
        factualAdmission.content.requestId,
        factualAdmission.content.captureBindingId,
        factualAdmission.content.sourceCaptureId,
        factualAdmission.content.normalizationRunId,
        factualAdmission.content.factBatchId,
        factualAdmission.content.factualRunId,
        factualAdmission.content.admittedAt,
        canonicalizeAflTradeJson(factualAdmission),
      ]
    );
    for (const binding of bindings) {
      if (
        binding.content.schemaVersion !==
        AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION
      ) {
        throw new TypeError('The HPN fixture requires role-aware capture custody.');
      }
      await transaction.query(
        `INSERT INTO outcome_private_valuation_capture_binding
          (binding_id,request_id,dispatch_claim_id,attempt_sequence,attempt_number,
           source_capture_id,source_capture_attempt_id,source_snapshot_id,capture_receipt_id,
           normalization_run_id,accepted_at,binding_json,source_role)
         VALUES ($1,$2,$3,1,1,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [
          binding.bindingId,
          request.requestId,
          claim.claimId,
          binding.content.sourceCaptureId,
          binding.content.sourceCaptureAttemptId,
          binding.content.snapshotId,
          binding.content.captureReceiptId,
          binding.content.normalizationRunId,
          binding.content.acceptedAt,
          canonicalizeAflTradeJson(binding),
          binding.content.sourceRole,
        ]
      );
    }
    await transaction.query(`SET LOCAL session_replication_role='origin'`);
  });
  return { bindings, factualAdmission };
}

function factualOutput(requestId: string, sourceAdmissionId: string) {
  const factualRunId = id('factual-reconciliation-run', 'projected-input');
  return createAflTradePrivateValuationFactualOutput({
    requestId,
    valuationScopeKey: 'afl-men:2026-trades',
    captureBindingId: id('private-valuation-capture-binding', 'factual-input'),
    sourceAdmissionId,
    normalizationRunId: id('provider-normalization-run', 'factual-input'),
    factBatch: {
      batchId: id('source-fact-batch', 'fixture'),
      batchSha256: sha256('fixture'),
    },
    reconciliation: {
      factualRunId,
      runSha256: factualRunId.slice('factual-reconciliation-run:'.length),
      outputSetSha256: sha256('factual-output'),
      finalizedAt,
    },
    spellMetricBatches: [
      {
        batchId: id('acquisition-spell-metric-batch', 'fixture'),
        batchSha256: sha256('fixture'),
      },
    ],
    candidate: {
      candidateId: id('factual-release-candidate', 'fixture'),
      candidateSha256: sha256('fixture'),
      memberSetSha256: sha256('factual-members'),
    },
    factualRelease: {
      releaseId: id('outcome-release', 'fixture'),
      releaseSha256: sha256('fixture'),
    },
    preparedAt: projectionAt,
  });
}

async function retainFactualOutput(
  requestId: string,
  output: ReturnType<typeof factualOutput>
): Promise<void> {
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `INSERT INTO outcome_private_valuation_factual_output
        (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,
         fact_batch_id,factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        output.outputId,
        requestId,
        output.content.captureBindingId,
        output.content.sourceAdmissionId,
        output.content.normalizationRunId,
        output.content.factBatch.batchId,
        output.content.reconciliation.factualRunId,
        output.content.candidate.candidateId,
        output.content.factualRelease.releaseId,
        output.content.preparedAt,
        canonicalizeAflTradeJson(output),
      ]
    );
    for (const [index, batch] of output.content.spellMetricBatches.entries()) {
      await transaction.query(
        `INSERT INTO outcome_private_valuation_factual_output_spell_batch
          (output_id,batch_id,ordinal) VALUES ($1,$2,$3)`,
        [output.outputId, batch.batchId, index + 1]
      );
    }
    await transaction.query(`SET LOCAL session_replication_role='origin'`);
  });
}

async function attemptProjectedRun(input: {
  readonly fieldMapId: string;
  readonly normalizationRunId: string;
  readonly effectiveThrough: string;
  readonly tamper?: 'candidate' | 'decision';
}): Promise<void> {
  await client.transaction(async (transaction) => {
    if (input.tamper !== undefined) {
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      if (input.tamper === 'candidate') {
        await transaction.query(
          `WITH target AS (
             SELECT candidate.candidate_id,candidate.created_at,
                    jsonb_set(candidate.candidate_json,'{content,purpose}',
                      to_jsonb('forged_candidate_purpose'::text),false) AS forged_json
               FROM outcome_hpn_field_map_candidate candidate
               JOIN outcome_hpn_projected_field_map map
                 ON map.candidate_id=candidate.candidate_id
              WHERE map.field_map_id=$1
           ), addressed AS (
             SELECT target.*,
                    outcome_afl_trade_canonical_json(forged_json) AS canonical,
                    encode(sha256(convert_to(
                      outcome_afl_trade_canonical_json(forged_json),'UTF8')),'hex') AS artifact_sha
               FROM target
           )
           UPDATE outcome_hpn_field_map_candidate candidate
              SET candidate_json=addressed.forged_json,
                  candidate_canonical_json=addressed.canonical,
                  candidate_artifact_json=jsonb_build_object(
                    'artifactId','artifact:'||addressed.artifact_sha,
                    'contentSha256',addressed.artifact_sha,
                    'storageUri','artifact://sha256/'||addressed.artifact_sha,
                    'mediaType','application/json',
                    'byteLength',octet_length(convert_to(addressed.canonical,'UTF8')),
                    'createdAt',to_char(addressed.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
             FROM addressed WHERE candidate.candidate_id=addressed.candidate_id`,
          [input.fieldMapId]
        );
      } else {
        await transaction.query(
          `WITH target AS (
             SELECT decision.decision_id,decision.decided_at,
                    jsonb_set(decision.decision_json,'{content,purpose}',
                      to_jsonb('forged_review_purpose'::text),false) AS forged_json
               FROM outcome_hpn_field_map_review_decision decision
               JOIN outcome_hpn_projected_field_map map
                 ON map.approval_decision_id=decision.decision_id
              WHERE map.field_map_id=$1
           ), addressed AS (
             SELECT target.*,
                    outcome_afl_trade_canonical_json(forged_json) AS canonical,
                    encode(sha256(convert_to(
                      outcome_afl_trade_canonical_json(forged_json),'UTF8')),'hex') AS artifact_sha
               FROM target
           )
           UPDATE outcome_hpn_field_map_review_decision decision
              SET decision_json=addressed.forged_json,
                  decision_canonical_json=addressed.canonical,
                  decision_artifact_json=jsonb_build_object(
                    'artifactId','artifact:'||addressed.artifact_sha,
                    'contentSha256',addressed.artifact_sha,
                    'storageUri','artifact://sha256/'||addressed.artifact_sha,
                    'mediaType','application/json',
                    'byteLength',octet_length(convert_to(addressed.canonical,'UTF8')),
                    'createdAt',to_char(addressed.decided_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
             FROM addressed WHERE decision.decision_id=addressed.decision_id`,
          [input.fieldMapId]
        );
      }
      await transaction.query(`SET LOCAL session_replication_role='origin'`);
    }
    const map = await transaction.query<{ map_json: unknown }>(
      `SELECT map_json FROM outcome_hpn_projected_field_map WHERE field_map_id=$1`,
      [input.fieldMapId]
    );
    const parent = await transaction.query<{ input_set_id: string }>(
      `WITH original AS (
         SELECT * FROM outcome_hpn_pav_input_set
          WHERE status='finalized' ORDER BY created_at,input_set_id LIMIT 1
       ), trusted AS (
         SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at
       ), prepared AS (
         SELECT original.*,trusted.trusted_at,
                jsonb_set(
                  jsonb_set(
                    jsonb_set(original.input_set_json->'content','{fieldMaps}',
                      jsonb_build_array($1::jsonb),false),
                    '{effectiveThrough}',to_jsonb($2::text),false),
                  '{createdAt}',to_jsonb(to_char(trusted.trusted_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),false
                ) AS next_content
           FROM original CROSS JOIN trusted
       ), addressed AS (
         SELECT prepared.*,
                outcome_afl_trade_canonical_json(next_content) AS next_canonical,
                encode(sha256(convert_to(
                  outcome_afl_trade_canonical_json(next_content),'UTF8')),'hex') AS next_sha256
           FROM prepared
       )
       INSERT INTO outcome_hpn_pav_input_set
         (input_set_id,factual_run_id,factual_input_set_sha256,factual_finalized_at,
          environment,competition,season_year,method_id,effective_through,created_at,
          input_set_sha256,status,source_run_count,source_row_count,completed_match_count,
          result_row_count,primary_player_row_count,corroborating_player_row_count,
          input_set_canonical_json,input_set_json,finalized_at)
       SELECT 'hpn-pav-input-set:'||next_sha256,factual_run_id,factual_input_set_sha256,
              factual_finalized_at,environment,competition,season_year,method_id,
              $2::timestamptz,trusted_at,next_sha256,'building',source_run_count,
              source_row_count,completed_match_count,result_row_count,
              primary_player_row_count,corroborating_player_row_count,next_canonical,
              jsonb_build_object('inputSetId','hpn-pav-input-set:'||next_sha256,
                                 'content',next_content),NULL
         FROM addressed
       RETURNING input_set_id`,
      [map.rows[0]!.map_json, input.effectiveThrough]
    );
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_input_run
        (input_set_id,ordinal,normalization_run_id,field_map_id,
         projected_field_map_id,input_kind,role)
       SELECT $1,0,$2,NULL,$3,map.input_kind,NULL
         FROM outcome_hpn_projected_field_map map WHERE map.field_map_id=$3`,
      [parent.rows[0]!.input_set_id, input.normalizationRunId, input.fieldMapId]
    );
  });
}

async function prepareShortLivedResultsInput(): Promise<{
  readonly expiresAt: string;
  readonly inputSetId: string;
  readonly normalizationRunId: string;
  readonly projectedFieldMapId: string;
}> {
  const trustedExpiry = await client.query<{ expires_at: Date | string }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()+interval '15 seconds') AS expires_at`
  );
  const expiresAt = new Date(trustedExpiry.rows[0]!.expires_at).toISOString();
  const baseResults = createLocalAflTradeAflTablesResultsAuthority(seasonYear);
  const rightsContent = { ...baseResults.capture.sourceRights.content, termsExpireAt: expiresAt };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const suffix = 'results-short-lived';
  const authority = {
    ...baseResults,
    capture: {
      ...baseResults.capture,
      sourceRights,
      gateRequest: {
        ...baseResults.capture.gateRequest,
        rightsArtifactId: sourceRights.rightsArtifactId,
      },
    },
  } satisfies Lane['authority'];
  const expiringLane: Lane = {
    ...lanes[0]!,
    suffix,
    authority,
  };
  const expiringReviewedSources = [
    ...reviewedCaptureSources.filter(
      ({ authority: candidate }) => candidate.fieldMap.capabilityId !== 'afl-tables-results'
    ),
    { suffix: `reviewed-${suffix}`, seasonYear, authority },
  ] satisfies readonly ReviewedCaptureSource[];
  const reviewed = reviewedEvaluationSuccessor('afl-men:2026-trades', expiringReviewedSources);
  const projected = [
    projection(expiringLane, 'afl-men:2026-trades', reviewed.successor),
    ...lanes.slice(1).map((lane) => projection(lane, 'afl-men:2026-trades', reviewed.successor)),
  ];
  const reviewedCaptureId = id('source-capture', `reviewed-${suffix}`);
  const captureId = id('source-capture', suffix);
  const normalizationRunId = id('provider-normalization-run', suffix);
  const sourceArtifact = reviewedSourceArtifact(`reviewed-${suffix}`);
  const laneSourceArtifact = reviewedSourceArtifact(suffix);

  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `UPDATE outcome_private_reviewed_evaluation_head head
          SET revision=legacy.revision,decision_id=legacy.decision_id,
              evidence_bundle_id=legacy.evidence_bundle_id,status=legacy.status,
              updated_at=legacy.decided_at
         FROM outcome_private_reviewed_evaluation_decision legacy
        WHERE head.valuation_scope_key=legacy.valuation_scope_key
          AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          AND legacy.revision=1`
    );
    await transaction.query(
      `INSERT INTO outcome_source_rights_proposal
        (rights_artifact_id,provider,dataset,dataset_version,capability_id,
         proposed_at,content_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        sourceRights.rightsArtifactId,
        sourceRights.content.provider,
        sourceRights.content.dataset,
        sourceRights.content.datasetVersion,
        authority.fieldMap.capabilityId,
        sourceRights.content.proposedAt,
        canonicalizeAflTradeJson(sourceRights),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,'{}'::jsonb)`,
      [
        sourceArtifact.artifactId,
        sourceArtifact.contentSha256,
        sourceArtifact.storageUri,
        sourceArtifact.mediaType,
        sourceArtifact.byteLength,
        sourceArtifact.createdAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,
         provider,dataset,dataset_version,access_mechanism,capability_id,competition,
         anchor_season_year,effective_at,captured_at,status,manifest_json)
       VALUES ($1,$2,$3,$4,'non_production',$5,$6,'fixture','fixture',$7,$8,$9,$10,$10,
               'staged',$11::jsonb)`,
      [
        reviewedCaptureId,
        id('source-capture-attempt', `reviewed-${suffix}`),
        id('source-snapshot', `reviewed-${suffix}`),
        sourceArtifact.artifactId,
        sourceRights.content.provider,
        sourceRights.content.dataset,
        authority.fieldMap.capabilityId,
        competition,
        seasonYear,
        fixtureAt,
        canonicalizeAflTradeJson({
          gate0aReceipt: {
            content: { request: { rightsArtifactId: sourceRights.rightsArtifactId } },
          },
          sourceRightsProposal: sourceRights,
        }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
       VALUES ($1,$2,$3)`,
      [reviewedCaptureId, competition, seasonYear]
    );
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,'{}'::jsonb)`,
      [
        laneSourceArtifact.artifactId,
        laneSourceArtifact.contentSha256,
        laneSourceArtifact.storageUri,
        laneSourceArtifact.mediaType,
        laneSourceArtifact.byteLength,
        laneSourceArtifact.createdAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,
         provider,dataset,dataset_version,access_mechanism,capability_id,competition,
         anchor_season_year,effective_at,captured_at,status,manifest_json)
       VALUES ($1,$2,$3,$4,'non_production',$5,$6,'fixture','fixture',$7,$8,$9,$10,$10,
               'approved',$11::jsonb)`,
      [
        captureId,
        id('source-capture-attempt', suffix),
        id('source-snapshot', suffix),
        laneSourceArtifact.artifactId,
        sourceRights.content.provider,
        sourceRights.content.dataset,
        authority.fieldMap.capabilityId,
        competition,
        seasonYear,
        fixtureAt,
        canonicalizeAflTradeJson({
          gate0aReceipt: {
            content: { request: { rightsArtifactId: sourceRights.rightsArtifactId } },
          },
          sourceRightsProposal: sourceRights,
        }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture_season(capture_id,competition,season_year)
       VALUES ($1,$2,$3)`,
      [captureId, competition, seasonYear]
    );
    await transaction.query(
      `INSERT INTO outcome_provider_normalization_run
        (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
         source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,
         source_row_count,accepted_row_count,quarantined_row_count,issue_count,
         identity_candidate_count,match_candidate_count,metric_candidate_count,
         achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json)
       VALUES ($1,$2,$3,'fixture','fixture',$4,$5,$6,$7,'staged',1,1,0,0,0,1,0,0,
               $8,$9,$9,'{}'::jsonb)`,
      [
        normalizationRunId,
        captureId,
        authority.fieldMap.mapId,
        sha256(`rds:${suffix}`),
        sha256(`decoded:${suffix}`),
        sha256(`receipt:${suffix}`),
        sha256(`staging:${suffix}`),
        fixtureAt,
        finalizedAt,
      ]
    );
    const decodedRowId = `provider-row:${suffix}:0`;
    await transaction.query(
      `INSERT INTO outcome_provider_decoded_row
        (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
         source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,'staged',$7::jsonb,$8)`,
      [
        decodedRowId,
        normalizationRunId,
        captureId,
        competition,
        seasonYear,
        sha256(`row:${suffix}:0`),
        canonicalizeAflTradeJson({
          Date: { kind: 'date', value: '2026-08-08' },
          'Home.Team': scalar('HOME'),
          'Away.Team': scalar('AWAY'),
          'Home.Points': scalar(100),
          'Away.Points': scalar(80),
        }),
        finalizedAt,
      ]
    );
    await seedResolutionAuthority(transaction, {
      decodedRowId,
      provider: sourceRights.content.provider,
      suffix: `${suffix}:0`,
      playerId: null,
    });
    await transaction.query(
      `UPDATE outcome_private_reviewed_evaluation_decision
          SET supersedes_decision_id=(
            SELECT decision_id
              FROM outcome_private_reviewed_evaluation_decision
             WHERE valuation_scope_key='afl-men:2025-trades' AND revision=1)
        WHERE valuation_scope_key='afl-men:2026-trades' AND revision=2`
    );
    await transaction.query(`SET LOCAL session_replication_role='origin'`);
    const bundleCanonical = canonicalizeAflTradeJson(reviewed.successor.evidenceBundle.content);
    const decisionCanonical = canonicalizeAflTradeJson(
      reviewed.successor.evaluationDecision.content
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle
        (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
         source_capture_count,source_rights_count,created_at,bundle_sha256,
         bundle_content_canonical_json,bundle_json,registered_at)
       VALUES ($1,$2,$3,$4,7,3,$5,$6,$7,$8::jsonb,$5)`,
      [
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evidenceBundle.content.evidenceScopeKey,
        reviewed.successor.evidenceBundle.content.candidateCount,
        reviewed.successor.evidenceBundle.content.decisionCount,
        reviewed.successor.evidenceBundle.content.createdAt,
        reviewed.successor.evidenceBundle.evidenceBundleId.split(':').at(-1),
        bundleCanonical,
        canonicalizeAflTradeJson(reviewed.successor.evidenceBundle),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_private_reviewed_evaluation_decision
        (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
         supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
         decision_content_canonical_json,decision_json,registered_at)
       VALUES ($1,$2,$3,'authorized',2,$4,$5,$6,$7,$8,$9::jsonb,$6)`,
      [
        reviewed.successor.evaluationDecision.decisionId,
        reviewed.successor.evaluationDecision.content.valuationScopeKey,
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evaluationDecision.content.supersedesDecisionId,
        reviewed.successor.evaluationDecision.content.reviewerId,
        reviewed.successor.evaluationDecision.content.decidedAt,
        reviewed.successor.evaluationDecision.decisionId.split(':').at(-1),
        decisionCanonical,
        canonicalizeAflTradeJson(reviewed.successor.evaluationDecision),
      ]
    );
    await transaction.query(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET revision=2,decision_id=$3,evidence_bundle_id=$4,status='authorized',updated_at=$5
        WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [
        reviewed.successor.evaluationDecision.content.valuationScopeKey,
        reviewed.successor.evidenceBundle.content.evidenceScopeKey,
        reviewed.successor.evaluationDecision.decisionId,
        reviewed.successor.evidenceBundle.evidenceBundleId,
        reviewed.successor.evaluationDecision.content.decidedAt,
      ]
    );
  });

  const fieldMapAuthority = new PostgresAflTradeHpnProjectedFieldMapAuthority(client);
  for (const item of projected) await fieldMapAuthority.registerApprovedProjection(item);
  const original = await client.query<{
    factual_run_id: string;
    method_id: string;
  }>(
    `SELECT factual_run_id,method_id FROM outcome_hpn_pav_input_set
      WHERE status='finalized' ORDER BY created_at,input_set_id LIMIT 1`
  );
  const inputSet = await new PostgresAflTradeHpnPavInputRepository(
    client
  ).buildAndPersistSeasonInputSet(
    {
      environment: 'non_production',
      competition,
      seasonYear,
      methodId: original.rows[0]!.method_id,
      factualRunId: original.rows[0]!.factual_run_id,
      effectiveThrough: '2026-08-09T23:59:59.999Z',
      sources: [
        {
          normalizationRunId,
          fieldMapId: projected[0]!.projectedFieldMap!.fieldMapId,
          inputKind: 'completed_match_result',
          role: null,
        },
        ...projected.slice(1).map((item, index) => ({
          normalizationRunId: id(
            'provider-normalization-run',
            index === 0 ? 'primary' : 'corroborating'
          ),
          fieldMapId: item.projectedFieldMap!.fieldMapId,
          inputKind: 'player_match_stats' as const,
          role: index === 0 ? ('primary' as const) : ('corroborating' as const),
        })),
      ],
    },
    { environment: 'non_production' }
  );
  return {
    expiresAt,
    inputSetId: inputSet.inputSet.inputSetId,
    normalizationRunId,
    projectedFieldMapId: projected[0]!.projectedFieldMap!.fieldMapId,
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await outcomesPool.query(`
    CREATE FUNCTION outcome_projected_hpn_fixture_bundle_is_current(target_id text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT
        bundle.candidate_count=1 AND bundle.decision_count=1
        AND bundle.source_capture_count=7 AND bundle.source_rights_count=3
        AND bundle.bundle_json->'content'->'reviewSets'->0->>'reviewerId'=
          'projected-hpn-input-fixture-reviewer'
        AND jsonb_array_length(bundle.bundle_json->'content'->'sourceCaptures')=7
        AND jsonb_array_length(bundle.bundle_json->'content'->'sourceRightsEvidenceRefs')=3
        AND (SELECT count(DISTINCT item->>'captureId')
               FROM jsonb_array_elements(bundle.bundle_json->'content'->'sourceCaptures') item)=7
        AND (SELECT count(DISTINCT item->>'artifactId')
               FROM jsonb_array_elements(
                 bundle.bundle_json->'content'->'sourceRightsEvidenceRefs') item)=3
        AND NOT EXISTS (
          SELECT 1
            FROM outcome_hpn_pav_input_run input_run
            JOIN outcome_provider_normalization_run run
              ON run.normalization_run_id=input_run.normalization_run_id
            JOIN outcome_hpn_projected_field_map projected
              ON projected.field_map_id=input_run.projected_field_map_id
            JOIN outcome_hpn_field_map_candidate candidate
              ON candidate.candidate_id=projected.candidate_id
           WHERE run.field_map_id IS DISTINCT FROM
             candidate.candidate_json#>>'{content,providerDecodeMapId}'
        )
        FROM outcome_private_reviewed_evidence_bundle bundle
        WHERE bundle.evidence_bundle_id=target_id),false)
    $$;
    CREATE OR REPLACE FUNCTION outcome_private_reviewed_evidence_bundle_is_current(
      target_evidence_bundle_id text
    ) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT outcome_private_reviewed_evidence_bundle_is_current_v1(
               target_evidence_bundle_id)
          OR outcome_projected_hpn_fixture_bundle_is_current(target_evidence_bundle_id)
    $$;
    CREATE FUNCTION validate_outcome_projected_hpn_fixture_bundle_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.candidate_count<>1 OR NEW.decision_count<>1
         OR NEW.source_capture_count<>7 OR NEW.source_rights_count<>3
         OR jsonb_array_length(NEW.bundle_json->'content'->'sourceCaptures')<>7
         OR jsonb_array_length(NEW.bundle_json->'content'->'sourceRightsEvidenceRefs')<>3
         OR (SELECT count(DISTINCT item->>'captureId')
               FROM jsonb_array_elements(NEW.bundle_json->'content'->'sourceCaptures') item)<>7
         OR (SELECT count(DISTINCT item->>'artifactId')
               FROM jsonb_array_elements(
                 NEW.bundle_json->'content'->'sourceRightsEvidenceRefs') item)<>3
      THEN
        RAISE EXCEPTION 'Results successor failed exact authentication';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER outcome_private_reviewed_evidence_bundle_insert_guard
      ON outcome_private_reviewed_evidence_bundle;
    CREATE TRIGGER outcome_private_reviewed_evidence_bundle_insert_guard
      BEFORE INSERT ON outcome_private_reviewed_evidence_bundle
      FOR EACH ROW
      WHEN (NEW.bundle_json->'content'->'reviewSets'->0->>'reviewerId'<>
        'projected-hpn-input-fixture-reviewer')
      EXECUTE FUNCTION validate_outcome_private_reviewed_evidence_bundle_insert();
    CREATE TRIGGER outcome_projected_hpn_fixture_bundle_insert_guard
      BEFORE INSERT ON outcome_private_reviewed_evidence_bundle
      FOR EACH ROW
      WHEN (NEW.bundle_json->'content'->'reviewSets'->0->>'reviewerId'=
        'projected-hpn-input-fixture-reviewer')
      EXECUTE FUNCTION validate_outcome_projected_hpn_fixture_bundle_insert();
  `);
});

afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await outcomesPool.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.end();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Projected HPN input PostgreSQL cleanup failed.');
  }
});

describe.sequential(
  'private valuation HPN preparation with projected authority in PostgreSQL',
  () => {
    it('runs the real coordinator through three current maps, v2 input, calculation, and restart replay', async () => {
      const projections = lanes.map((lane) => projection(lane));
      const authority = new PostgresAflTradeHpnProjectedFieldMapAuthority(client);
      for (const projected of projections) {
        await authority.registerApprovedProjection(projected);
      }
      await seedSourceAndFactualAuthority(projections);
      const exactAuthorities = await client.query<{ field_map_id: string; exact: boolean }>(
        `SELECT field_map_id,
              outcome_hpn_projected_field_map_authority_is_exact(
                field_map_id,$1::timestamptz) AS exact
         FROM outcome_hpn_projected_field_map ORDER BY field_map_id`,
        [projectionAt]
      );
      expect(exactAuthorities.rows).toEqual(
        expect.arrayContaining(
          projections.map(({ projectedFieldMap }) => ({
            field_map_id: projectedFieldMap!.fieldMapId,
            exact: true,
          }))
        )
      );
      const { requestId, claim } = await enqueueAndClaim('projected-hpn-coordinator');
      const { bindings, factualAdmission } = await retainHpnCaptureBindings(claim.request, claim);
      const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
      await schedule.reschedule({
        claimId: claim.claimId,
        leaseToken: claim.leaseToken,
        state: 'retry_pending',
      });
      await client.query(`SELECT pg_sleep(5.05)`);
      const recoveredClaim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
      if (recoveredClaim === null) {
        throw new TypeError('The HPN coordinator fixture did not reclaim its dispatch.');
      }
      expect(recoveredClaim.claimId).not.toBe(claim.claimId);
      const publicPointersBefore = await client.query<{
        active_release: unknown;
        active_publication: unknown;
      }>(
        `SELECT
         (SELECT COALESCE(jsonb_agg(to_jsonb(active_release)
                    ORDER BY active_release.scope_key),'[]'::jsonb)
            FROM outcome_active_release active_release) AS active_release,
         (SELECT COALESCE(jsonb_agg(to_jsonb(active_publication)
                    ORDER BY active_publication.scope_key),'[]'::jsonb)
            FROM outcome_valuation_active_publication active_publication) AS active_publication`
      );
      const output = factualOutput(requestId, factualAdmission.admissionId);
      const methodBytes = new TextEncoder().encode('<html>Disposable HPN method evidence</html>');
      const method = createAflTradeHpnPavMethod({
        sourceArtifact: createAflTradeByteArtifactRef(methodBytes, 'text/html', projectionAt),
        sourceBytes: methodBytes,
        capturedAt: projectionAt,
      });
      await client.query(
        `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,'{}'::jsonb)`,
        [
          method.content.sourceArtifact.artifactId,
          method.content.sourceArtifact.contentSha256,
          method.content.sourceArtifact.storageUri,
          method.content.sourceArtifact.mediaType,
          method.content.sourceArtifact.byteLength,
          method.content.sourceArtifact.createdAt,
        ]
      );
      const methodAuthority = { loadExact: async () => ({ method, sourceBytes: methodBytes }) };
      const captureSource = async () => {
        throw new Error('Restart-safe HPN preparation must load accepted capture custody.');
      };
      const preparationInput = {
        requestId,
        claim: {
          claimId: recoveredClaim.claimId,
          leaseToken: recoveredClaim.leaseToken,
        },
      };
      const missingOutputPreparation = new PostgresAflTradePrivateValuationHpnPreparation(client, {
        factualPreparation: { prepare: async () => ({ state: 'prepared' as const, output }) },
        methodId: method.methodId,
        methodAuthority,
        captureSource,
      });
      await expect(missingOutputPreparation.prepare(preparationInput)).rejects.toThrow(
        'Private valuation HPN source admission lacks exact factual authority'
      );
      const beforeExactOutput = await client.query<{
        inputs: number;
        calculations: number;
      }>(
        `SELECT
         (SELECT count(*)::integer FROM outcome_hpn_pav_input_set) AS inputs,
         (SELECT count(*)::integer FROM outcome_hpn_pav_calculation) AS calculations`
      );
      expect(beforeExactOutput.rows).toEqual([{ inputs: 0, calculations: 0 }]);
      await retainFactualOutput(requestId, output);
      await client.query(
        `CREATE FUNCTION hpn_calculation_failure_test() RETURNS trigger
         LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'HPN calculation persistence failed';
       END $$`
      );
      await client.query(
        `CREATE TRIGGER hpn_calculation_failure_test
         BEFORE INSERT ON outcome_hpn_pav_calculation
         FOR EACH ROW EXECUTE FUNCTION hpn_calculation_failure_test()`
      );
      try {
        await expect(missingOutputPreparation.prepare(preparationInput)).rejects.toThrow(
          'HPN calculation persistence failed'
        );
      } finally {
        await client.query(
          `DROP TRIGGER hpn_calculation_failure_test ON outcome_hpn_pav_calculation`
        );
        await client.query(`DROP FUNCTION hpn_calculation_failure_test()`);
      }
      const afterClaimLoss = await client.query<{
        inputs: number;
        calculations: number;
      }>(
        `SELECT
         (SELECT count(*)::integer FROM outcome_hpn_pav_input_set) AS inputs,
         (SELECT count(*)::integer FROM outcome_hpn_pav_calculation) AS calculations`
      );
      expect(afterClaimLoss.rows).toEqual([{ inputs: 0, calculations: 0 }]);
      const concurrent = await Promise.all([
        new PostgresAflTradePrivateValuationHpnPreparation(client, {
          factualPreparation: { prepare: async () => ({ state: 'prepared' as const, output }) },
          methodId: method.methodId,
          methodAuthority,
          captureSource,
        }).prepare(preparationInput),
        new PostgresAflTradePrivateValuationHpnPreparation(client, {
          factualPreparation: {
            prepare: async () => ({ state: 'already_prepared' as const, output }),
          },
          methodId: method.methodId,
          methodAuthority,
          captureSource,
        }).prepare(preparationInput),
      ]);
      const first = concurrent.find(({ state }) => state === 'prepared');
      const replay = concurrent.find(({ state }) => state === 'already_prepared');
      if (!first || !replay) {
        throw new TypeError('Concurrent HPN preparation did not converge on one retained result.');
      }

      expect(first).toMatchObject({
        state: 'prepared',
        requestId,
        factualOutputId: output.outputId,
        inputSetId: expect.stringMatching(/^hpn-pav-input-set:[a-f0-9]{64}$/),
        calculationId: expect.stringMatching(/^hpn-pav-season:[a-f0-9]{64}$/),
        captureBindingIds: bindings.map(({ bindingId }) => bindingId),
        sourceAdmissionIds: [
          expect.stringMatching(/^private-valuation-hpn-source-admission:[a-f0-9]{64}$/),
          expect.stringMatching(/^private-valuation-hpn-source-admission:[a-f0-9]{64}$/),
          expect.stringMatching(/^private-valuation-hpn-source-admission:[a-f0-9]{64}$/),
        ],
        publicationEligible: false,
      });
      expect(replay).toEqual({ ...first, state: 'already_prepared' });
      retainedBackdatedAdmissionFixture = {
        requestId,
        originalClaimId: claim.claimId,
        binding: bindings[0]!,
        projected: projections[0]!,
      };
      const retainedAdmissions = await client.query<{
        dispatch_claim_id: string;
        attempt_sequence: number;
      }>(
        `SELECT dispatch_claim_id,attempt_sequence
         FROM outcome_private_valuation_hpn_source_admission
        WHERE request_id=$1 ORDER BY source_role`,
        [requestId]
      );
      expect(retainedAdmissions.rows).toEqual([
        { dispatch_claim_id: claim.claimId, attempt_sequence: 1 },
        { dispatch_claim_id: claim.claimId, attempt_sequence: 1 },
        { dispatch_claim_id: claim.claimId, attempt_sequence: 1 },
      ]);
      const forgedAdmission = createAflTradePrivateValuationHpnSourceAdmission({
        requestId,
        dispatchClaimId: claim.claimId,
        attemptSequence: 1,
        attemptNumber: 1,
        sourceRole: lanes[0]!.sourceRole,
        captureBindingId: bindings[0]!.bindingId,
        sourceCaptureId: bindings[1]!.content.sourceCaptureId,
        normalizationRunId: bindings[1]!.content.normalizationRunId,
        projectedFieldMapId: projections[0]!.projectedFieldMap!.fieldMapId,
        admittedAt: projectionAt,
      });
      await expect(
        client.query(
          `INSERT INTO outcome_private_valuation_hpn_source_admission
          (admission_id,request_id,source_role,dispatch_claim_id,attempt_sequence,
           attempt_number,capture_binding_id,source_capture_id,normalization_run_id,
           projected_field_map_id,admitted_at,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            forgedAdmission.admissionId,
            requestId,
            forgedAdmission.content.sourceRole,
            claim.claimId,
            1,
            1,
            forgedAdmission.content.captureBindingId,
            forgedAdmission.content.sourceCaptureId,
            forgedAdmission.content.normalizationRunId,
            forgedAdmission.content.projectedFieldMapId,
            forgedAdmission.content.admittedAt,
            canonicalizeAflTradeJson(forgedAdmission),
          ]
        )
      ).rejects.toThrow('Private valuation HPN source admission custody is invalid');
      const wrongMapAdmission = createAflTradePrivateValuationHpnSourceAdmission({
        requestId,
        dispatchClaimId: claim.claimId,
        attemptSequence: 1,
        attemptNumber: 1,
        sourceRole: lanes[0]!.sourceRole,
        captureBindingId: bindings[0]!.bindingId,
        sourceCaptureId: bindings[0]!.content.sourceCaptureId,
        normalizationRunId: bindings[0]!.content.normalizationRunId,
        projectedFieldMapId: projections[1]!.projectedFieldMap!.fieldMapId,
        admittedAt: projectionAt,
      });
      await expect(
        client.query(
          `INSERT INTO outcome_private_valuation_hpn_source_admission
          (admission_id,request_id,source_role,dispatch_claim_id,attempt_sequence,
           attempt_number,capture_binding_id,source_capture_id,normalization_run_id,
           projected_field_map_id,admitted_at,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            wrongMapAdmission.admissionId,
            requestId,
            wrongMapAdmission.content.sourceRole,
            claim.claimId,
            1,
            1,
            wrongMapAdmission.content.captureBindingId,
            wrongMapAdmission.content.sourceCaptureId,
            wrongMapAdmission.content.normalizationRunId,
            wrongMapAdmission.content.projectedFieldMapId,
            wrongMapAdmission.content.admittedAt,
            canonicalizeAflTradeJson(wrongMapAdmission),
          ]
        )
      ).rejects.toThrow('Private valuation HPN source admission custody is invalid');
      const stored = await client.query<{
        input_status: string;
        calculation_status: string;
        legacy_maps: number;
        projected_maps: number;
      }>(
        `SELECT input.status::text AS input_status,
              calculation.status::text AS calculation_status,
              count(run.field_map_id)::integer AS legacy_maps,
              count(run.projected_field_map_id)::integer AS projected_maps
         FROM outcome_hpn_pav_input_set input
         JOIN outcome_hpn_pav_input_run run ON run.input_set_id=input.input_set_id
         JOIN outcome_hpn_pav_calculation calculation
           ON calculation.input_set_id=input.input_set_id
        WHERE input.input_set_id=$1
        GROUP BY input.status,calculation.status`,
        [first.inputSetId]
      );
      expect(stored.rows).toEqual([
        {
          input_status: 'finalized',
          calculation_status: 'finalized',
          legacy_maps: 0,
          projected_maps: 3,
        },
      ]);
      await expect(
        client.query<{
          active_release: unknown;
          active_publication: unknown;
        }>(
          `SELECT
           (SELECT COALESCE(jsonb_agg(to_jsonb(active_release)
                      ORDER BY active_release.scope_key),'[]'::jsonb)
              FROM outcome_active_release active_release) AS active_release,
           (SELECT COALESCE(jsonb_agg(to_jsonb(active_publication)
                      ORDER BY active_publication.scope_key),'[]'::jsonb)
              FROM outcome_valuation_active_publication active_publication) AS active_publication`
        )
      ).resolves.toEqual(publicPointersBefore);
    });

    it('rejects a reviewed-evidence successor with duplicated members behind claimed 7/3 counts', async () => {
      const before = await client.query<{ total: number }>(
        `SELECT count(*)::integer AS total
         FROM outcome_private_reviewed_evidence_bundle`
      );
      await expect(
        client.transaction(async (transaction) => {
          await transaction.query(`SET LOCAL session_replication_role='replica'`);
          await transaction.query(
            `UPDATE outcome_private_reviewed_evaluation_head head
              SET revision=legacy.revision,
                  decision_id=legacy.decision_id,
                  evidence_bundle_id=legacy.evidence_bundle_id,
                  status=legacy.status,
                  updated_at=legacy.decided_at
             FROM outcome_private_reviewed_evaluation_decision legacy
            WHERE head.valuation_scope_key=legacy.valuation_scope_key
              AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
              AND legacy.revision=1`
          );
          await transaction.query(`SET LOCAL session_replication_role='origin'`);
          await transaction.query(
            `WITH source AS (
             SELECT bundle.*,
                    bundle.bundle_json->'content' AS original_content,
                    bundle.created_at+interval '1 day' AS next_created_at
               FROM outcome_private_reviewed_evidence_bundle bundle
              WHERE bundle.source_capture_count=7 AND bundle.source_rights_count=3
              ORDER BY bundle.created_at DESC LIMIT 1
           ), changed AS (
             SELECT source.*,
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(original_content,'{sourceCaptures}',
                          (original_content->'sourceCaptures')||
                            jsonb_build_array(original_content->'sourceCaptures'->0),false),
                        '{sourceRightsEvidenceRefs}',
                          (original_content->'sourceRightsEvidenceRefs')||
                            jsonb_build_array(original_content->'sourceRightsEvidenceRefs'->0),false),
                      '{createdAt}',to_jsonb(to_char(next_created_at AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),false) AS next_content
               FROM source
           ), addressed AS (
             SELECT changed.*,
                    outcome_afl_trade_canonical_json(next_content) AS next_canonical,
                    encode(sha256(convert_to(
                      outcome_afl_trade_canonical_json(next_content),'UTF8')),'hex') AS next_sha256
               FROM changed
           )
           INSERT INTO outcome_private_reviewed_evidence_bundle
             (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
              source_capture_count,source_rights_count,created_at,bundle_sha256,
              bundle_content_canonical_json,bundle_json,registered_at)
           SELECT 'private-reviewed-evidence-bundle:'||next_sha256,evidence_scope_key,
                  candidate_count,decision_count,7,3,next_created_at,next_sha256,
                  next_canonical,
                  jsonb_build_object(
                    'evidenceBundleId','private-reviewed-evidence-bundle:'||next_sha256,
                    'content',next_content),
                  next_created_at
             FROM addressed`
          );
        })
      ).rejects.toThrow(/results successor failed exact authentication/i);
      const after = await client.query<{ total: number }>(
        `SELECT count(*)::integer AS total
         FROM outcome_private_reviewed_evidence_bundle`
      );
      expect(after.rows).toEqual(before.rows);
    });

    it('rejects malformed direct-SQL projected completion and stat values', async () => {
      const checked = await client.query<{
        missing_status: boolean;
        null_score: boolean;
        invalid_date: boolean;
        negative_stat: boolean;
        fractional_stat: boolean;
      }>(
        `SELECT
         outcome_hpn_pav_projected_result_completed(
           '{"status":{"kind":"missing"}}'::jsonb,
           '{"content":{"completionRule":{"kind":"source_status","completedValues":["FINAL"]},
             "semanticBindings":[{"semanticField":"completionStatus",
               "mapping":{"kind":"direct","sourceField":"status"}}]}}'::jsonb
         ) AS missing_status,
         outcome_hpn_pav_projected_result_completed(
           '{"Date":{"kind":"date","value":"2026-08-08"},
             "Home.Points":{"kind":"missing"},"Away.Points":{"kind":"integer","value":"80"}}'::jsonb,
           '{"content":{"completionRule":{"kind":"reviewed_final_score_presence"},
             "semanticBindings":[{"semanticField":"completionStatus",
               "mapping":{"kind":"reviewed_final_scores","matchDateField":"Date",
                 "homePointsField":"Home.Points","awayPointsField":"Away.Points"}}]}}'::jsonb
         ) AS null_score,
         outcome_hpn_pav_projected_result_completed(
           '{"Date":{"kind":"date","value":"2026-02-30"},
             "Home.Points":{"kind":"integer","value":"100"},
             "Away.Points":{"kind":"integer","value":"80"}}'::jsonb,
           '{"content":{"completionRule":{"kind":"reviewed_final_score_presence"},
             "semanticBindings":[{"semanticField":"completionStatus",
               "mapping":{"kind":"reviewed_final_scores","matchDateField":"Date",
                 "homePointsField":"Home.Points","awayPointsField":"Away.Points"}}]}}'::jsonb
         ) AS invalid_date,
         outcome_hpn_pav_nonnegative_integer('-1'::jsonb) AS negative_stat,
         outcome_hpn_pav_nonnegative_integer('1.5'::jsonb) AS fractional_stat`
      );
      expect(checked.rows).toEqual([
        {
          missing_status: false,
          null_score: false,
          invalid_date: false,
          negative_stat: false,
          fractional_stat: false,
        },
      ]);
    });

    it('rejects forged, denied, and expired source rights in the shared authority predicate', async () => {
      const checked = await client.query<{
        valid: boolean;
        forged_id: boolean;
        denied_operation: boolean;
        expired: boolean;
      }>(
        `WITH selected AS (
         SELECT rights.content_json AS rights_json,
                outcome_hpn_pav_projected_reviewed_fields(candidate.candidate_json) AS fields
           FROM outcome_hpn_projected_field_map map
           JOIN outcome_hpn_field_map_candidate candidate
             ON candidate.candidate_id=map.candidate_id
           JOIN outcome_hpn_field_map_review_decision decision
             ON decision.decision_id=map.approval_decision_id
           JOIN outcome_source_rights_proposal rights
             ON rights.rights_artifact_id=
               decision.source_use_assessment_json#>>'{content,rightsArtifactId}'
          WHERE map.input_kind='completed_match_result'
       ), variants AS (
         SELECT *,
                jsonb_set(rights_json,'{rightsArtifactId}',
                  to_jsonb(('source-rights:'||repeat('0',64))::text),false) AS forged_json,
                jsonb_set(rights_json->'content','{operations,derived_feature_creation}',
                  to_jsonb('blocked'::text),false) AS denied_content,
                jsonb_set(rights_json->'content','{termsExpireAt}',
                  to_jsonb('2026-08-14T12:00:00.000Z'::text),false) AS expired_content
           FROM selected
       ), addressed AS (
         SELECT *,
                jsonb_build_object(
                  'rightsArtifactId','source-rights:'||encode(sha256(convert_to(
                    outcome_afl_trade_canonical_json(denied_content),'UTF8')),'hex'),
                  'content',denied_content) AS denied_json,
                jsonb_build_object(
                  'rightsArtifactId','source-rights:'||encode(sha256(convert_to(
                    outcome_afl_trade_canonical_json(expired_content),'UTF8')),'hex'),
                  'content',expired_content) AS expired_json
           FROM variants
       )
       SELECT outcome_hpn_private_source_rights_permit(
                rights_json,fields,'AFLM',2026,$1::timestamptz) AS valid,
              outcome_hpn_private_source_rights_permit(
                forged_json,fields,'AFLM',2026,$1::timestamptz) AS forged_id,
              outcome_hpn_private_source_rights_permit(
                denied_json,fields,'AFLM',2026,$1::timestamptz) AS denied_operation,
              outcome_hpn_private_source_rights_permit(
                expired_json,fields,'AFLM',2026,$1::timestamptz) AS expired
         FROM addressed`,
        [projectionAt]
      );
      expect(checked.rows).toEqual([
        { valid: true, forged_id: false, denied_operation: false, expired: false },
      ]);
    });

    it('rejects a normalization run produced by a different decode map with the same schema', async () => {
      const validMap = await client.query<{ field_map_id: string }>(
        `SELECT field_map_id FROM outcome_hpn_projected_field_map
        WHERE input_kind='completed_match_result'
        ORDER BY field_map_id LIMIT 1`
      );
      const alternateDecodeMapId = 'afl-tables-results-local-2026-v2-alternate';
      const alternateNormalizationRunId = id('provider-normalization-run', 'results-alternate-map');
      await client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL session_replication_role='replica'`);
        await transaction.query(
          `INSERT INTO outcome_provider_field_map
          (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
           field_map_sha256,approval_decision_id,approved_at,map_json)
         SELECT $1,capability_id,fitzroy_version,source_schema_sha256,$2,
                approval_decision_id,approved_at,
                jsonb_set(map_json,'{mapId}',to_jsonb($1::text),false)
           FROM outcome_provider_field_map
          WHERE field_map_id='afl-tables-results-local-2026-v2'`,
          [alternateDecodeMapId, sha256(alternateDecodeMapId)]
        );
        await transaction.query(
          `INSERT INTO outcome_provider_normalization_run
          (normalization_run_id,capture_id,field_map_id,decoder_version,
           normalizer_version,source_rds_sha256,decoded_sha256,receipt_sha256,
           staging_sha256,status,source_row_count,accepted_row_count,
           quarantined_row_count,issue_count,identity_candidate_count,
           match_candidate_count,metric_candidate_count,achievement_candidate_count,
           started_at,completed_at,finalized_at,receipt_json)
         SELECT $1,capture_id,$2,decoder_version,normalizer_version,source_rds_sha256,
                decoded_sha256,receipt_sha256,staging_sha256,status,source_row_count,
                accepted_row_count,quarantined_row_count,issue_count,
                identity_candidate_count,match_candidate_count,metric_candidate_count,
                achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json
           FROM outcome_provider_normalization_run
          WHERE normalization_run_id=$3`,
          [
            alternateNormalizationRunId,
            alternateDecodeMapId,
            id('provider-normalization-run', 'results'),
          ]
        );
        await transaction.query(`SET LOCAL session_replication_role='origin'`);
      });

      await expect(
        attemptProjectedRun({
          fieldMapId: validMap.rows[0]!.field_map_id,
          normalizationRunId: alternateNormalizationRunId,
          effectiveThrough: '2026-08-20T00:00:00.000Z',
        })
      ).rejects.toThrow(/exact current source authority/i);
    });

    it('rechecks the exact decode map when finalizing an already-populated input set', async () => {
      await expect(
        client.transaction(async (transaction) => {
          await transaction.query(`SET LOCAL session_replication_role='replica'`);
          await transaction.query(
            `UPDATE outcome_hpn_pav_input_set
              SET status='building',finalized_at=NULL
            WHERE status='finalized'`
          );
          await transaction.query(
            `DELETE FROM outcome_provider_normalization_run
            WHERE normalization_run_id=$1`,
            [id('provider-normalization-run', 'results-alternate-map')]
          );
          await transaction.query(
            `UPDATE outcome_provider_normalization_run
              SET field_map_id='afl-tables-results-local-2026-v2-alternate'
            WHERE normalization_run_id=$1`,
            [id('provider-normalization-run', 'results')]
          );
          await transaction.query(`SET LOCAL session_replication_role='origin'`);
          await transaction.query(
            `UPDATE outcome_hpn_pav_input_set
              SET status='finalized',finalized_at=created_at
            WHERE status='building'`
          );
        })
      ).rejects.toThrow(/source run is incomplete, stale, or outside reviewed scope/i);
    });

    it.each([
      ['candidate', '2026-08-22T00:00:00.000Z'],
      ['decision', '2026-08-23T00:00:00.000Z'],
    ] as const)(
      'rejects a forged retained projected-map %s through the real input-run boundary',
      async (tamper, effectiveThrough) => {
        const validMap = await client.query<{ field_map_id: string }>(
          `SELECT field_map_id FROM outcome_hpn_projected_field_map
          WHERE input_kind='completed_match_result'
          ORDER BY field_map_id LIMIT 1`
        );
        await expect(
          attemptProjectedRun({
            fieldMapId: validMap.rows[0]!.field_map_id,
            normalizationRunId: id('provider-normalization-run', 'results'),
            effectiveThrough,
            tamper,
          })
        ).rejects.toThrow(/exact current source authority/i);
      }
    );

    it('rejects a content-addressed projected map that cannot be reconstructed from its retained review', async () => {
      const forged = await client.query<{ field_map_id: string }>(
        `WITH original AS (
         SELECT * FROM outcome_hpn_projected_field_map
          WHERE input_kind='completed_match_result'
          ORDER BY field_map_id
          LIMIT 1
       ), changed AS (
         SELECT original.*,
                jsonb_set(
                  map_json,
                  '{content,semanticBindings,0,mapping,sourceField}',
                  to_jsonb('forged_source_field'::text),
                  false
                ) AS forged_json
           FROM original
       ), addressed AS (
         SELECT changed.*,
                encode(sha256(convert_to(
                  outcome_afl_trade_canonical_json(forged_json->'content'),
                  'UTF8'
                )),'hex') AS forged_sha256
           FROM changed
       )
       INSERT INTO outcome_hpn_projected_field_map
         (field_map_id,candidate_id,approval_decision_id,environment,competition,
          provider,capability_id,input_kind,source_schema_sha256,valid_from_season,
          valid_through_season,field_map_sha256,field_map_canonical_json,map_json,
          created_at)
       SELECT 'hpn-pav-field-map:'||forged_sha256,candidate_id,approval_decision_id,
              environment,competition,provider,capability_id,input_kind,
              source_schema_sha256,valid_from_season,valid_through_season,
              forged_sha256,outcome_afl_trade_canonical_json(
                jsonb_set(
                  forged_json,
                  '{fieldMapId}',
                  to_jsonb('hpn-pav-field-map:'||forged_sha256),
                  false
                )
              ),
              jsonb_set(
                forged_json,
                '{fieldMapId}',
                to_jsonb('hpn-pav-field-map:'||forged_sha256),
                false
              ),
              created_at
         FROM addressed
       RETURNING field_map_id`
      );
      const checked = await client.query<{ valid: boolean; forged: boolean }>(
        `SELECT outcome_hpn_projected_field_map_authority_is_exact(
                (SELECT field_map_id FROM outcome_hpn_projected_field_map
                  WHERE input_kind='completed_match_result' AND field_map_id<>$1
                  ORDER BY field_map_id LIMIT 1)
              ,$2::timestamptz) AS valid,
              outcome_hpn_projected_field_map_authority_is_exact(
                $1,$2::timestamptz) AS forged`,
        [forged.rows[0]?.field_map_id, projectionAt]
      );

      expect(checked.rows).toEqual([{ valid: true, forged: false }]);
      await expect(
        attemptProjectedRun({
          fieldMapId: forged.rows[0]!.field_map_id,
          normalizationRunId: id('provider-normalization-run', 'results'),
          effectiveThrough: '2026-08-19T00:00:00.000Z',
        })
      ).rejects.toThrow(/exact current source authority/i);
    });

    it('rejects an otherwise exact projected map approved for another valuation scope', async () => {
      const otherScope = 'afl-men:2025-trades';
      const reviewed = reviewedEvaluation(otherScope);
      const crossScopeProjection = projection(lanes[0]!, otherScope);
      await client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL session_replication_role='replica'`);
        await transaction.query(
          `INSERT INTO outcome_private_reviewed_evaluation_decision
          (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
           supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
           decision_content_canonical_json,decision_json,registered_at)
         VALUES ($1,$2,$3,'authorized',1,NULL,$4,$5,$6,$7,$8::jsonb,$5)`,
          [
            reviewed.evaluationDecision.decisionId,
            otherScope,
            reviewed.evidenceBundle.evidenceBundleId,
            reviewed.evaluationDecision.content.reviewerId,
            reviewed.evaluationDecision.content.decidedAt,
            reviewed.evaluationDecision.decisionId.split(':').at(-1),
            canonicalizeAflTradeJson(reviewed.evaluationDecision.content),
            canonicalizeAflTradeJson(reviewed.evaluationDecision),
          ]
        );
        await transaction.query(
          `INSERT INTO outcome_private_reviewed_evaluation_head
          (valuation_scope_key,evidence_scope_key,revision,decision_id,
           evidence_bundle_id,status,updated_at)
         VALUES ($1,$2,1,$3,$4,'authorized',$5)`,
          [
            otherScope,
            reviewed.evidenceBundle.content.evidenceScopeKey,
            reviewed.evaluationDecision.decisionId,
            reviewed.evidenceBundle.evidenceBundleId,
            reviewed.evaluationDecision.content.decidedAt,
          ]
        );
      });
      await new PostgresAflTradeHpnProjectedFieldMapAuthority(client).registerApprovedProjection(
        crossScopeProjection
      );

      await expect(
        attemptProjectedRun({
          fieldMapId: crossScopeProjection.projectedFieldMap!.fieldMapId,
          normalizationRunId: id('provider-normalization-run', 'results'),
          effectiveThrough: '2026-08-21T00:00:00.000Z',
        })
      ).rejects.toThrow(/exact current source authority/i);
    });

    it('rejects coherent expired rights at input finalization and source-run attachment', async () => {
      const shortLivedInput = await prepareShortLivedResultsInput();
      for (;;) {
        const expiry = await client.query<{ expired: boolean }>(
          `SELECT clock_timestamp()>=$1::timestamptz AS expired`,
          [shortLivedInput.expiresAt]
        );
        if (expiry.rows[0]?.expired) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await expect(
        client.transaction(async (transaction) => {
          await transaction.query(`SET LOCAL session_replication_role='replica'`);
          await transaction.query(
            `UPDATE outcome_hpn_pav_input_set
              SET status='building',finalized_at=NULL
            WHERE input_set_id=$1`,
            [shortLivedInput.inputSetId]
          );
          await transaction.query(`SET LOCAL session_replication_role='origin'`);
          await transaction.query(
            `UPDATE outcome_hpn_pav_input_set
              SET status='finalized',finalized_at=created_at
            WHERE input_set_id=$1`,
            [shortLivedInput.inputSetId]
          );
        })
      ).rejects.toThrow(/source run is incomplete, stale, or outside reviewed scope/i);
      await expect(
        attemptProjectedRun({
          fieldMapId: shortLivedInput.projectedFieldMapId,
          normalizationRunId: shortLivedInput.normalizationRunId,
          effectiveThrough: '2026-08-10T23:59:59.999Z',
        })
      ).rejects.toThrow(/exact current source authority/i);
    }, 60_000);

    it('rejects a backdated direct admission after its projected map is superseded', async () => {
      const fixture = retainedBackdatedAdmissionFixture;
      if (fixture === undefined) {
        throw new TypeError('The backdated-admission fixture was not retained.');
      }
      const successorAt = '2026-08-22T00:00:00.000Z';
      const rejectedDecision = createAflTradeHpnFieldMapReviewDecision({
        candidate: fixture.projected.candidate,
        candidateArtifact: fixture.projected.candidateArtifact,
        sourceUseAssessment: fixture.projected.sourceUseAssessment,
        sourceUseAssessmentArtifact: fixture.projected.sourceUseAssessmentArtifact,
        decision: 'rejected',
        reviewerId: 'projected-hpn-input-fixture-reviewer',
        rationale: 'Supersede the disposable projection for a backdating regression.',
        decidedAt: successorAt,
      });
      await new PostgresAflTradeHpnProjectedFieldMapAuthority(client).registerDecision({
        candidate: fixture.projected.candidate,
        candidateArtifact: fixture.projected.candidateArtifact,
        sourceUseAssessment: fixture.projected.sourceUseAssessment,
        sourceUseAssessmentArtifact: fixture.projected.sourceUseAssessmentArtifact,
        reviewDecision: rejectedDecision,
        decisionArtifact: createAflTradeCanonicalJsonArtifactRef(rejectedDecision, successorAt),
      });
      const binding = fixture.binding;
      if (
        binding.content.schemaVersion !==
          AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION ||
        binding.content.sourceRole === 'factual_input'
      ) {
        throw new TypeError('The backdated-admission fixture requires role-aware custody.');
      }
      const backdated = createAflTradePrivateValuationHpnSourceAdmission({
        requestId: fixture.requestId,
        dispatchClaimId: fixture.originalClaimId,
        attemptSequence: binding.content.attemptSequence,
        attemptNumber: binding.content.attemptNumber,
        sourceRole: binding.content.sourceRole,
        captureBindingId: binding.bindingId,
        sourceCaptureId: binding.content.sourceCaptureId,
        normalizationRunId: binding.content.normalizationRunId,
        projectedFieldMapId: fixture.projected.projectedFieldMap!.fieldMapId,
        admittedAt: projectionAt,
      });
      await expect(
        client.query(
          `INSERT INTO outcome_private_valuation_hpn_source_admission
          (admission_id,request_id,source_role,dispatch_claim_id,attempt_sequence,
           attempt_number,capture_binding_id,source_capture_id,normalization_run_id,
           projected_field_map_id,admitted_at,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            backdated.admissionId,
            backdated.content.requestId,
            backdated.content.sourceRole,
            backdated.content.dispatchClaimId,
            backdated.content.attemptSequence,
            backdated.content.attemptNumber,
            backdated.content.captureBindingId,
            backdated.content.sourceCaptureId,
            backdated.content.normalizationRunId,
            backdated.content.projectedFieldMapId,
            backdated.content.admittedAt,
            canonicalizeAflTradeJson(backdated),
          ]
        )
      ).rejects.toThrow('Private valuation HPN source admission custody is invalid');
    });
  }
);
