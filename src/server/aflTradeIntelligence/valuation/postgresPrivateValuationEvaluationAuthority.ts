import { z } from 'zod';

import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  createAflTradePrivateValuationEvaluationAdmission,
  type AflTradePrivateValuationEvaluationAdmission,
} from './privateValuationEvaluationAdmission';
import {
  createAflTradePrivateValuationEvaluationDecision,
  parseAflTradePrivateValuationEvaluationDecision,
  type AflTradePrivateValuationEvaluationDecision,
} from './privateValuationEvaluationDecision';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const instantSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const releaseManifestSchema = z
  .object({
    releaseId: publicIdSchema,
    content: z
      .object({
        canonicalMembers: z.array(z.unknown()).min(1).max(1_000_000),
        sourceCaptures: z
          .array(z.object({ rightsArtifactId: publicIdSchema }).passthrough())
          .min(1)
          .max(1_000),
      })
      .passthrough(),
  })
  .passthrough();

export class AflTradePrivateValuationEvaluationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'RELEASE_MISMATCH'
      | 'SOURCE_MISMATCH'
      | 'STALE_DECISION'
      | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePrivateValuationEvaluationPersistenceError';
  }
}

export interface RecordAflTradePrivateValuationEvaluationDecisionInput {
  readonly status: 'authorized' | 'withdrawn';
  readonly valuationScopeKey: string;
  readonly factualReleaseId: string;
  readonly expectedCurrentDecisionId: string | null;
  readonly reviewerId: string;
  readonly rationale: string;
}

export type AflTradePrivateValuationEvaluationAssessment =
  | { readonly state: 'not_authorized'; readonly decision: null }
  | {
      readonly state: 'authorized' | 'withdrawn';
      readonly decision: AflTradePrivateValuationEvaluationDecision;
    };

interface ReleaseRow extends Record<string, unknown> {
  release_id: string;
  scope_key: string;
  environment: string;
  created_at: Date | string;
  manifest_json: unknown;
}

interface SourceRightsRow extends Record<string, unknown> {
  rights_artifact_id: string;
  proposed_at: Date | string;
  content_json: unknown;
}

interface DecisionRow extends Record<string, unknown> {
  decision_id: string;
  valuation_scope_key: string;
  factual_release_id: string;
  status: string;
  revision: number | string;
  decision_json: unknown;
}

interface ExactReleaseEvidence {
  factualReleaseScopeKey: string;
  factualReleaseId: string;
  factualReleaseArtifact: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
  releaseMembershipArtifact: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
  sourceRightsEvidenceRefs: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>[];
}

function isoTimestamp(value: Date | string): string {
  const parsed = instantSchema.parse(value);
  return new Date(parsed).toISOString();
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

async function loadExactReleaseEvidence(
  transaction: AflOutcomeSqlTransaction,
  factualReleaseId: string
): Promise<ExactReleaseEvidence> {
  const releaseResult = await transaction.query<ReleaseRow>(
    `SELECT release_id,scope_key,environment,created_at,manifest_json
       FROM outcome_release_manifest WHERE release_id=$1 FOR KEY SHARE`,
    [factualReleaseId]
  );
  const releaseRow = releaseResult.rows[0];
  if (
    releaseResult.rows.length !== 1 ||
    !releaseRow ||
    releaseRow.environment !== 'non_production'
  ) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'RELEASE_MISMATCH',
      'Private valuation evaluation requires one exact non-production factual release.'
    );
  }
  const manifest = releaseManifestSchema.parse(releaseRow.manifest_json);
  if (manifest.releaseId !== releaseRow.release_id) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'RELEASE_MISMATCH',
      'The factual release row and immutable manifest identities disagree.'
    );
  }
  const rightsArtifactIds = [
    ...new Set(manifest.content.sourceCaptures.map(({ rightsArtifactId }) => rightsArtifactId)),
  ].sort();
  if (rightsArtifactIds.length === 0) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'SOURCE_MISMATCH',
      'The factual release has no exact retained source-rights ancestry.'
    );
  }
  const rightsResult = await transaction.query<SourceRightsRow>(
    `SELECT rights_artifact_id,proposed_at,content_json
       FROM outcome_source_rights_proposal
      WHERE rights_artifact_id=ANY($1::text[])
      ORDER BY rights_artifact_id FOR KEY SHARE`,
    [rightsArtifactIds]
  );
  if (
    rightsResult.rows.length !== rightsArtifactIds.length ||
    rightsResult.rows.some(
      ({ rights_artifact_id }, index) => rights_artifact_id !== rightsArtifactIds[index]
    )
  ) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'SOURCE_MISMATCH',
      'The factual release source-rights ancestry is incomplete.'
    );
  }
  const sourceRightsEvidenceRefs = rightsResult.rows
    .map((row) => {
      const rights = aflTradeSourceRightsProposalSchema.parse(row.content_json);
      if (
        rights.rightsArtifactId !== row.rights_artifact_id ||
        rights.content.proposedAt !== isoTimestamp(row.proposed_at)
      ) {
        throw new AflTradePrivateValuationEvaluationPersistenceError(
          'SOURCE_MISMATCH',
          'A retained source-rights row disagrees with its immutable proposal.'
        );
      }
      return createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt);
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const createdAt = isoTimestamp(releaseRow.created_at);
  return {
    factualReleaseScopeKey: publicIdSchema.parse(releaseRow.scope_key),
    factualReleaseId: releaseRow.release_id,
    factualReleaseArtifact: createAflTradeCanonicalJsonArtifactRef(manifest, createdAt),
    releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
      manifest.content.canonicalMembers,
      createdAt
    ),
    sourceRightsEvidenceRefs,
  };
}

async function loadCurrentFrom(
  transaction: AflOutcomeSqlTransaction,
  input: { valuationScopeKey: string; factualReleaseId: string },
  lock: boolean
): Promise<AflTradePrivateValuationEvaluationDecision | null> {
  const result = await transaction.query<DecisionRow>(
    `SELECT decision.decision_id,decision.valuation_scope_key,
            decision.factual_release_id,decision.status,decision.revision,
            decision.decision_json
       FROM outcome_private_valuation_evaluation_head head
       JOIN outcome_private_valuation_evaluation_decision decision
         ON decision.decision_id=head.decision_id
      WHERE head.valuation_scope_key=$1 AND head.factual_release_id=$2
      ${lock ? 'FOR UPDATE OF head' : 'FOR KEY SHARE OF decision'}`,
    [input.valuationScopeKey, input.factualReleaseId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The private valuation evaluation head is ambiguous.'
    );
  }
  const decision = parseAflTradePrivateValuationEvaluationDecision(row.decision_json);
  if (
    decision.decisionId !== row.decision_id ||
    decision.content.valuationScopeKey !== row.valuation_scope_key ||
    decision.content.factualReleaseId !== row.factual_release_id ||
    decision.content.status !== row.status ||
    decision.content.revision !== Number(row.revision)
  ) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The private valuation evaluation head disagrees with its exact decision.'
    );
  }
  return decision;
}

function requireExactAncestry(
  decision: AflTradePrivateValuationEvaluationDecision,
  evidence: ExactReleaseEvidence
): void {
  if (
    decision.content.factualReleaseScopeKey !== evidence.factualReleaseScopeKey ||
    decision.content.factualReleaseId !== evidence.factualReleaseId ||
    !exactJson(decision.content.factualReleaseArtifact, evidence.factualReleaseArtifact) ||
    !exactJson(decision.content.releaseMembershipArtifact, evidence.releaseMembershipArtifact) ||
    !exactJson(decision.content.sourceRightsEvidenceRefs, evidence.sourceRightsEvidenceRefs)
  ) {
    throw new AflTradePrivateValuationEvaluationPersistenceError(
      'SOURCE_MISMATCH',
      'The private valuation evaluation decision no longer matches exact retained ancestry.'
    );
  }
}

export class PostgresAflTradePrivateValuationEvaluationAuthority {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async recordDecision(
    input: RecordAflTradePrivateValuationEvaluationDecisionInput
  ): Promise<AflTradePrivateValuationEvaluationDecision> {
    let valuationScopeKey: string;
    let factualReleaseId: string;
    let reviewerId: string;
    let rationale: string;
    try {
      valuationScopeKey = publicIdSchema.parse(input.valuationScopeKey);
      factualReleaseId = publicIdSchema.parse(input.factualReleaseId);
      reviewerId = publicIdSchema.parse(input.reviewerId);
      rationale = z.string().trim().min(1).max(2_000).parse(input.rationale);
      z.enum(['authorized', 'withdrawn']).parse(input.status);
    } catch (error) {
      throw new AflTradePrivateValuationEvaluationPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Private valuation decision input is invalid.'
      );
    }

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-valuation-evaluation:${valuationScopeKey}:${factualReleaseId}`,
      ]);
      const evidence = await loadExactReleaseEvidence(transaction, factualReleaseId);
      const current = await loadCurrentFrom(
        transaction,
        { valuationScopeKey, factualReleaseId },
        true
      );
      if ((current?.decisionId ?? null) !== input.expectedCurrentDecisionId) {
        throw new AflTradePrivateValuationEvaluationPersistenceError(
          'STALE_DECISION',
          'The private valuation evaluation decision changed before this write.'
        );
      }
      if ((!current && input.status === 'withdrawn') || current?.content.status === input.status) {
        throw new AflTradePrivateValuationEvaluationPersistenceError(
          'INVALID_INPUT',
          'A private valuation evaluation decision must change the current authority state.'
        );
      }
      const clock = await transaction.query<{ decided_at: Date | string }>(
        `SELECT transaction_timestamp()::timestamptz(3) AS decided_at`
      );
      const decidedAt = isoTimestamp(clock.rows[0]!.decided_at);
      const decision = createAflTradePrivateValuationEvaluationDecision({
        status: input.status,
        valuationScopeKey,
        ...evidence,
        revision: (current?.content.revision ?? 0) + 1,
        supersedesDecisionId: current?.decisionId ?? null,
        reviewerId,
        rationale,
        decidedAt,
      });
      await transaction.query(
        `INSERT INTO outcome_private_valuation_evaluation_decision
          (decision_id,valuation_scope_key,factual_release_scope_key,factual_release_id,status,
           revision,supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
           decision_content_canonical_json,decision_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          decision.decisionId,
          valuationScopeKey,
          evidence.factualReleaseScopeKey,
          factualReleaseId,
          decision.content.status,
          decision.content.revision,
          decision.content.supersedesDecisionId,
          reviewerId,
          decidedAt,
          sha256AflTradeCanonicalJson(decision.content),
          canonicalizeAflTradeJson(decision.content),
          canonicalizeAflTradeJson(decision),
        ]
      );
      const headValues = [
        valuationScopeKey,
        factualReleaseId,
        decision.content.revision,
        decision.decisionId,
        decision.content.status,
        decidedAt,
      ];
      await transaction.query(
        current === null
          ? `INSERT INTO outcome_private_valuation_evaluation_head
              (valuation_scope_key,factual_release_id,revision,decision_id,status,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)`
          : `UPDATE outcome_private_valuation_evaluation_head
                SET revision=$3,decision_id=$4,status=$5,updated_at=$6
              WHERE valuation_scope_key=$1 AND factual_release_id=$2`,
        headValues
      );
      const retained = await loadCurrentFrom(
        transaction,
        { valuationScopeKey, factualReleaseId },
        false
      );
      if (!retained || !exactJson(retained, decision)) {
        throw new AflTradePrivateValuationEvaluationPersistenceError(
          'IMMUTABLE_CONFLICT',
          'The private valuation evaluation decision did not replay exactly.'
        );
      }
      requireExactAncestry(retained, evidence);
      return retained;
    });
  }

  async assessCurrent(input: {
    readonly valuationScopeKey: string;
    readonly factualReleaseId: string;
  }): Promise<AflTradePrivateValuationEvaluationAssessment> {
    const valuationScopeKey = publicIdSchema.parse(input.valuationScopeKey);
    const factualReleaseId = publicIdSchema.parse(input.factualReleaseId);
    return this.client.transaction(async (transaction) => {
      const evidence = await loadExactReleaseEvidence(transaction, factualReleaseId);
      const decision = await loadCurrentFrom(
        transaction,
        { valuationScopeKey, factualReleaseId },
        false
      );
      if (!decision) return { state: 'not_authorized', decision: null };
      requireExactAncestry(decision, evidence);
      return { state: decision.content.status, decision };
    });
  }

  async admitCalculation(input: {
    readonly valuationScopeKey: string;
    readonly factualReleaseId: string;
  }): Promise<AflTradePrivateValuationEvaluationAdmission> {
    const assessment = await this.assessCurrent(input);
    return createAflTradePrivateValuationEvaluationAdmission(assessment.decision);
  }
}
