import { z } from 'zod';

import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  loadExactLocalReviewedProviderEvidenceBundle,
  LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY,
} from '../development/localReviewedProviderEvidence';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
  type AflTradePrivateReviewedEvidenceBundle,
  type AflTradePrivateReviewedEvidenceEvaluationAdmission,
  type AflTradePrivateReviewedEvidenceEvaluationDecision,
} from './privateReviewedEvidenceEvaluation';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const instantSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);

export class AflTradePrivateReviewedEvidenceEvaluationPersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'EVIDENCE_MISMATCH' | 'STALE_DECISION' | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePrivateReviewedEvidenceEvaluationPersistenceError';
  }
}

export interface RecordAflTradePrivateReviewedEvidenceEvaluationDecisionInput {
  readonly status: 'authorized' | 'withdrawn';
  readonly valuationScopeKey: string;
  readonly expectedCurrentDecisionId: string | null;
  readonly reviewerId: string;
  readonly rationale: string;
}

export type AflTradePrivateReviewedEvidenceEvaluationAssessment =
  | { readonly state: 'not_authorized'; readonly decision: null }
  | {
      readonly state: 'authorized' | 'withdrawn';
      readonly decision: AflTradePrivateReviewedEvidenceEvaluationDecision;
    };

interface BundleRow extends Record<string, unknown> {
  evidence_bundle_id: string;
  evidence_scope_key: string;
  candidate_count: number | string;
  decision_count: number | string;
  source_capture_count: number | string;
  source_rights_count: number | string;
  created_at: Date | string;
  bundle_json: unknown;
}

interface DecisionRow extends Record<string, unknown> {
  decision_id: string;
  valuation_scope_key: string;
  evidence_bundle_id: string;
  status: string;
  revision: number | string;
  decision_json: unknown;
  bundle_json: unknown;
}

interface CurrentDecision {
  decision: AflTradePrivateReviewedEvidenceEvaluationDecision;
  bundle: AflTradePrivateReviewedEvidenceBundle;
}

type LoadCurrentEvidence = typeof loadExactLocalReviewedProviderEvidenceBundle;

function isoTimestamp(value: Date | string): string {
  return new Date(instantSchema.parse(value)).toISOString();
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function exactEvidenceWithoutBundleTime(
  left: AflTradePrivateReviewedEvidenceBundle,
  right: AflTradePrivateReviewedEvidenceBundle
): boolean {
  const { createdAt: _leftCreatedAt, ...leftEvidence } = left.content;
  const { createdAt: _rightCreatedAt, ...rightEvidence } = right.content;
  return exactJson(leftEvidence, rightEvidence);
}

function isExactResultsSuccessor(
  current: AflTradePrivateReviewedEvidenceBundle,
  successor: AflTradePrivateReviewedEvidenceBundle
): boolean {
  const currentCaptures = current.content.sourceCaptures.map((capture) =>
    canonicalizeAflTradeJson(capture)
  );
  const currentRights = current.content.sourceRightsEvidenceRefs.map((reference) =>
    canonicalizeAflTradeJson(reference)
  );
  const addedCaptures = successor.content.sourceCaptures.filter(
    (capture) => !currentCaptures.includes(canonicalizeAflTradeJson(capture))
  );
  const addedRights = successor.content.sourceRightsEvidenceRefs.filter(
    (reference) => !currentRights.includes(canonicalizeAflTradeJson(reference))
  );
  return (
    current.content.sourceCaptures.length === 6 &&
    current.content.sourceRightsEvidenceRefs.length === 2 &&
    successor.content.sourceCaptures.length === 7 &&
    successor.content.sourceRightsEvidenceRefs.length === 3 &&
    successor.content.candidateCount === current.content.candidateCount &&
    successor.content.decisionCount === current.content.decisionCount &&
    exactJson(successor.content.reviewSets, current.content.reviewSets) &&
    currentCaptures.every((capture) =>
      successor.content.sourceCaptures.some(
        (candidate) => canonicalizeAflTradeJson(candidate) === capture
      )
    ) &&
    currentRights.every((reference) =>
      successor.content.sourceRightsEvidenceRefs.some(
        (candidate) => canonicalizeAflTradeJson(candidate) === reference
      )
    ) &&
    addedCaptures.length === 1 &&
    addedCaptures[0]?.provider === 'afl_tables' &&
    addedCaptures[0]?.capabilityId === 'afl-tables-results' &&
    addedCaptures[0]?.seasonYear === 2026 &&
    addedRights.length === 1
  );
}

function assertBundleRow(row: BundleRow, bundle: AflTradePrivateReviewedEvidenceBundle): void {
  if (
    bundle.evidenceBundleId !== row.evidence_bundle_id ||
    bundle.content.evidenceScopeKey !== row.evidence_scope_key ||
    bundle.content.candidateCount !== Number(row.candidate_count) ||
    bundle.content.decisionCount !== Number(row.decision_count) ||
    bundle.content.sourceCaptures.length !== Number(row.source_capture_count) ||
    bundle.content.sourceRightsEvidenceRefs.length !== Number(row.source_rights_count) ||
    bundle.content.createdAt !== isoTimestamp(row.created_at)
  ) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The retained reviewed-evidence bundle row disagrees with its exact artifact.'
    );
  }
}

async function loadCurrentFrom(
  transaction: AflOutcomeSqlTransaction,
  valuationScopeKey: string,
  lock: boolean
): Promise<CurrentDecision | null> {
  const result = await transaction.query<DecisionRow>(
    `SELECT decision.decision_id,decision.valuation_scope_key,
            decision.evidence_bundle_id,decision.status,decision.revision,
            decision.decision_json,bundle.bundle_json
       FROM outcome_private_reviewed_evaluation_head head
       JOIN outcome_private_reviewed_evaluation_decision decision
         ON decision.decision_id=head.decision_id
       JOIN outcome_private_reviewed_evidence_bundle bundle
         ON bundle.evidence_bundle_id=head.evidence_bundle_id
      WHERE head.valuation_scope_key=$1 AND head.evidence_scope_key=$2
      ${lock ? 'FOR UPDATE OF head' : 'FOR KEY SHARE OF decision,bundle'}`,
    [valuationScopeKey, LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The private reviewed-evidence evaluation head is ambiguous.'
    );
  }
  const decision = parseAflTradePrivateReviewedEvidenceEvaluationDecision(row.decision_json);
  const bundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(row.bundle_json);
  if (
    decision.decisionId !== row.decision_id ||
    decision.content.valuationScopeKey !== row.valuation_scope_key ||
    decision.content.evidenceBundleId !== row.evidence_bundle_id ||
    decision.content.status !== row.status ||
    decision.content.revision !== Number(row.revision) ||
    bundle.evidenceBundleId !== row.evidence_bundle_id
  ) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The private reviewed-evidence head disagrees with its exact decision and bundle.'
    );
  }
  return { decision, bundle };
}

async function loadBundleRow(
  transaction: AflOutcomeSqlTransaction,
  evidenceBundleId: string
): Promise<BundleRow> {
  const result = await transaction.query<BundleRow>(
    `SELECT evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
            source_capture_count,source_rights_count,created_at,bundle_json
       FROM outcome_private_reviewed_evidence_bundle
      WHERE evidence_bundle_id=$1 FOR KEY SHARE`,
    [evidenceBundleId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The exact retained reviewed-evidence bundle is unavailable.'
    );
  }
  return row;
}

async function requireCurrentEvidence(
  transaction: AflOutcomeSqlTransaction,
  bundle: AflTradePrivateReviewedEvidenceBundle,
  loadCurrentEvidence: LoadCurrentEvidence
): Promise<void> {
  let current: AflTradePrivateReviewedEvidenceBundle;
  try {
    current = await loadCurrentEvidence(transaction, bundle.content.createdAt);
  } catch (error) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'EVIDENCE_MISMATCH',
      error instanceof Error ? error.message : 'Retained reviewed evidence is not current.'
    );
  }
  if (!exactJson(current, bundle)) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'EVIDENCE_MISMATCH',
      'The private calculation authority no longer matches the exact retained review evidence.'
    );
  }
}

async function persistBundle(
  transaction: AflOutcomeSqlTransaction,
  bundle: AflTradePrivateReviewedEvidenceBundle
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_private_reviewed_evidence_bundle
      (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
       source_capture_count,source_rights_count,created_at,bundle_sha256,
       bundle_content_canonical_json,bundle_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      bundle.evidenceBundleId,
      bundle.content.evidenceScopeKey,
      bundle.content.candidateCount,
      bundle.content.decisionCount,
      bundle.content.sourceCaptures.length,
      bundle.content.sourceRightsEvidenceRefs.length,
      bundle.content.createdAt,
      sha256AflTradeCanonicalJson(bundle.content),
      canonicalizeAflTradeJson(bundle.content),
      canonicalizeAflTradeJson(bundle),
    ]
  );
  const row = await loadBundleRow(transaction, bundle.evidenceBundleId);
  const retained = aflTradePrivateReviewedEvidenceBundleSchema.parse(row.bundle_json);
  assertBundleRow(row, retained);
  if (!exactJson(retained, bundle)) {
    throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
      'IMMUTABLE_CONFLICT',
      'The reviewed-evidence bundle did not replay exactly after registration.'
    );
  }
}

async function resolveDecisionBundle(
  transaction: AflOutcomeSqlTransaction,
  current: CurrentDecision | null,
  status: RecordAflTradePrivateReviewedEvidenceEvaluationDecisionInput['status'],
  decidedAt: string,
  loadCurrentEvidence: LoadCurrentEvidence
): Promise<AflTradePrivateReviewedEvidenceBundle> {
  if (current?.decision.content.status === status) {
    if (status !== 'authorized') {
      throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
        'INVALID_INPUT',
        'A private reviewed-evidence decision must change the current authority state.'
      );
    }
    const successor = await loadCurrentEvidence(transaction, decidedAt);
    if (exactEvidenceWithoutBundleTime(current.bundle, successor)) {
      throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
        'INVALID_INPUT',
        'The exact reviewed-evidence authority is already current.'
      );
    }
    if (!isExactResultsSuccessor(current.bundle, successor)) {
      throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
        'EVIDENCE_MISMATCH',
        'Reviewed evidence may advance only by the exact AFL Tables results successor.'
      );
    }
    await persistBundle(transaction, successor);
    return successor;
  }
  if (current === null) {
    const initial = await loadCurrentEvidence(transaction, decidedAt);
    await persistBundle(transaction, initial);
    return initial;
  }
  await requireCurrentEvidence(transaction, current.bundle, loadCurrentEvidence);
  return current.bundle;
}

export class PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority {
  private readonly loadCurrentEvidence: LoadCurrentEvidence;

  constructor(
    private readonly client: AflOutcomeSqlClient,
    dependencies: { readonly loadCurrentEvidence?: LoadCurrentEvidence } = {}
  ) {
    this.loadCurrentEvidence =
      dependencies.loadCurrentEvidence ?? loadExactLocalReviewedProviderEvidenceBundle;
  }

  async recordDecision(
    input: RecordAflTradePrivateReviewedEvidenceEvaluationDecisionInput
  ): Promise<AflTradePrivateReviewedEvidenceEvaluationDecision> {
    let valuationScopeKey: string;
    let reviewerId: string;
    let rationale: string;
    try {
      valuationScopeKey = publicIdSchema.parse(input.valuationScopeKey);
      reviewerId = publicIdSchema.parse(input.reviewerId);
      rationale = z.string().trim().min(1).max(2_000).parse(input.rationale);
      z.enum(['authorized', 'withdrawn']).parse(input.status);
    } catch (error) {
      throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Private reviewed-evidence input is invalid.'
      );
    }

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-reviewed-evaluation:${valuationScopeKey}:${LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY}`,
      ]);
      const current = await loadCurrentFrom(transaction, valuationScopeKey, true);
      if ((current?.decision.decisionId ?? null) !== input.expectedCurrentDecisionId) {
        throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
          'STALE_DECISION',
          'The private reviewed-evidence decision changed before this write.'
        );
      }
      if (!current && input.status === 'withdrawn') {
        throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
          'INVALID_INPUT',
          'A private reviewed-evidence decision must change the current authority state.'
        );
      }
      const clock = await transaction.query<{ decided_at: Date | string }>(
        `SELECT transaction_timestamp()::timestamptz(3) AS decided_at`
      );
      const decidedAt = isoTimestamp(clock.rows[0]!.decided_at);
      const bundle = await resolveDecisionBundle(
        transaction,
        current,
        input.status,
        decidedAt,
        this.loadCurrentEvidence
      );

      const decision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
        status: input.status,
        valuationScopeKey,
        evidenceBundle: bundle,
        evidenceBundleArtifact: createAflTradeCanonicalJsonArtifactRef(
          bundle,
          bundle.content.createdAt
        ),
        revision: (current?.decision.content.revision ?? 0) + 1,
        supersedesDecisionId: current?.decision.decisionId ?? null,
        reviewerId,
        rationale,
        decidedAt,
      });
      await transaction.query(
        `INSERT INTO outcome_private_reviewed_evaluation_decision
          (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
           supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
           decision_content_canonical_json,decision_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          decision.decisionId,
          valuationScopeKey,
          bundle.evidenceBundleId,
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
        LOCAL_REVIEWED_PROVIDER_EVIDENCE_SCOPE_KEY,
        decision.content.revision,
        decision.decisionId,
        bundle.evidenceBundleId,
        decision.content.status,
        decidedAt,
      ];
      await transaction.query(
        current === null
          ? `INSERT INTO outcome_private_reviewed_evaluation_head
              (valuation_scope_key,evidence_scope_key,revision,decision_id,
               evidence_bundle_id,status,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`
          : `UPDATE outcome_private_reviewed_evaluation_head
                SET revision=$3,decision_id=$4,evidence_bundle_id=$5,status=$6,updated_at=$7
              WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
        headValues
      );
      const retained = await loadCurrentFrom(transaction, valuationScopeKey, false);
      if (!retained || !exactJson(retained.decision, decision)) {
        throw new AflTradePrivateReviewedEvidenceEvaluationPersistenceError(
          'IMMUTABLE_CONFLICT',
          'The private reviewed-evidence decision did not replay exactly.'
        );
      }
      await requireCurrentEvidence(transaction, retained.bundle, this.loadCurrentEvidence);
      return retained.decision;
    });
  }

  async assessCurrent(input: {
    readonly valuationScopeKey: string;
  }): Promise<AflTradePrivateReviewedEvidenceEvaluationAssessment> {
    const valuationScopeKey = publicIdSchema.parse(input.valuationScopeKey);
    return this.client.transaction(async (transaction) => {
      const current = await loadCurrentFrom(transaction, valuationScopeKey, false);
      if (!current) return { state: 'not_authorized', decision: null };
      const row = await loadBundleRow(transaction, current.bundle.evidenceBundleId);
      assertBundleRow(row, current.bundle);
      await requireCurrentEvidence(transaction, current.bundle, this.loadCurrentEvidence);
      return { state: current.decision.content.status, decision: current.decision };
    });
  }

  async admitCalculation(input: {
    readonly valuationScopeKey: string;
  }): Promise<AflTradePrivateReviewedEvidenceEvaluationAdmission> {
    const assessment = await this.assessCurrent(input);
    return createAflTradePrivateReviewedEvidenceEvaluationAdmission(assessment.decision);
  }
}
