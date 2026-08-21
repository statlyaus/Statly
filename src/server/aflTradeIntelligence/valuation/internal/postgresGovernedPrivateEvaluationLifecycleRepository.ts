import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { parseGovernedPrivateEvaluationGeneration } from '../governedPrivateEvaluationGeneration';
import {
  automatedGovernedPrivateEvaluationTransitionReceiptSchema,
  governedPrivateEvaluationTransitionReceiptSchema,
  type AnyGovernedPrivateEvaluationTransitionReceipt,
  type AutomatedGovernedPrivateEvaluationTransitionReceipt,
  type GovernedPrivateEvaluationTransitionReceipt,
} from './governedPrivateEvaluationLifecycle';
import { authenticateGovernedPrivateEvaluationAuthorityInspection } from './governedPrivateEvaluationAuthoritySnapshot';

interface HeadRow {
  readonly status: 'active' | 'withdrawn';
  readonly revision: number | string;
  readonly generation_id: string | null;
  readonly last_transition_id: string;
}

interface ExistingReceiptRow {
  readonly receipt_json: unknown;
  readonly artifact_id: string;
}

interface TrustedTimeRow {
  readonly trusted_at: Date | string;
}

interface OperatorAuthorityRow {
  readonly authority_evidence_id: string;
}

interface StoredAuthorityRow {
  readonly intent_json: unknown;
  readonly authority_snapshot_id: string | null;
  readonly inspection_snapshot_id: string;
  readonly inspection_state: 'ready' | 'unavailable';
  readonly inspection_valid_through: Date | string;
  readonly inspection_head_status: 'absent' | 'active' | 'withdrawn';
  readonly inspection_head_revision: number | string;
  readonly inspection_head_generation_id: string | null;
  readonly snapshot_id: string | null;
  readonly snapshot_valid_through: Date | string | null;
  readonly snapshot_head_status: 'absent' | 'active' | 'withdrawn' | null;
  readonly snapshot_head_revision: number | string | null;
  readonly snapshot_head_generation_id: string | null;
  readonly snapshot_json: unknown;
  readonly inspection_json: unknown;
  readonly snapshot_artifact_id: string;
  readonly snapshot_artifact_sha256: string;
  readonly snapshot_artifact_storage_uri: string;
  readonly snapshot_artifact_media_type: string;
  readonly snapshot_artifact_byte_length: number | string | bigint;
  readonly snapshot_artifact_created_at: Date | string;
  readonly inspection_artifact_id: string;
  readonly inspection_artifact_sha256: string;
  readonly inspection_artifact_storage_uri: string;
  readonly inspection_artifact_media_type: string;
  readonly inspection_artifact_byte_length: number | string | bigint;
  readonly inspection_artifact_created_at: Date | string;
}

type LifecycleHead = AnyGovernedPrivateEvaluationTransitionReceipt['content']['toHead'];

export type GovernedPrivateEvaluationLifecycleCommitResult =
  | {
      readonly state: 'committed' | 'replayed';
      readonly head: LifecycleHead;
      readonly transitionId: string;
    }
  | {
      readonly state: 'conflict';
      readonly expectedHead: LifecycleHead;
      readonly actualHead: LifecycleHead;
    };

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function parseTime(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError('The lifecycle repository requires trusted PostgreSQL time.');
  }
  return parsed;
}

function sameHead(left: LifecycleHead, right: LifecycleHead): boolean {
  return (
    left.status === right.status &&
    left.revision === right.revision &&
    left.generationId === right.generationId
  );
}

async function loadHeadForUpdate(
  transaction: AflOutcomeSqlTransaction,
  selector: { readonly valuationScopeKey: string; readonly tradeId: string }
): Promise<{ readonly head: LifecycleHead; readonly lastTransitionId: string | null }> {
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `governed-private-evaluation-head:${canonicalizeAflTradeJson(selector)}`,
  ]);
  const result = await transaction.query<HeadRow>(
    `SELECT status,revision,generation_id,last_transition_id
       FROM outcome_local_private_trade_evaluation_head
      WHERE valuation_scope_key=$1 AND trade_id=$2
      FOR UPDATE`,
    [selector.valuationScopeKey, selector.tradeId]
  );
  if (result.rows.length === 0) {
    return {
      head: { status: 'absent', revision: 0, generationId: null },
      lastTransitionId: null,
    };
  }
  const row = result.rows[0];
  const revision = Number(row?.revision);
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    !Number.isSafeInteger(revision) ||
    revision <= 0 ||
    (row.status === 'active') !== (row.generation_id !== null)
  ) {
    throw new TypeError('The composite private evaluation lifecycle head is malformed.');
  }
  return {
    head: {
      status: row.status,
      revision,
      generationId: row.generation_id,
    },
    lastTransitionId: row.last_transition_id,
  };
}

async function proveResultGeneration(
  transaction: AflOutcomeSqlTransaction,
  receipt: AnyGovernedPrivateEvaluationTransitionReceipt
): Promise<void> {
  const { action, selector, toHead, fromHead, previousTransitionId, intent } = receipt.content;
  if (action.kind === 'withdraw') return;
  const generationId = toHead.generationId!;
  if (action.kind === 'recover') {
    const withdrawal = await transaction.query<{ from_generation_id: string | null }>(
      `SELECT from_generation_id
         FROM outcome_private_evaluation_transition_receipt
        WHERE valuation_scope_key=$1 AND trade_id=$2 AND to_revision=$3
          AND transition_id=$4 AND action='withdraw' AND to_status='withdrawn'
        FOR KEY SHARE`,
      [selector.valuationScopeKey, selector.tradeId, fromHead.revision, previousTransitionId]
    );
    if (
      withdrawal.rows.length !== 1 ||
      withdrawal.rows[0]?.from_generation_id !== generationId
    ) {
      throw new TypeError('Recovery requires the exact generation removed by the current withdrawal.');
    }
  }
  if (action.kind === 'rollback') {
    const priorActivation = await transaction.query(
      `SELECT transition_id
         FROM outcome_private_evaluation_transition_receipt
        WHERE valuation_scope_key=$1 AND trade_id=$2 AND to_generation_id=$3
          AND action IN ('construct_and_activate','rollback','recover')
        LIMIT 1 FOR KEY SHARE`,
      [selector.valuationScopeKey, selector.tradeId, generationId]
    );
    if (priorActivation.rows.length !== 1) {
      throw new TypeError('Rollback requires a generation previously activated for this selector.');
    }
  }
  const generation = await transaction.query<{
    generation_id: string;
    generation_json: unknown;
  }>(
    `SELECT generation_id,generation_json
       FROM outcome_local_private_trade_evaluation_generation
      WHERE valuation_scope_key=$1 AND trade_id=$2 AND generation_id=$3
        AND ($4<>'construct_and_activate' OR transition_intent_id=$5)
      FOR KEY SHARE`,
    [
      selector.valuationScopeKey,
      selector.tradeId,
      generationId,
      action.kind,
      intent.transitionIntentId,
    ]
  );
  if (generation.rows.length !== 1) {
    throw new TypeError('The lifecycle result generation is absent or escaped its transition intent.');
  }
  if (receipt.content.schemaVersion === 'private-evaluation-transition-receipt/v2') {
    const retainedGeneration = parseGovernedPrivateEvaluationGeneration(
      generation.rows[0]!.generation_json
    );
    if (
      retainedGeneration.content.schemaVersion !==
        'local-private-trade-evaluation-generation/v2' ||
      !same(
        retainedGeneration.content.constructionAuthority,
        receipt.content.intent.content.constructionAuthority
      )
    ) {
      throw new TypeError(
        'Automated lifecycle activation requires the exact v2 system construction authority.'
      );
    }
  }
}

function rowHead(
  status: StoredAuthorityRow['inspection_head_status'],
  revision: number | string,
  generationId: string | null
): LifecycleHead {
  return { status, revision: Number(revision), generationId };
}

function artifactReference(
  row: StoredAuthorityRow,
  kind: 'snapshot' | 'inspection'
): AflTradeArtifactRef {
  const byteLength = Number(row[`${kind}_artifact_byte_length`]);
  const createdAtValue = row[`${kind}_artifact_created_at`];
  const createdAt =
    createdAtValue instanceof Date
      ? createdAtValue.toISOString()
      : new Date(createdAtValue).toISOString();
  return aflTradeArtifactRefSchema.parse({
    artifactId: row[`${kind}_artifact_id`],
    contentSha256: row[`${kind}_artifact_sha256`],
    storageUri: row[`${kind}_artifact_storage_uri`],
    mediaType: row[`${kind}_artifact_media_type`],
    byteLength,
    createdAt,
  });
}

async function authenticateStoredAuthorityArtifacts(input: {
  readonly row: StoredAuthorityRow;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}) {
  const snapshotReference = artifactReference(input.row, 'snapshot');
  const inspectionReference = artifactReference(input.row, 'inspection');
  const [snapshotArtifact, inspectionArtifact] = await Promise.all([
    input.artifactRepository.loadExact(snapshotReference, input.maximumArtifactBytes),
    input.artifactRepository.loadExact(inspectionReference, input.maximumArtifactBytes),
  ]);
  if (
    snapshotArtifact === null ||
    inspectionArtifact === null ||
    !doAflTradeArtifactRefsExactlyMatch(snapshotReference, snapshotArtifact.reference) ||
    !doAflTradeArtifactRefsExactlyMatch(inspectionReference, inspectionArtifact.reference) ||
    !doesAflTradeArtifactRefMatchBytes(snapshotArtifact.reference, snapshotArtifact.bytes) ||
    !doesAflTradeArtifactRefMatchBytes(inspectionArtifact.reference, inspectionArtifact.bytes) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(snapshotReference, input.row.snapshot_json) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(inspectionReference, input.row.inspection_json)
  ) {
    throw new TypeError('The lifecycle transition lacks exact retained authority bytes.');
  }
  let snapshotFromBytes: unknown;
  let inspectionFromBytes: unknown;
  try {
    snapshotFromBytes = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(snapshotArtifact.bytes)
    );
    inspectionFromBytes = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(inspectionArtifact.bytes)
    );
  } catch {
    throw new TypeError('The lifecycle retained authority bytes are not exact JSON.');
  }
  const retained = authenticateGovernedPrivateEvaluationAuthorityInspection({
    snapshot: snapshotFromBytes,
    inspection: inspectionFromBytes,
  });
  if (
    !same(retained.snapshot, input.row.snapshot_json) ||
    !same(retained.inspection, input.row.inspection_json)
  ) {
    throw new TypeError('The lifecycle relational authority differs from its retained bytes.');
  }
  return retained;
}

async function proveStoredAuthority(
  transaction: AflOutcomeSqlTransaction,
  receipt: AnyGovernedPrivateEvaluationTransitionReceipt,
  artifactRepository: AflTradeImmutableArtifactRepository,
  maximumArtifactBytes: number
): Promise<void> {
  const content = receipt.content;
  const intent = content.intent.content;
  const result = await transaction.query<StoredAuthorityRow>(
    `SELECT ti.intent_json,ti.authority_snapshot_id,
            ir.snapshot_id AS inspection_snapshot_id,ir.state AS inspection_state,
            ir.valid_through AS inspection_valid_through,
            ir.expected_head_status AS inspection_head_status,
            ir.expected_head_revision AS inspection_head_revision,
            ir.expected_head_generation_id AS inspection_head_generation_id,
            authority.snapshot_id,authority.valid_through AS snapshot_valid_through,
            authority.expected_head_status AS snapshot_head_status,
            authority.expected_head_revision AS snapshot_head_revision,
            authority.expected_head_generation_id AS snapshot_head_generation_id,
            authority.snapshot_json,ir.receipt_json AS inspection_json,
            snapshot_artifact.artifact_id AS snapshot_artifact_id,
            snapshot_artifact.content_sha256 AS snapshot_artifact_sha256,
            snapshot_artifact.storage_uri AS snapshot_artifact_storage_uri,
            snapshot_artifact.media_type AS snapshot_artifact_media_type,
            snapshot_artifact.byte_length AS snapshot_artifact_byte_length,
            snapshot_artifact.created_at AS snapshot_artifact_created_at,
            inspection_artifact.artifact_id AS inspection_artifact_id,
            inspection_artifact.content_sha256 AS inspection_artifact_sha256,
            inspection_artifact.storage_uri AS inspection_artifact_storage_uri,
            inspection_artifact.media_type AS inspection_artifact_media_type,
            inspection_artifact.byte_length AS inspection_artifact_byte_length,
            inspection_artifact.created_at AS inspection_artifact_created_at
       FROM outcome_private_evaluation_transition_intent ti
       JOIN outcome_private_evaluation_inspection_receipt ir
         ON ir.inspection_id=ti.inspection_id
        AND ir.valuation_scope_key=ti.valuation_scope_key AND ir.trade_id=ti.trade_id
       JOIN outcome_private_evaluation_authority_snapshot authority
         ON authority.snapshot_id=ir.snapshot_id
        AND authority.valuation_scope_key=ir.valuation_scope_key
        AND authority.trade_id=ir.trade_id
       JOIN outcome_artifact_custody snapshot_artifact
         ON snapshot_artifact.artifact_id=authority.artifact_id
       JOIN outcome_artifact_custody inspection_artifact
         ON inspection_artifact.artifact_id=ir.artifact_id
      WHERE ti.transition_intent_id=$1 AND ti.valuation_scope_key=$2 AND ti.trade_id=$3`,
    [content.intent.transitionIntentId, content.selector.valuationScopeKey, content.selector.tradeId]
  );
  const row = result.rows[0];
  const requiresCalculationAuthority = content.action.kind !== 'withdraw';
  const requiresSnapshotEvidence = content.action.kind !== 'withdraw';
  const inspectionHead =
    row === undefined
      ? null
      : rowHead(
          row.inspection_head_status,
          row.inspection_head_revision,
          row.inspection_head_generation_id
        );
  const snapshotHead =
    row?.snapshot_head_status === null || row?.snapshot_head_revision === null
      ? null
      : rowHead(
          row.snapshot_head_status,
          row.snapshot_head_revision,
          row.snapshot_head_generation_id
        );
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    !same(row.intent_json, content.intent) ||
    row.authority_snapshot_id !== intent.authoritySnapshotId ||
    (requiresCalculationAuthority
      ? row.inspection_state !== 'ready'
      : !['ready', 'unavailable'].includes(row.inspection_state)) ||
    parseTime(row.inspection_valid_through) < parseTime(content.transitionedAt) ||
    inspectionHead === null ||
    !sameHead(inspectionHead, content.fromHead) ||
    (requiresSnapshotEvidence &&
      (row.snapshot_id !== intent.authoritySnapshotId ||
        row.inspection_snapshot_id !== intent.authoritySnapshotId ||
        row.snapshot_valid_through === null ||
        parseTime(row.snapshot_valid_through) < parseTime(content.transitionedAt) ||
        snapshotHead === null ||
        !sameHead(snapshotHead, content.fromHead)))
  ) {
    throw new TypeError('The lifecycle transition lacks exact stored snapshot authority.');
  }
  const retained = await authenticateStoredAuthorityArtifacts({
    row,
    artifactRepository,
    maximumArtifactBytes,
  });
  if (
    content.schemaVersion === 'private-evaluation-transition-receipt/v2' &&
    (retained.snapshot.content.schemaVersion !==
      'private-evaluation-authority-snapshot/v3' ||
      retained.inspection.content.schemaVersion !== 'private-evaluation-inspection/v3')
  ) {
    throw new TypeError(
      'Automated lifecycle activation requires exact non-production v3 calculation authority.'
    );
  }
  if (
    !same(retained.result.selector, content.selector) ||
    retained.inspection.content.lastTransitionId !== content.previousTransitionId ||
    retained.result.state !== row.inspection_state ||
    !sameHead(retained.result.head, inspectionHead) ||
    parseTime(retained.result.validThrough) !== parseTime(row.inspection_valid_through) ||
    retained.snapshot.snapshotId !== row.snapshot_id ||
    snapshotHead === null ||
    !sameHead(retained.snapshot.content.head, snapshotHead) ||
    row.snapshot_valid_through === null ||
    parseTime(retained.snapshot.content.validThrough) !== parseTime(row.snapshot_valid_through)
  ) {
    throw new TypeError(
      'The lifecycle relational authority differs from its authenticated retained authority.'
    );
  }
}

async function proveCurrentOperatorAuthority(
  transaction: AflOutcomeSqlTransaction,
  receipt: GovernedPrivateEvaluationTransitionReceipt
): Promise<void> {
  const content = receipt.content;
  const result = await transaction.query<OperatorAuthorityRow>(
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
        AND authority.valid_from<=transaction_timestamp()
        AND (authority.valid_through IS NULL OR authority.valid_through>transaction_timestamp())
        AND authority.valid_from<=$3::timestamptz
        AND (authority.valid_through IS NULL OR authority.valid_through>$3::timestamptz)
        AND evidence.environment='test_fixture'::"OutcomeEnvironment"
        AND evidence.status='approved'::"OutcomeRecordStatus"
        AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=approval.decision_id)
      FOR SHARE OF authority,evidence,approval`,
    [
      content.intent.content.review.principalId,
      content.selector.valuationScopeKey,
      content.transitionedAt,
    ]
  );
  if (
    result.rows.length !== 1 ||
    !result.rows[0]?.authority_evidence_id.startsWith('reviewer-authority-evidence:')
  ) {
    throw new TypeError(
      'The lifecycle transition lacks current governed operator authority for the exact scope.'
    );
  }
}

async function insertReceiptAndCasHead(
  transaction: AflOutcomeSqlTransaction,
  receipt: AnyGovernedPrivateEvaluationTransitionReceipt,
  artifact: AflTradeArtifactRef
): Promise<void> {
  const content = receipt.content;
  const intent = content.intent.content;
  await transaction.query(
    `INSERT INTO outcome_private_evaluation_transition_receipt
      (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
       artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
       to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      receipt.transitionId,
      content.intent.transitionIntentId,
      intent.operationId,
      content.selector.valuationScopeKey,
      content.selector.tradeId,
      artifact.artifactId,
      content.action.kind,
      content.fromHead.revision,
      content.fromHead.status,
      content.fromHead.generationId,
      content.toHead.revision,
      content.toHead.status,
      content.toHead.generationId,
      content.transitionedAt,
      receipt.transitionId.slice('private-evaluation-transition:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(receipt),
    ]
  );
  const head = await transaction.query(
    `INSERT INTO outcome_local_private_trade_evaluation_head
      (valuation_scope_key,trade_id,revision,status,generation_id,last_transition_id,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (valuation_scope_key,trade_id) DO UPDATE
       SET revision=EXCLUDED.revision,status=EXCLUDED.status,
           generation_id=EXCLUDED.generation_id,last_transition_id=EXCLUDED.last_transition_id,
           updated_at=EXCLUDED.updated_at
     WHERE outcome_local_private_trade_evaluation_head.revision=$8
       AND outcome_local_private_trade_evaluation_head.status=$9
       AND outcome_local_private_trade_evaluation_head.generation_id IS NOT DISTINCT FROM $10`,
    [
      content.selector.valuationScopeKey,
      content.selector.tradeId,
      content.toHead.revision,
      content.toHead.status,
      content.toHead.generationId,
      receipt.transitionId,
      content.transitionedAt,
      content.fromHead.revision,
      content.fromHead.status,
      content.fromHead.generationId,
    ]
  );
  if (head.rowCount !== 1) {
    throw new TypeError('The lifecycle head changed after its serializable composite lock.');
  }
}

export function createPostgresGovernedPrivateEvaluationLifecycleRepository(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly automatedPrincipalId?: string;
}) {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Lifecycle commits require bounded private artifact custody.');
  }
  if (
    dependencies.automatedPrincipalId !== undefined &&
    !/^system:[a-z0-9][a-z0-9._:-]{0,199}$/u.test(dependencies.automatedPrincipalId)
  ) {
    throw new TypeError('Lifecycle commits received an invalid automated principal.');
  }
  async function commitReceipt(input: {
    readonly receipt: AnyGovernedPrivateEvaluationTransitionReceipt;
    readonly receiptArtifact: AflTradeArtifactRef;
    readonly requireOperatorAuthority: boolean;
  }): Promise<GovernedPrivateEvaluationLifecycleCommitResult> {
    const receipt = input.receipt;
    const artifact = aflTradeArtifactRefSchema.parse(input.receiptArtifact);
    if (!doesAflTradeArtifactRefMatchCanonicalJson(artifact, receipt)) {
      throw new TypeError('The lifecycle receipt artifact does not authenticate its exact JSON.');
    }
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      const existing = await transaction.query<ExistingReceiptRow>(
        `SELECT receipt_json,artifact_id
           FROM outcome_private_evaluation_transition_receipt
          WHERE operation_id=$1 FOR KEY SHARE`,
        [receipt.content.intent.content.operationId]
      );
      if (existing.rows.length > 0) {
        if (
          existing.rows.length !== 1 ||
          !same(existing.rows[0]?.receipt_json, receipt) ||
          existing.rows[0]?.artifact_id !== artifact.artifactId
        ) {
          throw new TypeError('The lifecycle operation replay conflicts with retained evidence.');
        }
        const current = await loadHeadForUpdate(transaction, receipt.content.selector);
        if (
          sameHead(current.head, receipt.content.toHead) &&
          current.lastTransitionId === receipt.transitionId
        ) {
          return {
            state: 'replayed',
            head: current.head,
            transitionId: receipt.transitionId,
          };
        }
        return {
          state: 'conflict',
          expectedHead: receipt.content.toHead,
          actualHead: current.head,
        };
      }
      const trusted = await transaction.query<TrustedTimeRow>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
      );
      if (
        trusted.rows.length !== 1 ||
        trusted.rows[0] === undefined ||
        parseTime(trusted.rows[0].trusted_at) < parseTime(receipt.content.transitionedAt) ||
        parseTime(trusted.rows[0].trusted_at) >
          parseTime(receipt.content.intent.content.expiresAt)
      ) {
        throw new TypeError('The lifecycle transition is future-dated or its authority expired.');
      }
      const current = await loadHeadForUpdate(transaction, receipt.content.selector);
      if (
        !sameHead(current.head, receipt.content.fromHead) ||
        current.lastTransitionId !== receipt.content.previousTransitionId
      ) {
        return {
          state: 'conflict',
          expectedHead: receipt.content.fromHead,
          actualHead: current.head,
        };
      }
      await proveStoredAuthority(
        transaction,
        receipt,
        dependencies.artifactRepository,
        dependencies.maximumArtifactBytes
      );
      if (input.requireOperatorAuthority) {
        await proveCurrentOperatorAuthority(
          transaction,
          receipt as GovernedPrivateEvaluationTransitionReceipt
        );
      }
      await proveResultGeneration(transaction, receipt);
      await insertReceiptAndCasHead(transaction, receipt, artifact);
      return { state: 'committed', head: receipt.content.toHead, transitionId: receipt.transitionId };
    });
  }
  return {
    async commit(input: {
      readonly receipt: GovernedPrivateEvaluationTransitionReceipt;
      readonly receiptArtifact: AflTradeArtifactRef;
    }): Promise<GovernedPrivateEvaluationLifecycleCommitResult> {
      const receipt = governedPrivateEvaluationTransitionReceiptSchema.parse(input.receipt);
      return commitReceipt({
        receipt,
        receiptArtifact: input.receiptArtifact,
        requireOperatorAuthority: true,
      });
    },
    async commitAutomated(input: {
      readonly receipt: AutomatedGovernedPrivateEvaluationTransitionReceipt;
      readonly receiptArtifact: AflTradeArtifactRef;
    }): Promise<GovernedPrivateEvaluationLifecycleCommitResult> {
      const receipt = automatedGovernedPrivateEvaluationTransitionReceiptSchema.parse(
        input.receipt
      );
      if (
        dependencies.automatedPrincipalId === undefined ||
        receipt.content.intent.content.constructionAuthority.principalId !==
          dependencies.automatedPrincipalId
      ) {
        throw new TypeError(
          'Automated lifecycle activation requires the exact configured system principal.'
        );
      }
      return commitReceipt({
        receipt,
        receiptArtifact: input.receiptArtifact,
        requireOperatorAuthority: false,
      });
    },
  };
}
