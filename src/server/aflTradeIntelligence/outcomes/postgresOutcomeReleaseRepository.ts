import {
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  type AflDraftTradeOutcomeReleaseRegistry,
} from './outcomeReleaseState';
import {
  createAflDraftTradeOutcomeReleaseRepository,
  type AflDraftTradeOutcomeRegistrySnapshotStore,
  type AflDraftTradeOutcomeReleaseRepository,
} from './outcomeReleaseRepository';

export interface AflOutcomeSqlQueryResult<Row> {
  rows: readonly Row[];
  rowCount: number | null;
}

export interface AflOutcomeSqlTransaction {
  query<Row = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[]
  ): Promise<AflOutcomeSqlQueryResult<Row>>;
}

export interface AflOutcomeSqlClient extends AflOutcomeSqlTransaction {
  transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T>;
}

interface RegistryHeadRow {
  revision: number;
  last_event_id: string | null;
  registry_json: unknown;
}

function parseRegistry(value: unknown): AflDraftTradeOutcomeReleaseRegistry {
  return authenticateAflDraftTradeOutcomeReleaseRegistry(
    structuredClone(value) as AflDraftTradeOutcomeReleaseRegistry
  );
}

async function insertRegisteredManifest(
  transaction: AflOutcomeSqlTransaction,
  registry: AflDraftTradeOutcomeReleaseRegistry
): Promise<void> {
  const event = registry.events.at(-1);
  if (!event || event.content.action !== 'register') return;
  const record = registry.releases[event.content.releaseId];
  const manifest = record.releaseManifest;
  await transaction.query(
    `INSERT INTO outcome_release_manifest
      (release_id, scope_key, environment, created_at, effective_through, manifest_json)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      manifest.releaseId,
      manifest.content.scopeKey,
      manifest.content.environment,
      manifest.content.createdAt,
      manifest.content.effectiveThrough,
      manifest,
    ]
  );
}

async function insertValidatedProjection(
  transaction: AflOutcomeSqlTransaction,
  registry: AflDraftTradeOutcomeReleaseRegistry
): Promise<void> {
  const event = registry.events.at(-1);
  if (!event || event.content.action !== 'validate') return;
  const record = registry.releases[event.content.releaseId];
  const projection = record.projectionManifest;
  if (!projection) throw new Error('A validated factual release has no projection manifest.');
  await transaction.query(
    `INSERT INTO outcome_projection_manifest
      (projection_id, release_id, created_at, manifest_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (projection_id) DO NOTHING`,
    [projection.projectionId, record.releaseId, projection.content.createdAt, projection]
  );
  const persisted = await transaction.query(
    `SELECT projection_id
     FROM outcome_projection_manifest
     WHERE projection_id = $1 AND release_id = $2 AND manifest_json = $3`,
    [projection.projectionId, record.releaseId, projection]
  );
  if (persisted.rows.length !== 1) {
    throw new Error('The validated factual projection conflicts with persisted evidence.');
  }
}

async function insertRegistryEvent(
  transaction: AflOutcomeSqlTransaction,
  registry: AflDraftTradeOutcomeReleaseRegistry
): Promise<void> {
  const event = registry.events.at(-1);
  if (!event || event.content.revision !== registry.revision) {
    throw new Error('The factual registry has no exact event for its next revision.');
  }
  await transaction.query(
    `INSERT INTO outcome_registry_event
      (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.content.revision,
      event.eventId,
      event.content.previousEventId,
      event.content.releaseId,
      event.content.scopeKey,
      event.content.action,
      event.content.occurredAt,
      event,
    ]
  );
  for (const state of event.content.affectedRecordStates) {
    await transaction.query(
      `INSERT INTO outcome_record_state_commitment
        (event_revision, release_id, record_state_id, record_state_json)
       VALUES ($1, $2, $3, $4)`,
      [event.content.revision, state.releaseId, state.recordStateId, state.recordState]
    );
  }
}

async function persistActivePointer(
  transaction: AflOutcomeSqlTransaction,
  registry: AflDraftTradeOutcomeReleaseRegistry
): Promise<void> {
  const event = registry.events.at(-1);
  if (!event) throw new Error('The factual registry transition has no event.');
  const pointer = registry.activeByScope[event.content.scopeKey];
  if (!pointer) {
    await transaction.query('DELETE FROM outcome_active_release WHERE scope_key = $1', [
      event.content.scopeKey,
    ]);
    return;
  }
  await transaction.query(
    `INSERT INTO outcome_active_release (scope_key, release_id, activated_at, revision)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope_key) DO UPDATE SET
       release_id = EXCLUDED.release_id,
       activated_at = EXCLUDED.activated_at,
       revision = EXCLUDED.revision`,
    [event.content.scopeKey, pointer.releaseId, pointer.activatedAt, pointer.revision]
  );
}

export class PostgresAflDraftTradeOutcomeRegistrySnapshotStore implements AflDraftTradeOutcomeRegistrySnapshotStore {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async load(): Promise<AflDraftTradeOutcomeReleaseRegistry> {
    const result = await this.client.query<RegistryHeadRow>(
      `SELECT revision, last_event_id, registry_json
       FROM outcome_registry_head
       WHERE singleton_id = 1`
    );
    if (result.rows.length !== 1) throw new Error('The factual registry head is unavailable.');
    const row = result.rows[0];
    const registry = parseRegistry(row.registry_json);
    if (
      registry.revision !== row.revision ||
      (registry.events.at(-1)?.eventId ?? null) !== row.last_event_id
    ) {
      throw new Error('The factual registry head does not match its authenticated snapshot.');
    }
    return registry;
  }

  async compareAndSwap(input: {
    expectedRevision: number;
    nextRegistry: AflDraftTradeOutcomeReleaseRegistry;
  }): Promise<boolean> {
    const nextRegistry = parseRegistry(input.nextRegistry);
    if (nextRegistry.revision !== input.expectedRevision + 1) {
      throw new Error('A factual registry transaction must advance exactly one revision.');
    }
    return this.client.transaction(async (transaction) => {
      const head = await transaction.query<RegistryHeadRow>(
        `SELECT revision, last_event_id, registry_json
         FROM outcome_registry_head
         WHERE singleton_id = 1
         FOR UPDATE`
      );
      if (head.rows.length !== 1) throw new Error('The factual registry head is unavailable.');
      const current = head.rows[0];
      if (current.revision !== input.expectedRevision) return false;
      const currentRegistry = parseRegistry(current.registry_json);
      const expectedLastEventId = currentRegistry.events.at(-1)?.eventId ?? null;
      const nextEvent = nextRegistry.events.at(-1);
      if (
        currentRegistry.revision !== input.expectedRevision ||
        current.last_event_id !== expectedLastEventId ||
        nextEvent?.content.previousEventId !== expectedLastEventId
      ) {
        throw new Error('The factual registry event chain does not extend the stored head.');
      }

      await insertRegisteredManifest(transaction, nextRegistry);
      await insertValidatedProjection(transaction, nextRegistry);
      await insertRegistryEvent(transaction, nextRegistry);
      await persistActivePointer(transaction, nextRegistry);
      const updated = await transaction.query(
        `UPDATE outcome_registry_head
         SET revision = $1, last_event_id = $2, registry_json = $3, updated_at = CURRENT_TIMESTAMP
         WHERE singleton_id = 1 AND revision = $4`,
        [nextRegistry.revision, nextEvent.eventId, nextRegistry, input.expectedRevision]
      );
      if (updated.rowCount !== 1) {
        throw new Error('The locked factual registry head could not be advanced.');
      }
      return true;
    });
  }
}

export function createPostgresAflDraftTradeOutcomeReleaseRepository(
  client: AflOutcomeSqlClient
): AflDraftTradeOutcomeReleaseRepository {
  return createAflDraftTradeOutcomeReleaseRepository(
    new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(client)
  );
}
