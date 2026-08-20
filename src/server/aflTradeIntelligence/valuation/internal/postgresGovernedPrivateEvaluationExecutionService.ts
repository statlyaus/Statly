import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import { authenticateGovernedPrivateEvaluationAuthorityInspection } from './governedPrivateEvaluationAuthoritySnapshot';
import {
  createGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionReceipt,
  governedPrivateEvaluationTransitionReceiptSchema,
  type GovernedPrivateEvaluationTransitionIntent,
  type GovernedPrivateEvaluationTransitionReceipt,
} from './governedPrivateEvaluationLifecycle';
import {
  governedPrivateEvaluationExecuteRequestSchema,
  governedPrivateEvaluationExecuteResultSchema,
  type GovernedPrivateEvaluationExecuteRequest,
} from './governedPrivateEvaluationWorkspaceContracts';

interface InspectionRow {
  readonly receipt_json: unknown;
  readonly snapshot_json: unknown;
}

interface ExistingRow {
  readonly receipt_json: unknown;
}

interface TrustedTimeRow {
  readonly trusted_at: Date | string;
}

interface WithdrawalRow {
  readonly from_generation_id: string | null;
}

interface OperatorAuthorityRow {
  readonly authority_evidence_id: string;
}

interface StagingDependency {
  stage(input: {
    readonly intent: GovernedPrivateEvaluationTransitionIntent;
    readonly intentArtifact: AflTradeArtifactRef;
  }): Promise<unknown>;
  retainArtifact(input: {
    readonly reference: AflTradeArtifactRef;
    readonly bytes: Uint8Array;
  }): Promise<AflTradeArtifactRef>;
}

interface LifecycleDependency {
  commit(input: {
    readonly receipt: GovernedPrivateEvaluationTransitionReceipt;
    readonly receiptArtifact: AflTradeArtifactRef;
  }): Promise<
    | {
        readonly state: 'committed' | 'replayed';
        readonly head: GovernedPrivateEvaluationTransitionReceipt['content']['toHead'];
        readonly transitionId: string;
      }
    | {
        readonly state: 'conflict';
        readonly expectedHead: GovernedPrivateEvaluationTransitionReceipt['content']['fromHead'];
        readonly actualHead: GovernedPrivateEvaluationTransitionReceipt['content']['fromHead'];
      }
  >;
}

interface ReconstructionDependency {
  verify(input: {
    readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
    readonly inspectionId: string;
    readonly operationId: string;
    readonly generationId: string;
  }): Promise<{ readonly generationId: string; readonly exactMatch: true }>;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function parseTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation execution requires trusted PostgreSQL time.');
  }
  return parsed.toISOString();
}

function transitionResult(
  receipt: GovernedPrivateEvaluationTransitionReceipt,
  operationId: string
) {
  const base = {
    selector: receipt.content.selector,
    inspectionId: receipt.content.intent.content.inspectionId,
    operationId,
  };
  if (receipt.content.action.kind === 'withdraw') {
    return governedPrivateEvaluationExecuteResultSchema.parse({
      state: 'withdrawn',
      ...base,
      head: receipt.content.toHead,
    });
  }
  const state =
    receipt.content.action.kind === 'rollback'
      ? 'rolled_back'
      : receipt.content.action.kind === 'recover'
        ? 'recovered'
        : 'activated';
  return governedPrivateEvaluationExecuteResultSchema.parse({
    state,
    ...base,
    generationId: receipt.content.toHead.generationId,
    head: receipt.content.toHead,
  });
}

async function resolveRecoveryGeneration(input: {
  readonly client: AflOutcomeSqlClient;
  readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
  readonly withdrawnRevision: number;
  readonly withdrawalTransitionId: string | null;
}): Promise<string | null> {
  if (input.withdrawalTransitionId === null) return null;
  const result = await input.client.query<WithdrawalRow>(
    `SELECT from_generation_id
       FROM outcome_private_evaluation_transition_receipt
      WHERE transition_id=$1 AND valuation_scope_key=$2 AND trade_id=$3
        AND action='withdraw' AND to_status='withdrawn' AND to_revision=$4`,
    [
      input.withdrawalTransitionId,
      input.selector.valuationScopeKey,
      input.selector.tradeId,
      input.withdrawnRevision,
    ]
  );
  if (result.rows.length !== 1) return null;
  return result.rows[0]?.from_generation_id ?? null;
}

async function requireCurrentOperatorAuthority(input: {
  readonly client: AflOutcomeSqlClient;
  readonly principalId: string;
  readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
  readonly authorizedAt: string;
}): Promise<void> {
  const result = await input.client.query<OperatorAuthorityRow>(
    `SELECT authority.authority_evidence_id
       FROM outcome_operational_principal_authority authority
       JOIN outcome_governed_evidence_reference evidence
         ON evidence.reference_id=authority.authority_evidence_id
       JOIN outcome_review_decision approval
         ON approval.decision_id=evidence.approval_decision_id
      WHERE authority.principal_ref=$1
        AND authority.role='afl_trade_private_evaluation_operator'
        AND authority.scope_key=$2
        AND authority.provider='statly_modeling'
        AND authority.capability_id='manage_private_trade_evaluation'
        AND authority.competition='AFLM'
        AND authority.valid_from<=$3::timestamptz
        AND (authority.valid_through IS NULL OR authority.valid_through>$3::timestamptz)
        AND evidence.environment='test_fixture'::"OutcomeEnvironment"
        AND evidence.status='approved'::"OutcomeRecordStatus"
        AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=approval.decision_id)
      FOR SHARE OF authority,evidence,approval`,
    [input.principalId, input.selector.valuationScopeKey, input.authorizedAt]
  );
  if (
    result.rows.length !== 1 ||
    !result.rows[0]?.authority_evidence_id.startsWith('reviewer-authority-evidence:')
  ) {
    throw new TypeError(
      'Private evaluation execution requires current governed operator authority for the exact scope.'
    );
  }
}

export function createPostgresGovernedPrivateEvaluationExecutionService(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly principalId: string;
  readonly staging: StagingDependency;
  readonly lifecycle: LifecycleDependency;
  readonly reconstruction: ReconstructionDependency;
}) {
  if (dependencies.principalId.trim() === '' || dependencies.principalId.length > 400) {
    throw new TypeError('Private evaluation execution requires an authenticated principal.');
  }
  return {
    async execute(unparsedRequest: GovernedPrivateEvaluationExecuteRequest) {
      const request = governedPrivateEvaluationExecuteRequestSchema.parse(unparsedRequest);
      const existing = await dependencies.client.query<ExistingRow>(
        `SELECT receipt_json
           FROM outcome_private_evaluation_transition_receipt
          WHERE operation_id=$1`,
        [request.operationId]
      );
      if (existing.rows.length > 1) {
        throw new TypeError('Private evaluation operation identity is not unique.');
      }
      if (existing.rows[0] !== undefined) {
        const receipt = governedPrivateEvaluationTransitionReceiptSchema.parse(
          existing.rows[0].receipt_json
        );
        const intent = receipt.content.intent.content;
        if (
          intent.inspectionId !== request.inspectionId ||
          intent.operationId !== request.operationId ||
          intent.review.principalId !== dependencies.principalId ||
          intent.review.rationale !== request.review.rationale ||
          !same(intent.action, request.action)
        ) {
          throw new TypeError('Private evaluation operation replay conflicts with its request.');
        }
        return transitionResult(receipt, request.operationId);
      }
      const inspectionResult = await dependencies.client.query<InspectionRow>(
        `SELECT ir.receipt_json,snapshot.snapshot_json
           FROM outcome_private_evaluation_inspection_receipt ir
           JOIN outcome_private_evaluation_authority_snapshot snapshot
             ON snapshot.snapshot_id=ir.snapshot_id
            AND snapshot.valuation_scope_key=ir.valuation_scope_key
            AND snapshot.trade_id=ir.trade_id
          WHERE ir.inspection_id=$1`,
        [request.inspectionId]
      );
      if (inspectionResult.rows.length !== 1) {
        throw new TypeError('Private evaluation execution requires one retained inspection.');
      }
      const row = inspectionResult.rows[0]!;
      const retained = authenticateGovernedPrivateEvaluationAuthorityInspection({
        snapshot: row.snapshot_json,
        inspection: row.receipt_json,
      });
      const trusted = await dependencies.client.query<TrustedTimeRow>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
      );
      if (trusted.rows.length !== 1 || trusted.rows[0] === undefined) {
        throw new TypeError('Private evaluation execution could not establish trusted time.');
      }
      const requestedAt = parseTime(trusted.rows[0].trusted_at);
      if (Date.parse(requestedAt) > Date.parse(retained.result.validThrough)) {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          selector: retained.result.selector,
          inspectionId: request.inspectionId,
          operationId: request.operationId,
          message: 'The retained inspection has expired; inspect again.',
        });
      }
      await requireCurrentOperatorAuthority({
        client: dependencies.client,
        principalId: dependencies.principalId,
        selector: retained.result.selector,
        authorizedAt: requestedAt,
      });
      const base = {
        selector: retained.result.selector,
        inspectionId: request.inspectionId,
        operationId: request.operationId,
      };
      if (request.action.kind === 'verify_reconstruction') {
        const verification = await dependencies.reconstruction.verify({
          selector: retained.result.selector,
          inspectionId: request.inspectionId,
          operationId: request.operationId,
          generationId: request.action.generationId,
        });
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'reconstruction_verified',
          ...base,
          generationId: verification.generationId,
          exactMatch: verification.exactMatch,
        });
      }
      if (request.action.kind === 'construct_and_activate') {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'unavailable',
          ...base,
          blockers: retained.result.blockers,
        });
      }
      if (
        (request.action.kind === 'rollback' || request.action.kind === 'recover') &&
        retained.result.state !== 'ready'
      ) {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          ...base,
          message: 'Rollback and recovery require exact ready calculation authority.',
        });
      }
      if (
        request.action.kind === 'withdraw' &&
        retained.result.head.status !== 'active'
      ) {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          ...base,
          message: 'Withdrawal requires one exact active generation.',
        });
      }
      if (
        request.action.kind === 'rollback' &&
        (retained.result.head.status !== 'active' ||
          retained.result.head.generationId === request.action.targetGenerationId)
      ) {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          ...base,
          message: 'Rollback requires a different retained generation from one exact active head.',
        });
      }
      if (request.action.kind === 'recover' && retained.result.head.status !== 'withdrawn') {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          ...base,
          message: 'Recovery requires one exact withdrawn head.',
        });
      }
      const targetGenerationId =
        request.action.kind === 'rollback'
          ? request.action.targetGenerationId
          : request.action.kind === 'recover'
            ? await resolveRecoveryGeneration({
                client: dependencies.client,
                selector: retained.result.selector,
                withdrawnRevision: retained.result.head.revision,
                withdrawalTransitionId: retained.inspection.content.lastTransitionId,
              })
            : null;
      if (
        (request.action.kind === 'rollback' || request.action.kind === 'recover') &&
        targetGenerationId === null
      ) {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'invalid_transition',
          ...base,
          message: 'The exact lifecycle target generation could not be authenticated.',
        });
      }
      if (targetGenerationId !== null) {
        await dependencies.reconstruction.verify({
          selector: retained.result.selector,
          inspectionId: request.inspectionId,
          operationId: request.operationId,
          generationId: targetGenerationId,
        });
      }
      const intent = createGovernedPrivateEvaluationTransitionIntent({
        selector: retained.result.selector,
        inspectionId: request.inspectionId,
        authoritySnapshotId:
          request.action.kind === 'withdraw' ? null : retained.snapshot.snapshotId,
        operationId: request.operationId,
        action: request.action,
        expectedHead: retained.result.head,
        review: {
          principalId: dependencies.principalId,
          rationale: request.review.rationale,
        },
        requestedAt,
        expiresAt: retained.result.validThrough,
      });
      const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, requestedAt);
      await dependencies.staging.stage({ intent, intentArtifact });
      const receipt = createGovernedPrivateEvaluationTransitionReceipt({
        intent,
        previousTransitionId: retained.inspection.content.lastTransitionId,
        toGenerationId: targetGenerationId,
        transitionedAt: requestedAt,
      });
      const receiptArtifact = createAflTradeCanonicalJsonArtifactRef(receipt, requestedAt);
      await dependencies.staging.retainArtifact({
        reference: receiptArtifact,
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(receipt)),
      });
      const committed = await dependencies.lifecycle.commit({ receipt, receiptArtifact });
      if (committed.state === 'conflict') {
        return governedPrivateEvaluationExecuteResultSchema.parse({
          state: 'conflict',
          ...base,
          message: 'The lifecycle head changed after inspection; inspect again.',
        });
      }
      return transitionResult(receipt, request.operationId);
    },
  };
}
