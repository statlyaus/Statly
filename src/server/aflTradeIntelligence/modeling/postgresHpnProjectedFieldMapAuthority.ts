import { z } from 'zod';

import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnFieldMapCandidateSchema,
  type AflTradeHpnFieldMapCandidate,
} from './hpnFieldMapCandidate';
import {
  aflTradeHpnFieldMapReviewDecisionSchema,
  aflTradeHpnProjectedFieldMapSchema,
  createAflTradeHpnProjectedFieldMap,
  type AflTradeHpnFieldMapReviewDecision,
  type AflTradeHpnProjectedFieldMap,
} from './hpnProjectedFieldMap';
import type { AflTradeHpnPrivateCalculationSourceUseAssessment } from './hpnPrivateCalculationSourceUse';

type ReviewedCandidateInput = Readonly<{
  candidate: AflTradeHpnFieldMapCandidate;
  candidateArtifact: AflTradeArtifactRef;
  sourceUseAssessment: AflTradeHpnPrivateCalculationSourceUseAssessment;
  sourceUseAssessmentArtifact: AflTradeArtifactRef;
  reviewDecision: AflTradeHpnFieldMapReviewDecision;
  decisionArtifact: AflTradeArtifactRef;
}>;

export type ApprovedHpnProjectedFieldMapRegistration = ReviewedCandidateInput &
  Readonly<{ projectedFieldMap: AflTradeHpnProjectedFieldMap }>;

interface StoredProjectionRow {
  candidate_json: unknown;
  candidate_artifact_json: unknown;
  decision_json: unknown;
  decision_artifact_json: unknown;
  source_use_assessment_json: unknown;
  source_use_assessment_artifact_json: unknown;
  map_json: unknown;
  current_decision_id: string;
}

const currentSourceSelectionSchema = z
  .object({
    provider: z.string().trim().min(1).max(240),
    capabilityId: z.string().trim().min(1).max(240),
    inputKind: z.enum(['completed_match_result', 'player_match_stats']),
    sourceSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    providerDecodeMapId: z.string().trim().min(1).max(240),
    seasonYear: z.number().int().min(1998).max(2200),
    rightsArtifactId: z.string().regex(/^source-rights:[a-f0-9]{64}$/u),
    valuationScopeKey: z.string().trim().min(1).max(240),
  })
  .strict();

function digestFromId(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

function authenticateReviewedCandidate(input: ReviewedCandidateInput): ReviewedCandidateInput {
  const candidate = aflTradeHpnFieldMapCandidateSchema.parse(input.candidate);
  const reviewDecision = aflTradeHpnFieldMapReviewDecisionSchema.parse(input.reviewDecision);
  const sourceUseAssessment = input.sourceUseAssessment;
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.candidateArtifact, candidate) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.decisionArtifact, reviewDecision) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      input.sourceUseAssessmentArtifact,
      sourceUseAssessment
    ) ||
    sourceUseAssessment.assessmentId !== createAflTradeContentAddress(
      'hpn-private-source-use-assessment',
      sourceUseAssessment.content
    ) ||
    reviewDecision.content.candidateId !== candidate.candidateId ||
    !doAflTradeArtifactRefsExactlyMatch(
      reviewDecision.content.candidateArtifact,
      input.candidateArtifact
    ) ||
    reviewDecision.content.sourceUseAssessmentId !== sourceUseAssessment.assessmentId ||
    !doAflTradeArtifactRefsExactlyMatch(
      reviewDecision.content.sourceUseAssessmentArtifact,
      input.sourceUseAssessmentArtifact
    )
  ) {
    throw new TypeError(
      'HPN field-map registration requires an exact candidate and its exact review decision.'
    );
  }
  return {
    candidate,
    candidateArtifact: input.candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: input.sourceUseAssessmentArtifact,
    reviewDecision,
    decisionArtifact: input.decisionArtifact,
  };
}

async function assertExactReplay(
  transaction: AflOutcomeSqlTransaction,
  input: { readonly sql: string; readonly parameters: readonly unknown[]; readonly message: string }
): Promise<void> {
  const exact = await transaction.query(input.sql, input.parameters);
  if (exact.rows.length !== 1) throw new Error(input.message);
}

async function persistCandidate(
  transaction: AflOutcomeSqlTransaction,
  input: ReviewedCandidateInput
): Promise<void> {
  const { candidate, candidateArtifact } = input;
  const canonical = canonicalizeAflTradeJson(candidate);
  await transaction.query(
    `INSERT INTO outcome_hpn_field_map_candidate
      (candidate_id,environment,provider,capability_id,input_kind,source_schema_sha256,
       valid_from_season,valid_through_season,candidate_sha256,candidate_artifact_json,
       candidate_canonical_json,candidate_json,created_at)
     VALUES ($1,'non_production',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::text,$10::jsonb,$11)
     ON CONFLICT (candidate_id) DO NOTHING`,
    [
      candidate.candidateId,
      candidate.content.provider,
      candidate.content.capabilityId,
      candidate.content.inputKind,
      candidate.content.sourceSchemaSha256,
      candidate.content.validFromSeason,
      candidate.content.validThroughSeason,
      digestFromId(candidate.candidateId),
      canonicalizeAflTradeJson(candidateArtifact),
      canonical,
      candidateArtifact.createdAt,
    ]
  );
  await assertExactReplay(transaction, {
    sql: `SELECT candidate_id FROM outcome_hpn_field_map_candidate
           WHERE candidate_id=$1 AND candidate_canonical_json=$2
             AND candidate_artifact_json=$3::jsonb FOR KEY SHARE`,
    parameters: [
      candidate.candidateId,
      canonical,
      canonicalizeAflTradeJson(candidateArtifact),
    ],
    message: 'The HPN field-map candidate conflicts with durable authority.',
  });
}

async function persistDecision(
  transaction: AflOutcomeSqlTransaction,
  input: ReviewedCandidateInput
): Promise<void> {
  const {
    reviewDecision,
    decisionArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
  } = input;
  const canonical = canonicalizeAflTradeJson(reviewDecision);
  const sourceUseCanonical = canonicalizeAflTradeJson(sourceUseAssessment);
  await transaction.query(
    `INSERT INTO outcome_hpn_field_map_review_decision
      (decision_id,candidate_id,decision,reviewer_id,rationale,
       source_use_assessment_id,source_use_assessment_artifact_json,
       source_use_assessment_canonical_json,source_use_assessment_json,decision_sha256,
       decision_artifact_json,decision_canonical_json,decision_json,decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text,$8::jsonb,$9,
             $10::jsonb,$11::text,$11::jsonb,$12)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      reviewDecision.decisionId,
      reviewDecision.content.candidateId,
      reviewDecision.content.decision,
      reviewDecision.content.reviewerId,
      reviewDecision.content.rationale,
      sourceUseAssessment.assessmentId,
      canonicalizeAflTradeJson(sourceUseAssessmentArtifact),
      sourceUseCanonical,
      digestFromId(reviewDecision.decisionId),
      canonicalizeAflTradeJson(decisionArtifact),
      canonical,
      reviewDecision.content.decidedAt,
    ]
  );
  await assertExactReplay(transaction, {
    sql: `SELECT decision_id FROM outcome_hpn_field_map_review_decision
           WHERE decision_id=$1 AND decision_canonical_json=$2
             AND decision_artifact_json=$3::jsonb
             AND source_use_assessment_canonical_json=$4
             AND source_use_assessment_artifact_json=$5::jsonb FOR KEY SHARE`,
    parameters: [
      reviewDecision.decisionId,
      canonical,
      canonicalizeAflTradeJson(decisionArtifact),
      sourceUseCanonical,
      canonicalizeAflTradeJson(sourceUseAssessmentArtifact),
    ],
    message: 'The HPN field-map review decision conflicts with durable authority.',
  });
}

async function persistProjection(
  transaction: AflOutcomeSqlTransaction,
  fieldMap: AflTradeHpnProjectedFieldMap
): Promise<void> {
  const canonical = canonicalizeAflTradeJson(fieldMap);
  await transaction.query(
    `INSERT INTO outcome_hpn_projected_field_map
      (field_map_id,candidate_id,approval_decision_id,environment,competition,provider,capability_id,
       input_kind,source_schema_sha256,valid_from_season,valid_through_season,
       field_map_sha256,field_map_canonical_json,map_json,created_at)
     VALUES ($1,$2,$3,'non_production','AFLM',$4,$5,$6,$7,$8,$9,$10,$11::text,$11::jsonb,$12)
     ON CONFLICT (field_map_id) DO NOTHING`,
    [
      fieldMap.fieldMapId,
      fieldMap.content.candidateId,
      fieldMap.content.approvalDecisionId,
      fieldMap.content.provider,
      fieldMap.content.capabilityId,
      fieldMap.content.inputKind,
      fieldMap.content.sourceSchemaSha256,
      fieldMap.content.validFromSeason,
      fieldMap.content.validThroughSeason,
      digestFromId(fieldMap.fieldMapId),
      canonical,
      fieldMap.content.createdAt,
    ]
  );
  await assertExactReplay(transaction, {
    sql: `SELECT field_map_id FROM outcome_hpn_projected_field_map
           WHERE field_map_id=$1 AND field_map_canonical_json=$2 FOR KEY SHARE`,
    parameters: [fieldMap.fieldMapId, canonical],
    message: 'The projected HPN field map conflicts with durable authority.',
  });
}

export class PostgresAflTradeHpnProjectedFieldMapAuthority {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async registerDecision(input: ReviewedCandidateInput): Promise<void> {
    const authenticated = authenticateReviewedCandidate(input);
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hpn-field-map-candidate:${authenticated.candidate.candidateId}`,
      ]);
      await persistCandidate(transaction, authenticated);
      await persistDecision(transaction, authenticated);
    });
  }

  async registerApprovedProjection(
    input: ApprovedHpnProjectedFieldMapRegistration
  ): Promise<AflTradeHpnProjectedFieldMap> {
    const authenticated = authenticateReviewedCandidate(input);
    if (authenticated.reviewDecision.content.decision !== 'approved') {
      throw new TypeError('A projected HPN field map requires an approved review decision.');
    }
    const projectedFieldMap = aflTradeHpnProjectedFieldMapSchema.parse(
      input.projectedFieldMap
    );
    const reconstructed = createAflTradeHpnProjectedFieldMap({
      candidate: authenticated.candidate,
      candidateArtifact: authenticated.candidateArtifact,
      decision: authenticated.reviewDecision,
      decisionArtifact: authenticated.decisionArtifact,
    });
    if (
      canonicalizeAflTradeJson(reconstructed) !==
      canonicalizeAflTradeJson(projectedFieldMap)
    ) {
      throw new TypeError(
        'The projected HPN field map is not the exact output of its candidate and approval.'
      );
    }
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hpn-field-map-candidate:${authenticated.candidate.candidateId}`,
      ]);
      await persistCandidate(transaction, authenticated);
      await persistDecision(transaction, authenticated);
      await persistProjection(transaction, projectedFieldMap);
    });
    return projectedFieldMap;
  }

  async loadCurrentExact(fieldMapId: string): Promise<AflTradeHpnProjectedFieldMap | null> {
    const result = await this.client.query<StoredProjectionRow>(
      `SELECT candidate.candidate_json,candidate.candidate_artifact_json,
              decision.decision_json,decision.decision_artifact_json,map.map_json,
              decision.source_use_assessment_json,
              decision.source_use_assessment_artifact_json,
              current_decision.decision_id AS current_decision_id
         FROM outcome_hpn_projected_field_map map
         JOIN outcome_hpn_field_map_candidate candidate
           ON candidate.candidate_id=map.candidate_id
         JOIN outcome_hpn_field_map_review_decision decision
           ON decision.decision_id=map.approval_decision_id
         JOIN LATERAL (
           SELECT latest.decision_id
             FROM outcome_hpn_field_map_review_decision latest
            WHERE latest.candidate_id=candidate.candidate_id
            ORDER BY latest.registered_at DESC,latest.decision_id DESC LIMIT 1
         ) current_decision ON true
        WHERE map.field_map_id=$1`,
      [fieldMapId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const candidate = aflTradeHpnFieldMapCandidateSchema.parse(row.candidate_json);
    const reviewDecision = aflTradeHpnFieldMapReviewDecisionSchema.parse(row.decision_json);
    const projectedFieldMap = aflTradeHpnProjectedFieldMapSchema.parse(row.map_json);
    const authenticated = authenticateReviewedCandidate({
      candidate,
      candidateArtifact: row.candidate_artifact_json as AflTradeArtifactRef,
      sourceUseAssessment:
        row.source_use_assessment_json as AflTradeHpnPrivateCalculationSourceUseAssessment,
      sourceUseAssessmentArtifact:
        row.source_use_assessment_artifact_json as AflTradeArtifactRef,
      reviewDecision,
      decisionArtifact: row.decision_artifact_json as AflTradeArtifactRef,
    });
    if (
      row.current_decision_id !== reviewDecision.decisionId ||
      reviewDecision.content.decision !== 'approved'
    ) {
      return null;
    }
    const reconstructed = createAflTradeHpnProjectedFieldMap({
      candidate: authenticated.candidate,
      candidateArtifact: authenticated.candidateArtifact,
      decision: authenticated.reviewDecision,
      decisionArtifact: authenticated.decisionArtifact,
    });
    if (
      canonicalizeAflTradeJson(reconstructed) !==
      canonicalizeAflTradeJson(projectedFieldMap)
    ) {
      throw new Error('Durable HPN projected field-map ancestry failed exact authentication.');
    }
    return projectedFieldMap;
  }

  async loadCurrentForSource(
    input: z.input<typeof currentSourceSelectionSchema>
  ): Promise<AflTradeHpnProjectedFieldMap | null> {
    const source = currentSourceSelectionSchema.parse(input);
    const result = await this.client.query<{ readonly field_map_id: string }>(
      `SELECT map.field_map_id
         FROM outcome_hpn_projected_field_map map
         JOIN outcome_hpn_field_map_candidate candidate
           ON candidate.candidate_id=map.candidate_id
         JOIN outcome_hpn_field_map_review_decision approval
           ON approval.decision_id=map.approval_decision_id
         JOIN outcome_private_reviewed_evaluation_decision evaluation
           ON evaluation.decision_id=
                approval.source_use_assessment_json#>>'{content,evaluationDecisionId}'
          AND evaluation.evidence_bundle_id=
                approval.source_use_assessment_json#>>'{content,evidenceBundleId}'
          AND evaluation.valuation_scope_key=
                approval.source_use_assessment_json#>>'{content,valuationScopeKey}'
          AND evaluation.status='authorized'
         JOIN outcome_private_reviewed_evaluation_head evaluation_head
           ON evaluation_head.decision_id=evaluation.decision_id
          AND evaluation_head.evidence_bundle_id=evaluation.evidence_bundle_id
          AND evaluation_head.valuation_scope_key=evaluation.valuation_scope_key
          AND evaluation_head.status='authorized'
         JOIN outcome_private_reviewed_evidence_bundle evidence_bundle
           ON evidence_bundle.evidence_bundle_id=evaluation.evidence_bundle_id
          AND evidence_bundle.evidence_scope_key=evaluation_head.evidence_scope_key
         JOIN LATERAL (
           SELECT latest.decision_id,latest.decision
             FROM outcome_hpn_field_map_review_decision latest
            WHERE latest.candidate_id=candidate.candidate_id
            ORDER BY latest.registered_at DESC,latest.decision_id DESC LIMIT 1
         ) current_decision ON true
        WHERE map.environment='non_production'
          AND map.competition='AFLM'
          AND map.provider=$1
          AND map.capability_id=$2
          AND map.input_kind=$3
          AND map.source_schema_sha256=$4
          AND map.valid_from_season<=$5
          AND map.valid_through_season>=$5
          AND approval.source_use_assessment_json#>>'{content,rightsArtifactId}'=$6
          AND candidate.candidate_json#>>'{content,providerDecodeMapId}'=$7
          AND approval.source_use_assessment_json#>>'{content,valuationScopeKey}'=$8
          AND approval.source_use_assessment_json#>'{content,reasons}'='[]'::jsonb
          AND evaluation.decision_json#>>'{content,status}'='authorized'
          AND evaluation.decision_json#>>'{content,valuationScopeKey}'=$8
          AND evaluation.decision_json#>>'{content,evidenceBundleId}'=
                evidence_bundle.evidence_bundle_id
          AND evaluation.decision_json#>'{content,permissions,derivedCalculations}'=
                'true'::jsonb
          AND evaluation.decision_json#>'{content,permissions,internalEvaluation}'=
                'true'::jsonb
          AND evaluation.decision_json#>'{content,publicationProhibited}'='true'::jsonb
          AND current_decision.decision_id=approval.decision_id
          AND current_decision.decision='approved'
        ORDER BY map.field_map_id`,
      [
        source.provider,
        source.capabilityId,
        source.inputKind,
        source.sourceSchemaSha256,
        source.seasonYear,
        source.rightsArtifactId,
        source.providerDecodeMapId,
        source.valuationScopeKey,
      ]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('More than one current HPN field map matches the exact source.');
    }
    const fieldMap = await this.loadCurrentExact(result.rows[0]!.field_map_id);
    if (
      fieldMap === null ||
      fieldMap.content.provider !== source.provider ||
      fieldMap.content.capabilityId !== source.capabilityId ||
      fieldMap.content.inputKind !== source.inputKind ||
      fieldMap.content.sourceSchemaSha256 !== source.sourceSchemaSha256 ||
      fieldMap.content.validFromSeason > source.seasonYear ||
      fieldMap.content.validThroughSeason < source.seasonYear
    ) {
      throw new TypeError('The selected HPN field map failed exact source authentication.');
    }
    return fieldMap;
  }
}
