import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  privateEvaluationAuthoritySnapshotSchema,
  privateEvaluationExecutionCommandSchema,
  privateEvaluationInspectionReceiptSchema,
  type GovernedPrivateEvaluationSelector,
  type PrivateEvaluationExecutionResult,
  type PrivateEvaluationExecutionStore,
  type PrivateEvaluationHeadGuard,
  type PrivateEvaluationInspectionStore,
} from './governedPrivateTradeEvaluationContracts';
import {
  localPrivateTradeEvaluationGenerationV3Schema,
  type LocalPrivateTradeEvaluationGenerationV3,
} from './localPrivateTradeEvaluationGenerationV3';
import type { AflTradeAuthenticatedPrivateValuationAuthorityV3Chain } from './postgresPrivateValuationAuthorityV3Registry';
import type { PostgresPrivateEvaluationAuthorityAuthentication } from './postgresPrivateEvaluationAuthorityInspector';
import { retainPrivateEvaluationAuthorityEvidence } from './postgresPrivateEvaluationInspectionStore';
import {
  createPrivateEvaluationTransitionIntent,
  createPrivateEvaluationTransitionReceipt,
  privateEvaluationTransitionIntentSchema,
  privateEvaluationTransitionReceiptSchema,
  type PrivateEvaluationTransitionIntent,
  type PrivateEvaluationTransitionReceipt,
} from './privateEvaluationTransitionContracts';

interface RetainedJsonRow {
  readonly document_json: unknown;
  readonly artifact_json: unknown;
}

interface HeadRow {
  readonly generation_id: string | null;
  readonly revision: number | string;
  readonly status: 'active' | 'withdrawn';
  readonly transition_receipt_id: string | null;
}

interface RollbackTargetRow {
  readonly generation_json: unknown;
  readonly artifact_json: unknown;
  readonly was_active: boolean;
}

export interface LockedPrivateEvaluationHead {
  readonly head: PrivateEvaluationHeadGuard;
  readonly latestReceiptId: string | null;
}

export interface PostgresPrivateEvaluationExecutionPersistence {
  retainIntent(
    transaction: AflOutcomeSqlTransaction,
    input: {
      readonly intent: PrivateEvaluationTransitionIntent;
      readonly artifact: AflTradeArtifactRef;
    }
  ): Promise<void>;
  loadHeadForUpdate(
    transaction: AflOutcomeSqlTransaction,
    selector: GovernedPrivateEvaluationSelector
  ): Promise<LockedPrivateEvaluationHead>;
  loadRollbackTarget(
    transaction: AflOutcomeSqlTransaction,
    selector: GovernedPrivateEvaluationSelector,
    generationId: string
  ): Promise<{
    readonly generation: LocalPrivateTradeEvaluationGenerationV3;
    readonly artifact: AflTradeArtifactRef;
    readonly wasActive: boolean;
  } | null>;
  commitTransition(
    transaction: AflOutcomeSqlTransaction,
    input: {
      readonly intent: PrivateEvaluationTransitionIntent;
      readonly generation: LocalPrivateTradeEvaluationGenerationV3 | null;
      readonly receipt: PrivateEvaluationTransitionReceipt;
      readonly receiptArtifact: AflTradeArtifactRef;
    }
  ): Promise<void>;
}

export interface PrivateEvaluationAuthenticatedConstructionStrategy {
  (input: {
    readonly chain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain;
    readonly authoritySnapshot: ReturnType<typeof privateEvaluationAuthoritySnapshotSchema.parse>;
    readonly inspectionReceipt: ReturnType<typeof privateEvaluationInspectionReceiptSchema.parse>;
    readonly transitionIntent: PrivateEvaluationTransitionIntent;
    readonly constructedAt: string;
  }): Promise<LocalPrivateTradeEvaluationGenerationV3>;
}

function digest(value: string, prefix: string): string {
  const expected = `${prefix}:`;
  if (!value.startsWith(expected)) throw new TypeError(`Expected one ${prefix} identity.`);
  return value.slice(expected.length);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation execution requires trusted database time.');
  }
  return parsed.toISOString();
}

async function trustedTime(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  if (result.rows.length !== 1 || result.rows[0]?.trusted_at === undefined) {
    throw new TypeError('Private evaluation execution requires one trusted database time.');
  }
  return iso(result.rows[0].trusted_at);
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function retainCanonicalJson(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly value: unknown;
  readonly createdAt: string;
}): Promise<AflTradeArtifactRef> {
  const reference = createAflTradeCanonicalJsonArtifactRef(input.value, input.createdAt);
  await input.repository.putIfAbsent(reference, canonicalBytes(input.value));
  const retained = await input.repository.loadExact(reference, input.maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
    new TextDecoder().decode(retained.bytes) !== canonicalizeAflTradeJson(input.value)
  ) {
    throw new TypeError('Private evaluation execution artifact failed exact readback.');
  }
  return retained.reference;
}

async function requireExactArtifact(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly reference: AflTradeArtifactRef;
  readonly expectedCanonicalJson?: unknown;
}): Promise<void> {
  const reference = aflTradeArtifactRefSchema.parse(input.reference);
  const retained = await input.repository.loadExact(reference, input.maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
    (input.expectedCanonicalJson !== undefined &&
      new TextDecoder().decode(retained.bytes) !==
        canonicalizeAflTradeJson(input.expectedCanonicalJson))
  ) {
    throw new TypeError('Private evaluation dependency failed exact readback.');
  }
}

function completeGeneration(generation: LocalPrivateTradeEvaluationGenerationV3): boolean {
  const views = ['atTrade', 'realized', 'remaining', 'current'] as const;
  return (
    generation.content.assets.every(asset =>
      views.every(view => asset.views[view].state === 'calculated')
    ) &&
    generation.content.clubTotals.every(club =>
      views.every(view => club.views[view].state === 'calculated')
    ) &&
    generation.content.overallGrades.every(grade => grade.state !== 'unavailable') &&
    generation.content.tradeVerdict.state === 'calculated'
  );
}

function conflict(
  selector: GovernedPrivateEvaluationSelector,
  expectedHead: PrivateEvaluationHeadGuard,
  actualHead: PrivateEvaluationHeadGuard,
  message: string
): Extract<PrivateEvaluationExecutionResult, { state: 'conflict' }> {
  return { state: 'conflict', selector, expectedHead, actualHead, message };
}

function canonicalDependencies(
  dependencies: readonly {
    role: string;
    artifact: AflTradeArtifactRef;
  }[]
) {
  return [...dependencies].sort((left, right) =>
    `${left.role}|${left.artifact.artifactId}`.localeCompare(
      `${right.role}|${right.artifact.artifactId}`
    )
  );
}

export function createPostgresPrivateEvaluationExecutionPersistence(): PostgresPrivateEvaluationExecutionPersistence {
  return {
    async retainIntent(transaction, input) {
      const intent = privateEvaluationTransitionIntentSchema.parse(input.intent);
      const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
      const content = intent.content;
      await transaction.query(
        `INSERT INTO outcome_private_evaluation_transition_intent
          (intent_id,valuation_scope_key,trade_id,action,expected_head_generation_id,
           expected_head_revision,expected_head_status,target_generation_id,
           authority_snapshot_id,inspection_receipt_id,reason,operator_principal_id,
           operator_rationale,requested_at,intent_content_sha256,artifact_sha256,
           publication_eligible,publication_prohibited,intent_json,artifact_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,TRUE,$17::jsonb,$18::jsonb)
         ON CONFLICT (intent_id) DO NOTHING`,
        [
          intent.intentId,
          content.selector.valuationScopeKey,
          content.selector.tradeId,
          content.action,
          content.expectedHead.generationId,
          content.expectedHead.revision,
          content.expectedHead.status,
          content.targetGenerationId,
          content.authoritySnapshotId,
          content.inspectionReceiptId,
          content.reason,
          content.operator.principalId,
          content.operator.rationale,
          content.requestedAt,
          digest(intent.intentId, 'private-evaluation-transition-intent'),
          artifact.contentSha256,
          canonicalizeAflTradeJson(intent),
          canonicalizeAflTradeJson(artifact),
        ]
      );
      const retained = await transaction.query<RetainedJsonRow>(
        `SELECT intent_json AS document_json,artifact_json
           FROM outcome_private_evaluation_transition_intent
          WHERE intent_id=$1 FOR KEY SHARE`,
        [intent.intentId]
      );
      if (
        retained.rows.length !== 1 ||
        !same(retained.rows[0]?.document_json, intent) ||
        !same(retained.rows[0]?.artifact_json, artifact)
      ) {
        throw new TypeError('Private evaluation transition intent replay conflicts.');
      }
    },

    async loadHeadForUpdate(transaction, selector) {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `local-private-trade-evaluation-head:${selector.tradeId}`,
      ]);
      const retained = await transaction.query<HeadRow>(
        `SELECT generation_id,revision,status,transition_receipt_id
           FROM outcome_local_private_trade_evaluation_head
          WHERE trade_id=$1 FOR UPDATE`,
        [selector.tradeId]
      );
      if (retained.rows.length === 0) {
        return {
          head: { generationId: null, revision: 0, status: 'absent' },
          latestReceiptId: null,
        };
      }
      const row = retained.rows[0];
      const revision = Number(row?.revision);
      if (
        retained.rows.length !== 1 ||
        !row ||
        !Number.isSafeInteger(revision) ||
        revision <= 0
      ) {
        throw new TypeError('Private evaluation execution head is malformed or ambiguous.');
      }
      return {
        head: {
          generationId: row.generation_id,
          revision,
          status: row.status,
        },
        latestReceiptId: row.transition_receipt_id,
      };
    },

    async loadRollbackTarget(transaction, selector, generationId) {
      const retained = await transaction.query<RollbackTargetRow>(
        `SELECT generation.generation_json,generation.artifact_json,
                EXISTS (
                  SELECT 1
                    FROM outcome_local_private_trade_evaluation_transition transition
                   WHERE transition.trade_id=generation.trade_id
                     AND transition.to_generation_id=generation.generation_id
                     AND transition.action IN ('activate','rollback')
                ) AS was_active
           FROM outcome_local_private_trade_evaluation_generation generation
          WHERE generation.generation_id=$1
            AND generation.trade_id=$2
            AND generation.valuation_scope_key=$3
          FOR KEY SHARE OF generation`,
        [generationId, selector.tradeId, selector.valuationScopeKey]
      );
      if (retained.rows.length === 0) return null;
      if (retained.rows.length !== 1) {
        throw new TypeError('Private evaluation rollback target is ambiguous.');
      }
      const row = retained.rows[0]!;
      if (!row.was_active) {
        return {
          generation: row.generation_json as LocalPrivateTradeEvaluationGenerationV3,
          artifact: aflTradeArtifactRefSchema.parse(row.artifact_json),
          wasActive: false,
        };
      }
      return {
        generation: localPrivateTradeEvaluationGenerationV3Schema.parse(
          row.generation_json
        ),
        artifact: aflTradeArtifactRefSchema.parse(row.artifact_json),
        wasActive: true,
      };
    },

    async commitTransition(transaction, input) {
      const intent = privateEvaluationTransitionIntentSchema.parse(input.intent);
      const generation =
        input.generation === null
          ? null
          : localPrivateTradeEvaluationGenerationV3Schema.parse(input.generation);
      const receipt = privateEvaluationTransitionReceiptSchema.parse(input.receipt);
      const artifact = aflTradeArtifactRefSchema.parse(input.receiptArtifact);
      if (
        !same(intent, receipt.content.intent) ||
        (intent.content.action === 'withdraw') !== (generation === null) ||
        (generation !== null && receipt.content.generationId !== generation.generationId)
      ) {
        throw new TypeError('Private evaluation transition receipt escaped its intent.');
      }
      const content = receipt.content;
      await transaction.query(
        `INSERT INTO outcome_private_evaluation_transition_receipt
          (receipt_id,intent_id,previous_receipt_id,valuation_scope_key,trade_id,action,
           generation_id,authority_snapshot_id,from_head_generation_id,from_head_revision,
           from_head_status,to_head_generation_id,to_head_revision,to_head_status,changed_at,
           receipt_content_sha256,artifact_sha256,publication_eligible,publication_prohibited,
           receipt_json,artifact_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,FALSE,TRUE,$18::jsonb,$19::jsonb)
         ON CONFLICT (receipt_id) DO NOTHING`,
        [
          receipt.receiptId,
          content.intentId,
          content.previousReceiptId,
          content.selector.valuationScopeKey,
          content.selector.tradeId,
          content.action,
          content.generationId,
          content.authoritySnapshotId,
          content.fromHead.generationId,
          content.fromHead.revision,
          content.fromHead.status,
          content.toHead.generationId,
          content.toHead.revision,
          content.toHead.status,
          content.changedAt,
          digest(receipt.receiptId, 'private-evaluation-transition-receipt'),
          artifact.contentSha256,
          canonicalizeAflTradeJson(receipt),
          canonicalizeAflTradeJson(artifact),
        ]
      );
      const retained = await transaction.query<RetainedJsonRow>(
        `SELECT receipt_json AS document_json,artifact_json
           FROM outcome_private_evaluation_transition_receipt
          WHERE receipt_id=$1 FOR KEY SHARE`,
        [receipt.receiptId]
      );
      if (
        retained.rows.length !== 1 ||
        !same(retained.rows[0]?.document_json, receipt) ||
        !same(retained.rows[0]?.artifact_json, artifact)
      ) {
        throw new TypeError('Private evaluation transition receipt replay conflicts.');
      }
      const head = await transaction.query(
        `INSERT INTO outcome_local_private_trade_evaluation_head
          (trade_id,generation_id,revision,status,withdrawal_reason,updated_at,transition_receipt_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (trade_id) DO UPDATE
           SET generation_id=EXCLUDED.generation_id,
               revision=EXCLUDED.revision,
               status=EXCLUDED.status,
               withdrawal_reason=EXCLUDED.withdrawal_reason,
               updated_at=EXCLUDED.updated_at,
               transition_receipt_id=EXCLUDED.transition_receipt_id
         WHERE outcome_local_private_trade_evaluation_head.generation_id IS NOT DISTINCT FROM $8
           AND outcome_local_private_trade_evaluation_head.revision=$9
           AND outcome_local_private_trade_evaluation_head.status=$10`,
        [
          content.selector.tradeId,
          content.toHead.generationId,
          content.toHead.revision,
          content.toHead.status,
          content.action === 'withdraw' ? content.intent.content.reason : null,
          content.changedAt,
          receipt.receiptId,
          content.fromHead.generationId,
          content.fromHead.revision,
          content.fromHead.status,
        ]
      );
      if (head.rowCount !== 1) {
        throw new TypeError('Private evaluation head changed after its serializable lock.');
      }
      await transaction.query(
        `INSERT INTO outcome_local_private_trade_evaluation_transition
          (trade_id,from_generation_id,to_generation_id,action,reason,changed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          content.selector.tradeId,
          content.fromHead.generationId,
          content.toHead.generationId,
          content.action === 'rollback' ? 'rollback' :
            content.action === 'withdraw' ? 'withdraw' : 'activate',
          content.action === 'withdraw' ? content.intent.content.reason : null,
          content.changedAt,
        ]
      );
    },
  };
}

export function createPostgresPrivateEvaluationExecutionStore(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly inspectionStore: Pick<
    PrivateEvaluationInspectionStore,
    'load' | 'loadAuthoritySnapshot'
  >;
  readonly authenticateAuthority: (
    transaction: AflOutcomeSqlTransaction,
    selector: GovernedPrivateEvaluationSelector,
    trustedAt: string
  ) => Promise<PostgresPrivateEvaluationAuthorityAuthentication>;
  readonly construct: PrivateEvaluationAuthenticatedConstructionStrategy;
  readonly saveGeneration: (input: {
    readonly generation: LocalPrivateTradeEvaluationGenerationV3;
    readonly artifact: AflTradeArtifactRef;
  }) => Promise<void>;
  readonly persistence?: PostgresPrivateEvaluationExecutionPersistence;
}): PrivateEvaluationExecutionStore {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !['fixture_memory', 'local_non_production_filesystem'].includes(
      dependencies.artifactRepository.assurance
    ) ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError(
      'Private evaluation execution requires bounded private non-production custody.'
    );
  }
  const persistence =
    dependencies.persistence ?? createPostgresPrivateEvaluationExecutionPersistence();

  async function loadReviewDocuments(input: {
    readonly selector: GovernedPrivateEvaluationSelector;
    readonly inspectionReceiptId: string;
    readonly authoritySnapshotId: string;
  }) {
    const [retainedReceipt, retainedSnapshot] = await Promise.all([
      dependencies.inspectionStore.load(input.inspectionReceiptId),
      dependencies.inspectionStore.loadAuthoritySnapshot(input.authoritySnapshotId),
    ]);
    if (retainedReceipt === null) {
      return {
        state: 'not_found' as const,
        selector: input.selector,
        resource: 'inspection' as const,
        resourceId: input.inspectionReceiptId,
      };
    }
    if (retainedSnapshot === null) {
      return {
        state: 'not_found' as const,
        selector: input.selector,
        resource: 'authority_snapshot' as const,
        resourceId: input.authoritySnapshotId,
      };
    }
    const inspectionReceipt = privateEvaluationInspectionReceiptSchema.parse(retainedReceipt);
    const authoritySnapshot = privateEvaluationAuthoritySnapshotSchema.parse(retainedSnapshot);
    if (
      inspectionReceipt.content.state !== 'ready' ||
      inspectionReceipt.content.authoritySnapshotId !== authoritySnapshot.snapshotId ||
      inspectionReceipt.receiptId !== input.inspectionReceiptId ||
      authoritySnapshot.snapshotId !== input.authoritySnapshotId ||
      !same(inspectionReceipt.content.selector, input.selector) ||
      !same(authoritySnapshot.content.selector, input.selector) ||
      inspectionReceipt.content.promotedWorkbookSha256 !==
        authoritySnapshot.content.promotedWorkbookSha256 ||
      !same(
        inspectionReceipt.content.expectedHead,
        authoritySnapshot.content.expectedHead
      ) ||
      inspectionReceipt.content.validThrough !== authoritySnapshot.content.validThrough ||
      !same(
        inspectionReceipt.content.observedDependencies,
        authoritySnapshot.content.dependencies
      )
    ) {
      throw new TypeError('Private evaluation retained review failed exact authentication.');
    }
    await Promise.all([
      requireExactArtifact({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        reference: createAflTradeCanonicalJsonArtifactRef(
          authoritySnapshot,
          authoritySnapshot.content.capturedAt
        ),
        expectedCanonicalJson: authoritySnapshot,
      }),
      requireExactArtifact({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        reference: createAflTradeCanonicalJsonArtifactRef(
          inspectionReceipt,
          inspectionReceipt.content.inspectedAt
        ),
        expectedCanonicalJson: inspectionReceipt,
      }),
    ]);
    return { state: 'ready' as const, inspectionReceipt, authoritySnapshot };
  }

  async function loadReview(
    command: Extract<
      ReturnType<typeof privateEvaluationExecutionCommandSchema.parse>,
      { kind: 'construct_and_activate' }
    >
  ) {
    const retained = await loadReviewDocuments({
      selector: command.selector,
      inspectionReceiptId: command.expected.inspectionReceiptId,
      authoritySnapshotId: command.expected.authoritySnapshotId,
    });
    if (retained.state !== 'ready') return retained;
    const { inspectionReceipt, authoritySnapshot } = retained;
    if (
      !same(inspectionReceipt.content.expectedHead, command.expected.expectedHead) ||
      !same(authoritySnapshot.content.expectedHead, command.expected.expectedHead) ||
      inspectionReceipt.content.validThrough !== command.expected.validThrough ||
      authoritySnapshot.content.validThrough !== command.expected.validThrough
    ) {
      throw new TypeError('Private evaluation execution review guard failed exact authentication.');
    }
    return { state: 'ready' as const, inspectionReceipt, authoritySnapshot };
  }

  async function reauthenticate(
    transaction: AflOutcomeSqlTransaction,
    input: {
      readonly selector: GovernedPrivateEvaluationSelector;
      readonly expectedHead: PrivateEvaluationHeadGuard;
      readonly authoritySnapshot: ReturnType<
        typeof privateEvaluationAuthoritySnapshotSchema.parse
      >;
      readonly trustedAt: string;
    }
  ): Promise<
    | { state: 'ready'; chain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain }
    | Extract<PrivateEvaluationExecutionResult, { state: 'unavailable' | 'conflict' }>
  > {
    const authenticated = await dependencies.authenticateAuthority(
      transaction,
      input.selector,
      input.trustedAt
    );
    if (authenticated.inspection.blockers.length > 0) {
      return {
        state: 'unavailable',
        selector: input.selector,
        blockers: [...authenticated.inspection.blockers],
      };
    }
    if (
      authenticated.chain === null ||
      authenticated.inspection.validThrough === null ||
      authenticated.inspection.promotedWorkbookSha256 === null
    ) {
      throw new TypeError('Ready private evaluation execution authority lost its v3 chain.');
    }
    const actualHead = authenticated.inspection.expectedHead;
    if (!same(actualHead, input.expectedHead)) {
      return conflict(
        input.selector,
        input.expectedHead,
        actualHead,
        'The private evaluation lifecycle head changed after review.'
      );
    }
    const currentDependencies = canonicalDependencies(
      await retainPrivateEvaluationAuthorityEvidence({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        evidence: authenticated.inspection.evidence,
      })
    );
    if (
      Date.parse(input.trustedAt) >= Date.parse(input.authoritySnapshot.content.validThrough) ||
      authenticated.inspection.validThrough !==
        input.authoritySnapshot.content.validThrough ||
      authenticated.inspection.promotedWorkbookSha256 !==
        input.authoritySnapshot.content.promotedWorkbookSha256 ||
      !same(
        currentDependencies,
        canonicalDependencies(input.authoritySnapshot.content.dependencies)
      )
    ) {
      return conflict(
        input.selector,
        input.expectedHead,
        actualHead,
        'The authenticated private evaluation authority changed after review.'
      );
    }
    return { state: 'ready', chain: authenticated.chain };
  }

  return {
    async execute(unparsedCommand) {
      const command = privateEvaluationExecutionCommandSchema.parse(unparsedCommand);
      if (command.kind === 'withdraw') {
        return dependencies.client.transaction(async transaction => {
          const locked = await persistence.loadHeadForUpdate(transaction, command.selector);
          if (!same(locked.head, command.expected)) {
            return conflict(
              command.selector,
              command.expected,
              locked.head,
              'The private evaluation lifecycle head changed before withdrawal.'
            );
          }
          const withdrawnAt = await trustedTime(transaction);
          const transitionIntent = createPrivateEvaluationTransitionIntent({
            action: 'withdraw',
            selector: command.selector,
            expectedHead: command.expected,
            targetGenerationId: null,
            authoritySnapshotId: null,
            inspectionReceiptId: null,
            reason: command.reason,
            operator: command.operator,
            requestedAt: withdrawnAt,
          });
          const intentArtifact = await retainCanonicalJson({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            value: transitionIntent,
            createdAt: withdrawnAt,
          });
          await persistence.retainIntent(transaction, {
            intent: transitionIntent,
            artifact: intentArtifact,
          });
          const toHead: PrivateEvaluationHeadGuard = {
            generationId: null,
            revision: locked.head.revision + 1,
            status: 'withdrawn',
          };
          const receipt = createPrivateEvaluationTransitionReceipt({
            intent: transitionIntent,
            previousReceiptId: locked.latestReceiptId,
            generationId: null,
            authoritySnapshotId: null,
            fromHead: locked.head,
            toHead,
            changedAt: withdrawnAt,
          });
          const receiptArtifact = await retainCanonicalJson({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            value: receipt,
            createdAt: withdrawnAt,
          });
          await persistence.commitTransition(transaction, {
            intent: transitionIntent,
            generation: null,
            receipt,
            receiptArtifact,
          });
          return { state: 'withdrawn' as const, selector: command.selector, head: toHead };
        }, { isolationLevel: 'serializable', accessMode: 'read_write' });
      }
      if (command.kind === 'rollback') {
        if (command.targetGenerationId === command.expected.generationId) {
          return {
            state: 'invalid_transition',
            selector: command.selector,
            reason: 'target_current',
            message: 'The requested rollback target is already current.',
          };
        }
        return dependencies.client.transaction(async transaction => {
          const locked = await persistence.loadHeadForUpdate(transaction, command.selector);
          if (!same(locked.head, command.expected)) {
            return conflict(
              command.selector,
              command.expected,
              locked.head,
              'The private evaluation lifecycle head changed before rollback.'
            );
          }
          const target = await persistence.loadRollbackTarget(
            transaction,
            command.selector,
            command.targetGenerationId
          );
          if (target === null) {
            return {
              state: 'not_found' as const,
              selector: command.selector,
              resource: 'generation' as const,
              resourceId: command.targetGenerationId,
            };
          }
          if (!target.wasActive) {
            return {
              state: 'invalid_transition' as const,
              selector: command.selector,
              reason: 'never_active' as const,
              message: 'Rollback targets must have been active previously.',
            };
          }
          const generation = localPrivateTradeEvaluationGenerationV3Schema.parse(
            target.generation
          );
          if (
            generation.generationId !== command.targetGenerationId ||
            generation.content.valuationScopeKey !== command.selector.valuationScopeKey ||
            generation.content.tradeId !== command.selector.tradeId
          ) {
            throw new TypeError('Private evaluation rollback target escaped its selector.');
          }
          await requireExactArtifact({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            reference: target.artifact,
            expectedCanonicalJson: generation,
          });
          const review = await loadReviewDocuments({
            selector: command.selector,
            inspectionReceiptId:
              generation.content.authorityReview.inspectionReceiptId,
            authoritySnapshotId:
              generation.content.authorityReview.authoritySnapshotId,
          });
          if (review.state !== 'ready') return review;
          if (
            !doAflTradeArtifactRefsExactlyMatch(
              generation.content.authorityReview.authoritySnapshotArtifact,
              createAflTradeCanonicalJsonArtifactRef(
                review.authoritySnapshot,
                review.authoritySnapshot.content.capturedAt
              )
            ) ||
            !doAflTradeArtifactRefsExactlyMatch(
              generation.content.authorityReview.inspectionReceiptArtifact,
              createAflTradeCanonicalJsonArtifactRef(
                review.inspectionReceipt,
                review.inspectionReceipt.content.inspectedAt
              )
            )
          ) {
            throw new TypeError('Private evaluation rollback review ancestry drifted.');
          }
          const rolledBackAt = await trustedTime(transaction);
          const authority = await reauthenticate(transaction, {
            selector: command.selector,
            expectedHead: command.expected,
            authoritySnapshot: review.authoritySnapshot,
            trustedAt: rolledBackAt,
          });
          if (authority.state !== 'ready') {
            return {
              state: 'invalid_transition' as const,
              selector: command.selector,
              reason: 'authority_no_longer_current' as const,
              message:
                'The rollback target’s exact source, model, Gate 3, or bundle authority is no longer current.',
            };
          }
          const transitionIntent = createPrivateEvaluationTransitionIntent({
            action: 'rollback',
            selector: command.selector,
            expectedHead: command.expected,
            targetGenerationId: generation.generationId,
            authoritySnapshotId: review.authoritySnapshot.snapshotId,
            inspectionReceiptId: review.inspectionReceipt.receiptId,
            reason: null,
            operator: command.operator,
            requestedAt: rolledBackAt,
          });
          const intentArtifact = await retainCanonicalJson({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            value: transitionIntent,
            createdAt: rolledBackAt,
          });
          await persistence.retainIntent(transaction, {
            intent: transitionIntent,
            artifact: intentArtifact,
          });
          const toHead: PrivateEvaluationHeadGuard = {
            generationId: generation.generationId,
            revision: locked.head.revision + 1,
            status: 'active',
          };
          const receipt = createPrivateEvaluationTransitionReceipt({
            intent: transitionIntent,
            previousReceiptId: locked.latestReceiptId,
            generationId: generation.generationId,
            authoritySnapshotId: review.authoritySnapshot.snapshotId,
            fromHead: locked.head,
            toHead,
            changedAt: rolledBackAt,
          });
          const receiptArtifact = await retainCanonicalJson({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            value: receipt,
            createdAt: rolledBackAt,
          });
          await persistence.commitTransition(transaction, {
            intent: transitionIntent,
            generation,
            receipt,
            receiptArtifact,
          });
          return {
            state: 'rolled_back' as const,
            selector: command.selector,
            generationId: generation.generationId,
            head: toHead,
          };
        }, { isolationLevel: 'serializable', accessMode: 'read_write' });
      }
      if (command.kind !== 'construct_and_activate') {
        throw new TypeError(
          `Private evaluation execution command ${command.kind} is not yet composed.`
        );
      }
      const review = await loadReview(command);
      if (review.state !== 'ready') return review;
      const initial = await dependencies.client.transaction(async transaction => {
        const constructedAt = await trustedTime(transaction);
        const authority = await reauthenticate(transaction, {
          selector: command.selector,
          expectedHead: command.expected.expectedHead,
          authoritySnapshot: review.authoritySnapshot,
          trustedAt: constructedAt,
        });
        if (authority.state !== 'ready') return authority;
        const transitionIntent = createPrivateEvaluationTransitionIntent({
          action: 'construct_and_activate',
          selector: command.selector,
          expectedHead: command.expected.expectedHead,
          targetGenerationId: null,
          authoritySnapshotId: review.authoritySnapshot.snapshotId,
          inspectionReceiptId: review.inspectionReceipt.receiptId,
          reason: null,
          operator: command.operator,
          requestedAt: constructedAt,
        });
        const intentArtifact = await retainCanonicalJson({
          repository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
          value: transitionIntent,
          createdAt: constructedAt,
        });
        await persistence.retainIntent(transaction, {
          intent: transitionIntent,
          artifact: intentArtifact,
        });
        return {
          state: 'ready' as const,
          chain: authority.chain,
          transitionIntent,
          constructedAt,
        };
      }, { isolationLevel: 'repeatable_read', accessMode: 'read_write' });
      if (initial.state !== 'ready') return initial;

      const generation = localPrivateTradeEvaluationGenerationV3Schema.parse(
        await dependencies.construct({
          chain: initial.chain,
          authoritySnapshot: review.authoritySnapshot,
          inspectionReceipt: review.inspectionReceipt,
          transitionIntent: initial.transitionIntent,
          constructedAt: initial.constructedAt,
        })
      );
      if (
        !completeGeneration(generation) ||
        generation.content.valuationScopeKey !== command.selector.valuationScopeKey ||
        generation.content.tradeId !== command.selector.tradeId ||
        generation.content.authorityReview.transitionIntentId !==
          initial.transitionIntent.intentId
      ) {
        throw new TypeError(
          'Private evaluation construction did not produce one complete reviewed v3 generation.'
        );
      }
      for (const reference of generation.content.dependencyRefs) {
        await requireExactArtifact({
          repository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
          reference,
        });
      }
      const generationArtifact = await retainCanonicalJson({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        value: generation,
        createdAt: generation.content.generatedAt,
      });
      await dependencies.saveGeneration({ generation, artifact: generationArtifact });

      return dependencies.client.transaction(async transaction => {
        const locked = await persistence.loadHeadForUpdate(transaction, command.selector);
        if (!same(locked.head, command.expected.expectedHead)) {
          return conflict(
            command.selector,
            command.expected.expectedHead,
            locked.head,
            'The private evaluation lifecycle head changed before activation.'
          );
        }
        const activatedAt = await trustedTime(transaction);
        const authority = await reauthenticate(transaction, {
          selector: command.selector,
          expectedHead: command.expected.expectedHead,
          authoritySnapshot: review.authoritySnapshot,
          trustedAt: activatedAt,
        });
        if (authority.state !== 'ready') return authority;
        const toHead: PrivateEvaluationHeadGuard = {
          generationId: generation.generationId,
          revision: locked.head.revision + 1,
          status: 'active',
        };
        const receipt = createPrivateEvaluationTransitionReceipt({
          intent: initial.transitionIntent,
          previousReceiptId: locked.latestReceiptId,
          generationId: generation.generationId,
          authoritySnapshotId: review.authoritySnapshot.snapshotId,
          fromHead: locked.head,
          toHead,
          changedAt: activatedAt,
        });
        const receiptArtifact = await retainCanonicalJson({
          repository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
          value: receipt,
          createdAt: activatedAt,
        });
        await persistence.commitTransition(transaction, {
          intent: initial.transitionIntent,
          generation,
          receipt,
          receiptArtifact,
        });
        return {
          state: 'activated' as const,
          selector: command.selector,
          generationId: generation.generationId,
          head: toHead,
        };
      }, { isolationLevel: 'serializable', accessMode: 'read_write' });
    },
  };
}
