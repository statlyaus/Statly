import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  createReadyGovernedPrivateEvaluationAuthorityInspectionV3,
  createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection,
} from './governedPrivateEvaluationAuthoritySnapshot';
import type { GovernedReadyComponentAuthority } from './governedReadyComponentAuthority';
import type { AflTradePreparedValuationInputSetContent } from '../preparedValuationInputSet';
import {
  governedPrivateEvaluationInspectRequestSchema,
  type GovernedPrivateEvaluationInspectRequest,
} from './governedPrivateEvaluationWorkspaceContracts';

interface TrustedTimeRow {
  readonly trusted_at: Date | string;
}

interface HeadRow {
  readonly status: 'active' | 'withdrawn';
  readonly revision: number | string;
  readonly generation_id: string | null;
  readonly last_transition_id: string;
}

type Head = Readonly<{
  status: 'absent' | 'active' | 'withdrawn';
  revision: number;
  generationId: string | null;
}>;

type InspectionBlocker = Readonly<{
  code:
    | 'source_blocked'
    | 'insufficient_data'
    | 'identity_unresolved'
    | 'lineage_unresolved'
    | 'model_not_approved'
    | 'reconciliation_failed'
    | 'engineering_unavailable';
  message: string;
}>;

export type GovernedPrivateEvaluationCapturedCalculationAuthority =
  | Readonly<{ state: 'unavailable'; blockers: readonly InspectionBlocker[] }>
  | Readonly<{
      state: 'ready';
      preparedInputHeadRevision: number;
      preparedInputSetId: string;
      factualRegistryRevision: number;
      factualReleaseId: string;
      activeFactualReleaseRevision: number;
      privateValuationDecisionId: string;
      privateValuationDecisionRevision: number;
      materializationManifestId: string;
      materializationManifestArtifact: AflTradeArtifactRef;
      valuationInputBundleId: string;
      valuationInputBundleArtifact: AflTradeArtifactRef;
      gateLedgerRevision: number;
      components: readonly GovernedReadyComponentAuthority[];
    }>
  | Readonly<{
      state: 'ready';
      preparedInputHeadRevision: number;
      preparedInputSetId: string;
      preparationAuthority: 'qualified_current_model_evidence';
      preparationOperationId: string;
      currentModelEvidenceOperationId: string;
      dispatchAuthority: Extract<
        AflTradePreparedValuationInputSetContent,
        { preparationAuthority: 'qualified_current_model_evidence' }
      >['dispatchAuthority'];
      factualReleaseId: string;
      materializationManifestId: string;
      materializationManifestArtifact: AflTradeArtifactRef;
      valuationInputBundleId: string;
      valuationInputBundleArtifact: AflTradeArtifactRef;
      gateLedgerRevision: number;
      components: readonly GovernedReadyComponentAuthority[];
    }>;

type RetainedInspection =
  | ReturnType<typeof createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection>
  | ReturnType<typeof createReadyGovernedPrivateEvaluationAuthorityInspectionV3>;

function parseTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation inspection requires trusted PostgreSQL time.');
  }
  return parsed.toISOString();
}

async function capture(
  client: AflOutcomeSqlClient,
  selector: GovernedPrivateEvaluationInspectRequest,
  captureCalculationAuthority: (input: {
    readonly transaction: AflOutcomeSqlTransaction;
    readonly selector: GovernedPrivateEvaluationInspectRequest;
    readonly capturedAt: string;
  }) => Promise<GovernedPrivateEvaluationCapturedCalculationAuthority>
): Promise<{
  capturedAt: string;
  head: Head;
  lastTransitionId: string | null;
  calculationAuthority: GovernedPrivateEvaluationCapturedCalculationAuthority;
}> {
  return client.transaction(async (transaction) => {
    await transaction.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const trusted = await transaction.query<TrustedTimeRow>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
    );
    if (trusted.rows.length !== 1 || trusted.rows[0] === undefined) {
      throw new TypeError('Private evaluation inspection could not establish trusted time.');
    }
    const headResult = await transaction.query<HeadRow>(
      `SELECT status,revision,generation_id,last_transition_id
         FROM outcome_local_private_trade_evaluation_head
        WHERE valuation_scope_key=$1 AND trade_id=$2`,
      [selector.valuationScopeKey, selector.tradeId]
    );
    let head: Head;
    let lastTransitionId: string | null;
    if (headResult.rows.length === 0) {
      head = { status: 'absent', revision: 0, generationId: null };
      lastTransitionId = null;
    } else {
      const row = headResult.rows[0];
      const revision = Number(row?.revision);
      if (
        headResult.rows.length !== 1 ||
        row === undefined ||
        !Number.isSafeInteger(revision) ||
        revision <= 0 ||
        (row.status === 'active') !== (row.generation_id !== null)
      ) {
        throw new TypeError('Private evaluation inspection found a malformed composite head.');
      }
      head = { status: row.status, revision, generationId: row.generation_id };
      lastTransitionId = row.last_transition_id;
    }
    const capturedAt = parseTime(trusted.rows[0].trusted_at);
    return {
      capturedAt,
      head,
      lastTransitionId,
      calculationAuthority: await captureCalculationAuthority({
        transaction,
        selector,
        capturedAt,
      }),
    };
  });
}

async function insertRetainedInspection(
  transaction: AflOutcomeSqlTransaction,
  retained: RetainedInspection,
  snapshotArtifact: AflTradeArtifactRef,
  inspectionArtifact: AflTradeArtifactRef
): Promise<void> {
  const snapshot = retained.snapshot;
  const inspection = retained.inspection;
  const selector = snapshot.content.selector;
  const snapshotInsert = await transaction.query(
    `INSERT INTO outcome_private_evaluation_authority_snapshot
      (snapshot_id,valuation_scope_key,trade_id,artifact_id,captured_at,valid_through,
       expected_head_status,expected_head_revision,expected_head_generation_id,
       content_sha256,content_canonical_json,snapshot_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      snapshot.snapshotId,
      selector.valuationScopeKey,
      selector.tradeId,
      snapshotArtifact.artifactId,
      snapshot.content.capturedAt,
      snapshot.content.validThrough,
      snapshot.content.head.status,
      snapshot.content.head.revision,
      snapshot.content.head.generationId,
      snapshot.snapshotId.slice('private-evaluation-authority-snapshot:'.length),
      canonicalizeAflTradeJson(snapshot.content),
      canonicalizeAflTradeJson(snapshot),
    ]
  );
  const inspectionInsert = await transaction.query(
    `INSERT INTO outcome_private_evaluation_inspection_receipt
      (inspection_id,snapshot_id,valuation_scope_key,trade_id,artifact_id,state,
       inspected_at,valid_through,expected_head_status,expected_head_revision,
       expected_head_generation_id,content_sha256,content_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [
      inspection.inspectionId,
      snapshot.snapshotId,
      selector.valuationScopeKey,
      selector.tradeId,
      inspectionArtifact.artifactId,
      inspection.content.state,
      inspection.content.capturedAt,
      inspection.content.validThrough,
      inspection.content.head.status,
      inspection.content.head.revision,
      inspection.content.head.generationId,
      inspection.inspectionId.slice('private-evaluation-inspection:'.length),
      canonicalizeAflTradeJson(inspection.content),
      canonicalizeAflTradeJson(inspection),
    ]
  );
  if (snapshotInsert.rowCount !== 1 || inspectionInsert.rowCount !== 1) {
    throw new TypeError('Private evaluation inspection was not persisted exactly once.');
  }
}

export function createPostgresGovernedPrivateEvaluationInspectionRepository(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly retainArtifact: (artifact: {
    readonly reference: AflTradeArtifactRef;
    readonly bytes: Uint8Array;
  }) => Promise<AflTradeArtifactRef>;
  readonly captureCalculationAuthority?: (input: {
    readonly transaction: AflOutcomeSqlTransaction;
    readonly selector: GovernedPrivateEvaluationInspectRequest;
    readonly capturedAt: string;
  }) => Promise<GovernedPrivateEvaluationCapturedCalculationAuthority>;
  readonly validityMilliseconds: number;
}) {
  if (
    !Number.isSafeInteger(dependencies.validityMilliseconds) ||
    dependencies.validityMilliseconds <= 0 ||
    dependencies.validityMilliseconds > 15 * 60 * 1_000
  ) {
    throw new TypeError('Private evaluation inspection requires a short validity window.');
  }
  return {
    async inspect(unparsedRequest: GovernedPrivateEvaluationInspectRequest) {
      const selector = governedPrivateEvaluationInspectRequestSchema.parse(unparsedRequest);
      const capturedState = await capture(
        dependencies.client,
        selector,
        dependencies.captureCalculationAuthority ??
          (async () => ({
            state: 'unavailable' as const,
            blockers: [
              {
                code: 'model_not_approved' as const,
                message:
                  'Externally approved player and pick model runs are not both available for this trade.',
              },
            ],
          }))
      );
      const common = {
        selector,
        capturedAt: capturedState.capturedAt,
        validThrough: new Date(
          Date.parse(capturedState.capturedAt) + dependencies.validityMilliseconds
        ).toISOString(),
        head: capturedState.head,
        lastTransitionId: capturedState.lastTransitionId,
      };
      const retained =
        capturedState.calculationAuthority.state === 'ready'
          ? createReadyGovernedPrivateEvaluationAuthorityInspectionV3({
              ...common,
              ...capturedState.calculationAuthority,
            })
          : createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection({
              ...common,
              blockers: capturedState.calculationAuthority.blockers,
            });
      const artifacts = [retained.snapshot, retained.inspection].map((document) => ({
        document,
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
        reference: createAflTradeCanonicalJsonArtifactRef(document, capturedState.capturedAt),
      }));
      for (const artifact of artifacts) {
        const retainedReference = await dependencies.retainArtifact({
          reference: artifact.reference,
          bytes: artifact.bytes,
        });
        if (
          retainedReference.artifactId !== artifact.reference.artifactId ||
          !doesAflTradeArtifactRefMatchCanonicalJson(retainedReference, artifact.document)
        ) {
          throw new TypeError('Private evaluation inspection artifact retention failed.');
        }
      }
      await dependencies.client.transaction((transaction) =>
        insertRetainedInspection(
          transaction,
          retained,
          artifacts[0]!.reference,
          artifacts[1]!.reference
        )
      );
      return retained.result;
    },
  };
}
