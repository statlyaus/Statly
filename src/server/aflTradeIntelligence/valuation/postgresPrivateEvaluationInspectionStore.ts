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
  createPrivateEvaluationAuthoritySnapshot,
  createPrivateEvaluationInspectionReceipt,
  privateEvaluationAuthoritySnapshotSchema,
  privateEvaluationInspectionReceiptSchema,
  type GovernedPrivateEvaluationSelector,
  type PrivateEvaluationAuthoritySnapshot,
  type PrivateEvaluationInspectionReceipt,
  type PrivateEvaluationInspectionStore,
} from './governedPrivateTradeEvaluationContracts';

type AuthoritySnapshotInput = Parameters<typeof createPrivateEvaluationAuthoritySnapshot>[0];
type InspectionReceiptInput = Parameters<typeof createPrivateEvaluationInspectionReceipt>[0];
type AuthorityDependencyRole = AuthoritySnapshotInput['dependencies'][number]['role'];

export type PrivateEvaluationAuthorityEvidence =
  | Readonly<{
      role: AuthorityDependencyRole;
      source: 'postgres_json';
      document: unknown;
      createdAt: string;
    }>
  | Readonly<{
      role: AuthorityDependencyRole;
      source: 'retained_artifact';
      artifact: AflTradeArtifactRef;
    }>;

export interface PrivateEvaluationAuthorityInspection {
  readonly promotedWorkbookSha256: string | null;
  readonly expectedHead: AuthoritySnapshotInput['expectedHead'];
  readonly validThrough: string | null;
  readonly evidence: readonly PrivateEvaluationAuthorityEvidence[];
  readonly blockers: InspectionReceiptInput['blockers'];
}

export interface PrivateEvaluationAuthorityInspector {
  (
    transaction: AflOutcomeSqlTransaction,
    selector: GovernedPrivateEvaluationSelector,
    trustedAt: string
  ): Promise<PrivateEvaluationAuthorityInspection>;
}

interface RetainedSnapshotRow {
  readonly snapshot_json: unknown;
  readonly artifact_json: unknown;
}

interface RetainedReceiptRow {
  readonly receipt_json: unknown;
  readonly artifact_json: unknown;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

function digestFromContentAddress(value: string, kind: string): string {
  const prefix = `${kind}:`;
  if (!value.startsWith(prefix)) {
    throw new TypeError(`Expected one ${kind} content address.`);
  }
  return value.slice(prefix.length);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation inspection requires trusted database time.');
  }
  return parsed.toISOString();
}

async function retainCanonicalJson(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly value: unknown;
  readonly createdAt: string;
}): Promise<AflTradeArtifactRef> {
  const reference = createAflTradeCanonicalJsonArtifactRef(input.value, input.createdAt);
  const bytes = canonicalBytes(input.value);
  await input.repository.putIfAbsent(reference, bytes);
  const retained = await input.repository.loadExact(reference, input.maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
    new TextDecoder().decode(retained.bytes) !== canonicalizeAflTradeJson(input.value)
  ) {
    throw new TypeError('Private evaluation inspection artifact failed exact readback.');
  }
  return retained.reference;
}

async function authenticateRetainedDocument<T>(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly document: unknown;
  readonly artifact: unknown;
  readonly parse: (value: unknown) => T;
}): Promise<T> {
  const document = input.parse(input.document);
  const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
  const retained = await input.repository.loadExact(artifact, input.maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, artifact) ||
    new TextDecoder().decode(retained.bytes) !== canonicalizeAflTradeJson(document)
  ) {
    throw new TypeError('Private evaluation inspection artifact custody drifted.');
  }
  return document;
}

export async function retainPrivateEvaluationAuthorityEvidence(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly evidence: readonly PrivateEvaluationAuthorityEvidence[];
}): Promise<AuthoritySnapshotInput['dependencies']> {
  const result: AuthoritySnapshotInput['dependencies'][number][] = [];
  for (const evidence of input.evidence) {
    if (evidence.source === 'postgres_json') {
      result.push({
        role: evidence.role,
        artifact: await retainCanonicalJson({
          repository: input.repository,
          maximumArtifactBytes: input.maximumArtifactBytes,
          value: evidence.document,
          createdAt: evidence.createdAt,
        }),
      });
      continue;
    }
    const artifact = aflTradeArtifactRefSchema.parse(evidence.artifact);
    const retained = await input.repository.loadExact(artifact, input.maximumArtifactBytes);
    if (
      retained === null ||
      !doAflTradeArtifactRefsExactlyMatch(retained.reference, artifact)
    ) {
      throw new TypeError('Private evaluation authority dependency is not exactly retained.');
    }
    result.push({ role: evidence.role, artifact });
  }
  return result;
}

export function createPostgresPrivateEvaluationInspectionStore(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly inspectAuthority: PrivateEvaluationAuthorityInspector;
}): PrivateEvaluationInspectionStore {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !['fixture_memory', 'local_non_production_filesystem'].includes(
      dependencies.artifactRepository.assurance
    ) ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError(
      'Private evaluation inspection requires bounded private non-production artifact custody.'
    );
  }

  return {
    async capture(selector) {
      return dependencies.client.transaction(async (transaction) => {
        const trustedTime = await transaction.query<{ trusted_at: Date | string }>(
          `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
        );
        if (trustedTime.rows.length !== 1 || trustedTime.rows[0]?.trusted_at === undefined) {
          throw new TypeError('Private evaluation inspection requires trusted database time.');
        }
        const trustedAt = iso(trustedTime.rows[0].trusted_at);
        const inspection = await dependencies.inspectAuthority(transaction, selector, trustedAt);
        const ready = inspection.blockers.length === 0;
        if (
          ready !== (inspection.validThrough !== null) ||
          (ready && inspection.promotedWorkbookSha256 === null)
        ) {
          throw new TypeError(
            'Private evaluation inspection readiness must match its authority validity.'
          );
        }

        const retainedDependencies = await retainPrivateEvaluationAuthorityEvidence({
          repository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
          evidence: inspection.evidence,
        });
        let authoritySnapshot: PrivateEvaluationAuthoritySnapshot | null = null;
        if (ready) {
          authoritySnapshot = createPrivateEvaluationAuthoritySnapshot({
            selector,
            promotedWorkbookSha256: inspection.promotedWorkbookSha256!,
            capturedAt: trustedAt,
            validThrough: inspection.validThrough!,
            expectedHead: inspection.expectedHead,
            dependencies: retainedDependencies,
          });
          const snapshotArtifact = await retainCanonicalJson({
            repository: dependencies.artifactRepository,
            maximumArtifactBytes: dependencies.maximumArtifactBytes,
            value: authoritySnapshot,
            createdAt: trustedAt,
          });
          await transaction.query(
            `INSERT INTO outcome_private_evaluation_authority_snapshot
              (snapshot_id,valuation_scope_key,trade_id,workbook_sha256,captured_at,valid_through,
               expected_head_generation_id,expected_head_revision,expected_head_status,
               dependency_fingerprint,snapshot_content_sha256,artifact_sha256,
               publication_eligible,publication_prohibited,snapshot_json,artifact_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,TRUE,$13::jsonb,$14::jsonb)
             ON CONFLICT (snapshot_id) DO NOTHING`,
            [
              authoritySnapshot.snapshotId,
              selector.valuationScopeKey,
              selector.tradeId,
              inspection.promotedWorkbookSha256,
              trustedAt,
              inspection.validThrough,
              inspection.expectedHead.generationId,
              inspection.expectedHead.revision,
              inspection.expectedHead.status,
              authoritySnapshot.content.dependencyFingerprint,
              digestFromContentAddress(
                authoritySnapshot.snapshotId,
                'private-evaluation-authority-snapshot'
              ),
              snapshotArtifact.contentSha256,
              canonicalizeAflTradeJson(authoritySnapshot),
              canonicalizeAflTradeJson(snapshotArtifact),
            ]
          );
          const retainedSnapshot = await transaction.query<RetainedSnapshotRow>(
            `SELECT snapshot_json,artifact_json
               FROM outcome_private_evaluation_authority_snapshot
              WHERE snapshot_id=$1 FOR KEY SHARE`,
            [authoritySnapshot.snapshotId]
          );
          if (
            retainedSnapshot.rows.length !== 1 ||
            canonicalizeAflTradeJson(retainedSnapshot.rows[0]?.snapshot_json) !==
              canonicalizeAflTradeJson(authoritySnapshot) ||
            canonicalizeAflTradeJson(retainedSnapshot.rows[0]?.artifact_json) !==
              canonicalizeAflTradeJson(snapshotArtifact)
          ) {
            throw new TypeError('Private evaluation authority snapshot replay conflicts.');
          }
        }

        const receipt = createPrivateEvaluationInspectionReceipt({
          selector,
          promotedWorkbookSha256: inspection.promotedWorkbookSha256,
          authoritySnapshotId: authoritySnapshot?.snapshotId ?? null,
          inspectedAt: trustedAt,
          validThrough: ready ? inspection.validThrough : null,
          expectedHead: inspection.expectedHead,
          observedDependencies: retainedDependencies,
          blockers: inspection.blockers,
        });
        const receiptArtifact = await retainCanonicalJson({
          repository: dependencies.artifactRepository,
          maximumArtifactBytes: dependencies.maximumArtifactBytes,
          value: receipt,
          createdAt: trustedAt,
        });
        await transaction.query(
          `INSERT INTO outcome_private_evaluation_inspection_receipt
            (receipt_id,authority_snapshot_id,valuation_scope_key,trade_id,workbook_sha256,
             inspected_at,valid_through,expected_head_generation_id,expected_head_revision,
             expected_head_status,state,blocker_count,blocker_fingerprint,receipt_content_sha256,
             artifact_sha256,publication_eligible,publication_prohibited,receipt_json,artifact_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,FALSE,TRUE,$16::jsonb,$17::jsonb)
           ON CONFLICT (receipt_id) DO NOTHING`,
          [
            receipt.receiptId,
            authoritySnapshot?.snapshotId ?? null,
            selector.valuationScopeKey,
            selector.tradeId,
            inspection.promotedWorkbookSha256,
            trustedAt,
            ready ? inspection.validThrough : null,
            inspection.expectedHead.generationId,
            inspection.expectedHead.revision,
            inspection.expectedHead.status,
            receipt.content.state,
            receipt.content.blockers.length,
            receipt.content.blockerFingerprint,
            digestFromContentAddress(receipt.receiptId, 'private-evaluation-inspection'),
            receiptArtifact.contentSha256,
            canonicalizeAflTradeJson(receipt),
            canonicalizeAflTradeJson(receiptArtifact),
          ]
        );
        const retainedReceipt = await transaction.query<RetainedReceiptRow>(
          `SELECT receipt_json,artifact_json
             FROM outcome_private_evaluation_inspection_receipt
            WHERE receipt_id=$1 FOR KEY SHARE`,
          [receipt.receiptId]
        );
        if (
          retainedReceipt.rows.length !== 1 ||
          canonicalizeAflTradeJson(retainedReceipt.rows[0]?.receipt_json) !==
            canonicalizeAflTradeJson(receipt) ||
          canonicalizeAflTradeJson(retainedReceipt.rows[0]?.artifact_json) !==
            canonicalizeAflTradeJson(receiptArtifact)
        ) {
          throw new TypeError('Private evaluation inspection receipt replay conflicts.');
        }
        return receipt.receiptId;
      }, { isolationLevel: 'repeatable_read', accessMode: 'read_write' });
    },

    async load(receiptId): Promise<PrivateEvaluationInspectionReceipt | null> {
      const retained = await dependencies.client.query<RetainedReceiptRow>(
        `SELECT receipt_json,artifact_json
           FROM outcome_private_evaluation_inspection_receipt
          WHERE receipt_id=$1`,
        [receiptId]
      );
      if (retained.rows.length === 0) return null;
      if (retained.rows.length !== 1) {
        throw new TypeError('Private evaluation inspection receipt is ambiguous.');
      }
      return authenticateRetainedDocument({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        document: retained.rows[0]!.receipt_json,
        artifact: retained.rows[0]!.artifact_json,
        parse: (value) => privateEvaluationInspectionReceiptSchema.parse(value),
      });
    },

    async loadAuthoritySnapshot(snapshotId): Promise<PrivateEvaluationAuthoritySnapshot | null> {
      const retained = await dependencies.client.query<RetainedSnapshotRow>(
        `SELECT snapshot_json,artifact_json
           FROM outcome_private_evaluation_authority_snapshot
          WHERE snapshot_id=$1`,
        [snapshotId]
      );
      if (retained.rows.length === 0) return null;
      if (retained.rows.length !== 1) {
        throw new TypeError('Private evaluation authority snapshot is ambiguous.');
      }
      return authenticateRetainedDocument({
        repository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        document: retained.rows[0]!.snapshot_json,
        artifact: retained.rows[0]!.artifact_json,
        parse: (value) => privateEvaluationAuthoritySnapshotSchema.parse(value),
      });
    },
  };
}
