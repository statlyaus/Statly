import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
  type AflTradeProjectionManifest,
  type AflTradePublicationManifest,
} from '../artifacts/manifestContracts';
import {
  aflTradeValuationOutputCustodyIndexResultSchema,
  aflTradeValuationOutputCustodyIndexVerificationSchema,
  verifyAflTradeValuationOutputCustodyIndex,
} from '../valuation/valuationOutputCustodyIndex';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import {
  authenticateAflTradePublicationRegistryPersistence,
  createAflTradePublicationPersistenceEvent,
  type AflTradeProjectionArtifactBinding,
  type AflTradePublicationPersistenceEvent,
} from './publicationRegistryPersistence';
import {
  applyAflTradePublicationCommand,
  registerAflTradePublication,
  type AflTradePublicationCommand,
  type AflTradePublicationRegistry,
} from './publicationState';
import {
  createAflTradeProjectionReleaseArtifact,
  type AflTradeProjectionReleaseArtifact,
} from './projectionReleaseArtifact';

export type AflTradePublicationRepositoryErrorCode =
  'INVALID_INPUT' | 'INVALID_STORED_STATE' | 'STALE_REVISION' | 'CONFLICTING_REPLAY';

export class AflTradePublicationRepositoryError extends Error {
  constructor(
    public readonly code: AflTradePublicationRepositoryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradePublicationRepositoryError';
  }
}

export interface AflTradePublicationMutationResult {
  registry: AflTradePublicationRegistry;
  idempotentReplay: boolean;
}

export interface AflTradePublicationRegisterInput {
  expectedRevision: number;
  manifest: AflTradePublicationManifest;
  actor: string;
  evidenceId: string;
  custodyIndexVerification?: z.infer<typeof aflTradeValuationOutputCustodyIndexVerificationSchema>;
}

export interface AflTradePublicationApplyInput {
  expectedRevision: number;
  expectedEnvironment?: AflTradeDecisionEnvironment;
  command: AflTradePublicationCommand;
  projectionArtifactId?: string;
  projectionReleaseArtifact?: AflTradeProjectionReleaseArtifact;
}

export interface AflTradePublicationRepository {
  load(): Promise<AflTradePublicationRegistry>;
  register(input: AflTradePublicationRegisterInput): Promise<AflTradePublicationMutationResult>;
  apply(input: AflTradePublicationApplyInput): Promise<AflTradePublicationMutationResult>;
}

interface HeadRow extends Record<string, unknown> {
  revision: number;
  registry_json: unknown;
}

interface ManifestRow extends Record<string, unknown> {
  manifest_json: unknown;
}

interface ProjectionRow extends Record<string, unknown> {
  manifest_json: unknown;
  artifact_id: string;
}

interface EventRow extends Record<string, unknown> {
  event_json: unknown;
}

interface PointerRow extends Record<string, unknown> {
  scope_key: string;
  publication_id: string;
  registry_revision: number;
  activated_at: string | Date;
}

interface CustodyIndexRow extends Record<string, unknown> {
  custody_index_id: string;
  index_json: unknown;
  artifact_json: unknown;
  finalized_at: string | Date | null;
}

interface CustodyIndexEntryRow extends Record<string, unknown> {
  custody_index_id: string;
  ordinal: number;
  entry_json: unknown;
}

type CustodyIndexResult = z.infer<typeof aflTradeValuationOutputCustodyIndexResultSchema>;

interface LoadedPersistence {
  registry: AflTradePublicationRegistry;
  manifests: AflTradePublicationManifest[];
  projections: AflTradeProjectionArtifactBinding[];
  events: AflTradePublicationPersistenceEvent[];
  custodyIndexes: CustodyIndexResult[];
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function custodyBinding(index: CustodyIndexResult) {
  const custody = index.valuationOutputCustodyIndex.content;
  return {
    schemaVersion: custody.schemaVersion,
    valuationOutputCustodyIndexId: index.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
    artifactRef: index.artifactRef,
    environment: custody.environment,
    valuationBundleId: custody.valuationBundleId,
    valuationOutputInventoryIndexId:
      custody.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    inventorySetSha256: custody.valuationOutputInventoryIndex.inventorySetSha256,
    scopeKey: custody.scopeKey,
    valueUnitId: custody.valueUnitId,
    entryCount: custody.entryCount,
    custodyReceiptSetSha256: custody.custodyReceiptSetSha256,
  };
}

function parseStoredCustodyIndexes(
  indexRows: readonly CustodyIndexRow[],
  entryRows: readonly CustodyIndexEntryRow[]
): CustodyIndexResult[] {
  const entriesByIndex = new Map<string, unknown[]>();
  for (const row of entryRows) {
    const entries = entriesByIndex.get(row.custody_index_id) ?? [];
    if (row.ordinal !== entries.length) {
      throw invalidStored('A custody index has non-contiguous stored ordinals.');
    }
    entries.push(row.entry_json);
    entriesByIndex.set(row.custody_index_id, entries);
  }
  return indexRows.map((row) => {
    if (row.finalized_at === null) {
      throw invalidStored('A loaded custody index is not finalized.');
    }
    const result = aflTradeValuationOutputCustodyIndexResultSchema.parse({
      valuationOutputCustodyIndex: row.index_json,
      artifactRef: row.artifact_json,
    });
    if (
      result.valuationOutputCustodyIndex.valuationOutputCustodyIndexId !== row.custody_index_id ||
      !exact(
        entriesByIndex.get(row.custody_index_id) ?? [],
        result.valuationOutputCustodyIndex.content.entries
      )
    ) {
      throw invalidStored('A custody index disagrees with its exact stored entry membership.');
    }
    return result;
  });
}

function requireManifestCustody(
  manifest: AflTradePublicationManifest,
  verification: AflTradePublicationRegisterInput['custodyIndexVerification']
): CustodyIndexResult | null {
  if (manifest.content.schemaVersion !== 'afl-trade-publication/v4') {
    if (verification !== undefined) {
      throw new AflTradePublicationRepositoryError(
        'INVALID_INPUT',
        'Legacy publication registration cannot carry a custody-index verification.'
      );
    }
    return null;
  }
  if (verification === undefined || !verifyAflTradeValuationOutputCustodyIndex(verification)) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Publication v4 registration requires an exact replayable custody index.'
    );
  }
  const parsed = aflTradeValuationOutputCustodyIndexVerificationSchema.parse(verification);
  if (!exact(custodyBinding(parsed.output), manifest.content.valuationOutputCustodyIndex)) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Publication v4 does not bind the supplied exact custody index.'
    );
  }
  return parsed.output;
}

function invalidStored(message: string, cause?: unknown): AflTradePublicationRepositoryError {
  return new AflTradePublicationRepositoryError('INVALID_STORED_STATE', message, { cause });
}

function requireRevision(value: unknown): number {
  const parsed = z.number().int().nonnegative().safeParse(value);
  if (!parsed.success) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Expected publication registry revision must be a non-negative integer.'
    );
  }
  return parsed.data;
}

async function loadPersistence(
  transaction: AflOutcomeSqlTransaction,
  lockHead: boolean
): Promise<LoadedPersistence> {
  const headRows = await transaction.query<HeadRow>(
    `SELECT revision, registry_json
       FROM outcome_valuation_publication_registry_head
      WHERE singleton_id = 1${lockHead ? ' FOR UPDATE' : ''}`
  );
  if (headRows.rows.length !== 1) throw invalidStored('The publication registry head is missing.');
  const [manifestRows, projectionRows, eventRows, pointerRows, custodyIndexRows, custodyEntryRows] =
    await Promise.all([
      transaction.query<ManifestRow>(
        `SELECT manifest_json FROM outcome_valuation_publication_manifest ORDER BY created_at, publication_id`
      ),
      transaction.query<ProjectionRow>(
        `SELECT manifest_json, artifact_id FROM outcome_valuation_projection_manifest ORDER BY created_at, projection_id`
      ),
      transaction.query<EventRow>(
        `SELECT event_json FROM outcome_valuation_publication_event ORDER BY revision`
      ),
      transaction.query<PointerRow>(
        `SELECT scope_key, publication_id, registry_revision, activated_at
         FROM outcome_valuation_active_publication ORDER BY scope_key`
      ),
      transaction.query<CustodyIndexRow>(
        `SELECT custody_index_id, index_json, artifact_json, finalized_at
         FROM outcome_valuation_output_custody_index ORDER BY created_at, custody_index_id`
      ),
      transaction.query<CustodyIndexEntryRow>(
        `SELECT custody_index_id, ordinal, entry_json
         FROM outcome_valuation_output_custody_index_entry
        ORDER BY custody_index_id, ordinal`
      ),
    ]);
  const manifests = manifestRows.rows.map((row) =>
    aflTradePublicationManifestSchema.parse(row.manifest_json)
  );
  const projections = projectionRows.rows.map((row) => ({
    manifest: aflTradeProjectionManifestSchema.parse(row.manifest_json),
    artifactId: row.artifact_id,
  }));
  const events = eventRows.rows.map((row) => row.event_json as AflTradePublicationPersistenceEvent);
  const custodyIndexes = parseStoredCustodyIndexes(custodyIndexRows.rows, custodyEntryRows.rows);
  for (const manifest of manifests) {
    if (manifest.content.schemaVersion !== 'afl-trade-publication/v4') continue;
    const manifestCustody = manifest.content.valuationOutputCustodyIndex;
    const custody = custodyIndexes.find(
      (candidate) =>
        candidate.valuationOutputCustodyIndex.valuationOutputCustodyIndexId ===
        manifestCustody.valuationOutputCustodyIndexId
    );
    if (custody === undefined || !exact(custodyBinding(custody), manifestCustody)) {
      throw invalidStored('A publication v4 does not match its durable custody index.');
    }
  }
  for (const projection of projections) {
    if (projection.manifest.content.schemaVersion !== 'afl-trade-projection/v3') continue;
    const publication = manifests.find(
      ({ publicationId }) => publicationId === projection.manifest.content.publicationId
    );
    if (
      publication?.content.schemaVersion !== 'afl-trade-publication/v4' ||
      !exact(
        projection.manifest.content.valuationOutputCustodyIndex,
        publication.content.valuationOutputCustodyIndex
      )
    ) {
      throw invalidStored('A projection v3 does not match its publication custody index.');
    }
  }
  const activePointers = pointerRows.rows.map((row) => ({
    scopeKey: row.scope_key,
    publicationId: row.publication_id,
    revision: row.registry_revision,
    activatedAt:
      row.activated_at instanceof Date ? row.activated_at.toISOString() : row.activated_at,
  }));
  let registry: AflTradePublicationRegistry;
  try {
    registry = authenticateAflTradePublicationRegistryPersistence({
      headRegistry: headRows.rows[0].registry_json,
      publicationManifests: manifests,
      projectionBindings: projections,
      events,
      activePointers,
    });
  } catch (cause) {
    throw invalidStored('The persisted publication registry failed authentication.', cause);
  }
  if (registry.revision !== headRows.rows[0].revision) {
    throw invalidStored('The publication registry JSON and relational head revision disagree.');
  }
  return { registry, manifests, projections, events, custodyIndexes };
}

function previousEventId(loaded: LoadedPersistence): string | null {
  return loaded.events.at(-1)?.eventId ?? null;
}

async function insertEvent(
  transaction: AflOutcomeSqlTransaction,
  event: AflTradePublicationPersistenceEvent
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_valuation_publication_event (
       revision, event_id, previous_event_id, publication_id, action, occurred_at, event_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      event.content.revision,
      event.eventId,
      event.content.previousEventId,
      event.content.publicationId,
      event.content.action,
      event.content.occurredAt,
      event,
    ]
  );
}

async function persistHead(
  transaction: AflOutcomeSqlTransaction,
  previous: AflTradePublicationRegistry,
  next: AflTradePublicationRegistry,
  occurredAt: string
): Promise<void> {
  const updated = await transaction.query(
    `UPDATE outcome_valuation_publication_registry_head
        SET revision = $1, registry_json = $2, updated_at = $3
      WHERE singleton_id = 1 AND revision = $4`,
    [next.revision, next, occurredAt, previous.revision]
  );
  if (updated.rowCount !== 1) {
    throw new AflTradePublicationRepositoryError(
      'STALE_REVISION',
      'The publication registry head changed before the mutation could commit.'
    );
  }
}

async function persistPointerChanges(
  transaction: AflOutcomeSqlTransaction,
  previous: AflTradePublicationRegistry,
  next: AflTradePublicationRegistry
): Promise<void> {
  const scopes = new Set([
    ...Object.keys(previous.activeByScope),
    ...Object.keys(next.activeByScope),
  ]);
  for (const scopeKey of scopes) {
    const before = previous.activeByScope[scopeKey];
    const after = next.activeByScope[scopeKey];
    if (exact(before ?? null, after ?? null)) continue;
    if (after === undefined) {
      await transaction.query(
        `DELETE FROM outcome_valuation_active_publication WHERE scope_key = $1`,
        [scopeKey]
      );
    } else {
      await transaction.query(
        `INSERT INTO outcome_valuation_active_publication (
           scope_key, publication_id, registry_revision, activated_at
         ) VALUES ($1,$2,$3,$4)
         ON CONFLICT (scope_key) DO UPDATE SET
           publication_id = EXCLUDED.publication_id,
           registry_revision = EXCLUDED.registry_revision,
           activated_at = EXCLUDED.activated_at`,
        [scopeKey, after.publicationId, after.revision, after.activatedAt]
      );
    }
  }
}

function projectionFromCommand(command: AflTradePublicationCommand): AflTradeProjectionManifest {
  if (command.action !== 'validate') {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Only validation commands carry projection manifests.'
    );
  }
  if ('projectionManifest' in command && command.projectionManifest !== undefined) {
    return aflTradeProjectionManifestSchema.parse(command.projectionManifest);
  }
  if (
    'projectionManifestVerification' in command &&
    command.projectionManifestVerification !== undefined
  ) {
    return aflTradeProjectionManifestSchema.parse(
      command.projectionManifestVerification.output.projectionManifest
    );
  }
  throw new AflTradePublicationRepositoryError(
    'INVALID_INPUT',
    'Validation persistence requires an authenticated projection manifest.'
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function projectionArtifactIdForInput(
  input: AflTradePublicationApplyInput,
  projection: AflTradeProjectionManifest
): string {
  if (projection.content.schemaVersion !== 'afl-trade-projection/v3') {
    if (input.projectionReleaseArtifact !== undefined) {
      throw new AflTradePublicationRepositoryError(
        'INVALID_INPUT',
        'Legacy projections cannot use a custody-backed release artifact.'
      );
    }
    return aflTradeContentAddressedIdSchema('artifact').parse(input.projectionArtifactId);
  }
  if (input.projectionArtifactId !== undefined) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Custody-backed projections cannot use a legacy projection artifact identifier.'
    );
  }
  if (
    !('projectionManifestVerification' in input.command) ||
    input.command.projectionManifestVerification === undefined ||
    input.projectionReleaseArtifact === undefined
  ) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Custody-backed validation requires the exact projection release artifact.'
    );
  }
  let expected: AflTradeProjectionReleaseArtifact;
  try {
    expected = createAflTradeProjectionReleaseArtifact({
      verification: input.command.projectionManifestVerification,
      createdAt: input.projectionReleaseArtifact.artifactRef.createdAt,
    });
  } catch (cause) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Projection release artifact failed exact materialization authentication.',
      { cause }
    );
  }
  if (
    !exact(expected.artifactRef, input.projectionReleaseArtifact.artifactRef) ||
    !exact(expected.verification, input.projectionReleaseArtifact.verification) ||
    !sameBytes(expected.bytes, input.projectionReleaseArtifact.bytes)
  ) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Projection release artifact does not match the validation command.'
    );
  }
  return expected.artifactRef.artifactId;
}

function isExactCommandReplay(
  loaded: LoadedPersistence,
  input: AflTradePublicationApplyInput
): boolean {
  const record = loaded.registry.publications[input.command.publicationId];
  const latest = record?.events.at(-1);
  const expectedState = {
    validate: 'validated',
    approve: 'approved',
    publish: 'published',
    reject: 'rejected',
    withdraw: 'withdrawn',
  }[input.command.action];
  if (
    record === undefined ||
    latest === undefined ||
    latest.to !== expectedState ||
    latest.actor !== input.command.actor ||
    latest.evidenceId !== input.command.evidenceId ||
    latest.reason !== (input.command.reason ?? null)
  ) {
    return false;
  }
  if (input.command.action === 'approve') {
    return record.gate4DecisionId === input.command.gateDecisionId;
  }
  if (input.command.action === 'publish') {
    return record.gate5DecisionId === input.command.gateDecisionId;
  }
  if (input.command.action === 'validate') {
    const projection = projectionFromCommand(input.command);
    const artifactId = projectionArtifactIdForInput(input, projection);
    return (
      record.projectionId === projection.projectionId &&
      loaded.projections.some(
        (binding) =>
          binding.manifest.projectionId === projection.projectionId &&
          binding.artifactId === artifactId
      )
    );
  }
  return input.projectionArtifactId === undefined && input.projectionReleaseArtifact === undefined;
}

async function persistCustodyIndex(
  transaction: AflOutcomeSqlTransaction,
  loaded: LoadedPersistence,
  custodyIndex: CustodyIndexResult
): Promise<void> {
  const content = custodyIndex.valuationOutputCustodyIndex.content;
  const sameScope = loaded.custodyIndexes.find((candidate) => {
    const stored = candidate.valuationOutputCustodyIndex.content;
    return (
      stored.environment === content.environment &&
      stored.valuationBundleId === content.valuationBundleId &&
      stored.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ===
        content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId
    );
  });
  if (sameScope !== undefined) {
    if (!exact(sameScope, custodyIndex)) {
      throw new AflTradePublicationRepositoryError(
        'CONFLICTING_REPLAY',
        'The custody-index scope already names different immutable evidence.'
      );
    }
    return;
  }
  const index = custodyIndex.valuationOutputCustodyIndex;
  await transaction.query(
    `INSERT INTO outcome_valuation_output_custody_index (
       custody_index_id, environment, valuation_bundle_id, inventory_index_id,
       scope_key, value_unit_id, entry_count, custody_receipt_set_sha256, created_at,
       index_content_canonical_json, index_canonical_json, index_json, artifact_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text,$11::text,$11::jsonb,$12::jsonb)`,
    [
      index.valuationOutputCustodyIndexId,
      content.environment,
      content.valuationBundleId,
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      content.scopeKey,
      content.valueUnitId,
      content.entryCount,
      content.custodyReceiptSetSha256,
      content.createdAt,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(index),
      canonicalizeAflTradeJson(custodyIndex.artifactRef),
    ]
  );
  for (const [ordinal, entry] of content.entries.entries()) {
    await transaction.query(
      `INSERT INTO outcome_valuation_output_custody_index_entry (
         custody_index_id, ordinal, trade_id, valuation_case_id,
         valuation_output_inventory_id, operation_id, receipt_id, entry_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        index.valuationOutputCustodyIndexId,
        ordinal,
        entry.tradeId,
        entry.valuationCaseId,
        entry.valuationOutputInventoryId,
        entry.operationId,
        entry.receiptId,
        canonicalizeAflTradeJson(entry),
      ]
    );
  }
  const finalized = await transaction.query(
    `UPDATE outcome_valuation_output_custody_index
        SET finalized_at=date_trunc('milliseconds',transaction_timestamp())
      WHERE custody_index_id=$1 AND finalized_at IS NULL`,
    [index.valuationOutputCustodyIndexId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradePublicationRepositoryError(
      'CONFLICTING_REPLAY',
      'The custody index lost its atomic finalization race.'
    );
  }
}

export async function persistPostgresAflTradeValuationOutputCustodyIndex(
  client: AflOutcomeSqlClient,
  unparsedVerification: unknown
): Promise<void> {
  const verification =
    aflTradeValuationOutputCustodyIndexVerificationSchema.safeParse(unparsedVerification);
  if (!verification.success || !verifyAflTradeValuationOutputCustodyIndex(verification.data)) {
    throw new AflTradePublicationRepositoryError(
      'INVALID_INPUT',
      'Custody-index persistence requires one exact replayable verification envelope.'
    );
  }
  const custodyIndex = verification.data.output;
  const content = custodyIndex.valuationOutputCustodyIndex.content;
  await client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `valuation-output-custody-index:${content.environment}:${content.valuationBundleId}:${content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId}`,
    ]);
    const loaded = await loadPersistence(transaction, false);
    await persistCustodyIndex(transaction, loaded, custodyIndex);
  });
}

class PostgresAflTradePublicationRepository implements AflTradePublicationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async load(): Promise<AflTradePublicationRegistry> {
    return (await loadPersistence(this.client, false)).registry;
  }

  async register(
    input: AflTradePublicationRegisterInput
  ): Promise<AflTradePublicationMutationResult> {
    const expectedRevision = requireRevision(input.expectedRevision);
    const manifest = aflTradePublicationManifestSchema.parse(input.manifest);
    const custodyIndex = requireManifestCustody(manifest, input.custodyIndexVerification);
    return this.client.transaction(async (transaction) => {
      const loaded = await loadPersistence(transaction, true);
      const existing = loaded.registry.publications[manifest.publicationId];
      if (existing !== undefined) {
        const storedManifest = loaded.manifests.find(
          (candidate) => candidate.publicationId === manifest.publicationId
        );
        const initialEvent = existing.events[0];
        if (
          storedManifest !== undefined &&
          exact(storedManifest, manifest) &&
          initialEvent?.actor === input.actor &&
          initialEvent.evidenceId === input.evidenceId
        ) {
          return { registry: loaded.registry, idempotentReplay: true };
        }
        throw new AflTradePublicationRepositoryError(
          'CONFLICTING_REPLAY',
          'The publication identity already names different registration evidence.'
        );
      }
      if (loaded.registry.revision !== expectedRevision) {
        throw new AflTradePublicationRepositoryError(
          'STALE_REVISION',
          'The publication registry revision changed before registration.'
        );
      }
      const next = registerAflTradePublication(loaded.registry, {
        manifest,
        actor: input.actor,
        evidenceId: input.evidenceId,
      });
      const event = createAflTradePublicationPersistenceEvent({
        previousRegistry: loaded.registry,
        nextRegistry: next,
        previousEventId: previousEventId(loaded),
        publicationId: manifest.publicationId,
        action: 'register',
      });
      if (custodyIndex !== null) {
        await persistCustodyIndex(transaction, loaded, custodyIndex);
      }
      await transaction.query(
        `INSERT INTO outcome_valuation_publication_manifest (
           publication_id, custody_index_id, scope_key, created_at, manifest_json
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          manifest.publicationId,
          custodyIndex?.valuationOutputCustodyIndex.valuationOutputCustodyIndexId ?? null,
          manifest.content.scopeKey,
          manifest.content.createdAt,
          manifest,
        ]
      );
      await insertEvent(transaction, event);
      await persistHead(transaction, loaded.registry, next, event.content.occurredAt);
      return { registry: next, idempotentReplay: false };
    });
  }

  async apply(input: AflTradePublicationApplyInput): Promise<AflTradePublicationMutationResult> {
    const expectedRevision = requireRevision(input.expectedRevision);
    return this.client.transaction(async (transaction) => {
      const loaded = await loadPersistence(transaction, true);
      if (input.expectedEnvironment !== undefined) {
        const manifest = loaded.manifests.find(
          (candidate) => candidate.publicationId === input.command.publicationId
        );
        if (manifest?.content.environment !== input.expectedEnvironment) {
          throw new AflTradePublicationRepositoryError(
            'INVALID_INPUT',
            'The publication command cannot cross the configured environment boundary.'
          );
        }
      }
      if (isExactCommandReplay(loaded, input)) {
        return { registry: loaded.registry, idempotentReplay: true };
      }
      if (loaded.registry.revision !== expectedRevision) {
        throw new AflTradePublicationRepositoryError(
          'STALE_REVISION',
          'The publication registry revision changed before the command.'
        );
      }
      let next: AflTradePublicationRegistry;
      try {
        next = applyAflTradePublicationCommand(loaded.registry, input.command);
      } catch (cause) {
        throw new AflTradePublicationRepositoryError(
          'INVALID_INPUT',
          'The publication command failed the canonical state machine.',
          { cause }
        );
      }
      if (input.command.action === 'validate') {
        const projection = projectionFromCommand(input.command);
        const publication = loaded.manifests.find(
          ({ publicationId }) => publicationId === projection.content.publicationId
        );
        const currentPair =
          publication?.content.schemaVersion === 'afl-trade-publication/v4' &&
          projection.content.schemaVersion === 'afl-trade-projection/v3' &&
          exact(
            publication.content.valuationOutputCustodyIndex,
            projection.content.valuationOutputCustodyIndex
          );
        const legacyPair =
          publication !== undefined &&
          publication.content.schemaVersion !== 'afl-trade-publication/v4' &&
          projection.content.schemaVersion !== 'afl-trade-projection/v3';
        if (!currentPair && !legacyPair) {
          throw new AflTradePublicationRepositoryError(
            'INVALID_INPUT',
            'Publication validation cannot mix legacy and custody-backed manifest generations.'
          );
        }
        const artifactId = projectionArtifactIdForInput(input, projection);
        await transaction.query(
          `INSERT INTO outcome_valuation_projection_manifest (
             projection_id, publication_id, custody_index_id, artifact_id, created_at, manifest_json
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            projection.projectionId,
            projection.content.publicationId,
            projection.content.schemaVersion === 'afl-trade-projection/v3'
              ? projection.content.valuationOutputCustodyIndex.valuationOutputCustodyIndexId
              : null,
            artifactId,
            projection.content.createdAt,
            projection,
          ]
        );
      } else if (
        input.projectionArtifactId !== undefined ||
        input.projectionReleaseArtifact !== undefined
      ) {
        throw new AflTradePublicationRepositoryError(
          'INVALID_INPUT',
          'Only validation commands may persist a projection artifact binding.'
        );
      }
      const event = createAflTradePublicationPersistenceEvent({
        previousRegistry: loaded.registry,
        nextRegistry: next,
        previousEventId: previousEventId(loaded),
        publicationId: input.command.publicationId,
        action: input.command.action,
      });
      await insertEvent(transaction, event);
      await persistHead(transaction, loaded.registry, next, event.content.occurredAt);
      await persistPointerChanges(transaction, loaded.registry, next);
      return { registry: next, idempotentReplay: false };
    });
  }
}

export function createPostgresAflTradePublicationRepository(
  client: AflOutcomeSqlClient
): AflTradePublicationRepository {
  return new PostgresAflTradePublicationRepository(client);
}
