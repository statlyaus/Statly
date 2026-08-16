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
}
