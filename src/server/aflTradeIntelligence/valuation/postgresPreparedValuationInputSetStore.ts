import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePreparedValuationInputSetSchema,
  type AflTradePreparedValuationInputEntry,
  type AflTradePreparedValuationInputSet,
} from './preparedValuationInputSet';

interface PreparedSetRow {
  content_sha256: string;
  schema_version: string;
  environment: string;
  scope_key: string;
  factual_release_scope_key: string;
  factual_release_id: string;
  qualification_report_id: string;
  prepared_at: Date | string;
  prepared_set_json: unknown;
  content_canonical_json: string;
  prepared_set_canonical_json: string;
  finalized_at: Date | string | null;
  trade_count: number;
  ready_count: number;
  blocked_count: number;
  actual_count: number;
  actual_ready_count: number;
  actual_blocked_count: number;
}

interface PreparedEntryRow {
  ordinal: number;
  trade_id: string;
  state: 'ready' | 'blocked';
  entry_canonical_json: string;
  entry_json: unknown;
}

interface CurrentPreparedSetHeadRow {
  scope_key: string;
  prepared_input_set_id: string;
  revision: number;
  activated_at: Date | string;
}

export interface AflTradeCurrentPreparedValuationInputHead {
  readonly scopeKey: string;
  readonly preparedInputSetId: string;
  readonly revision: number;
  readonly activatedAt: string;
}

export interface AflTradeCurrentPreparedValuationInputSet {
  readonly head: AflTradeCurrentPreparedValuationInputHead;
  readonly preparedInputSet: AflTradePreparedValuationInputSet;
}

export interface AflTradeCurrentPreparedValuationInputTrade extends AflTradeCurrentPreparedValuationInputSet {
  readonly entry: AflTradePreparedValuationInputEntry;
}

export class AflTradePreparedValuationInputCohortCache {
  private key: string | null = null;
  private value: Promise<AflTradePreparedValuationInputSet> | null = null;

  load(
    head: AflTradeCurrentPreparedValuationInputHead,
    loader: () => Promise<AflTradePreparedValuationInputSet>
  ): Promise<AflTradePreparedValuationInputSet> {
    const key = `${head.scopeKey}\u0000${head.preparedInputSetId}\u0000${head.revision}`;
    if (this.key !== key || this.value === null) {
      this.key = key;
      this.value = loader().catch((error: unknown) => {
        if (this.key === key) {
          this.key = null;
          this.value = null;
        }
        throw error;
      });
    }
    return this.value;
  }
}

export class AflTradePreparedValuationInputSetStoreError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INTEGRITY_MISMATCH' | 'REPLAY_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePreparedValuationInputSetStoreError';
  }
}

function digestFromId(identifier: string, prefix: string): string {
  const expectedPrefix = `${prefix}:`;
  if (!identifier.startsWith(expectedPrefix)) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      `Expected ${prefix} content address.`
    );
  }
  return identifier.slice(expectedPrefix.length);
}

async function loadExactFromClient(
  client: AflOutcomeSqlTransaction,
  preparedInputSetId: string
): Promise<AflTradePreparedValuationInputSet> {
  const result = await client.query<PreparedSetRow>(
    `SELECT content_sha256,schema_version,environment,scope_key,factual_release_scope_key,
       factual_release_id,qualification_report_id,prepared_at,
       prepared_set_json,content_canonical_json,prepared_set_canonical_json,finalized_at,
       trade_count,ready_count,blocked_count,
       (SELECT count(*)::integer FROM outcome_prepared_valuation_input_entry entry
         WHERE entry.prepared_input_set_id=prepared.prepared_input_set_id) AS actual_count,
       (SELECT count(*)::integer FROM outcome_prepared_valuation_input_entry entry
         WHERE entry.prepared_input_set_id=prepared.prepared_input_set_id
           AND entry.state='ready') AS actual_ready_count,
       (SELECT count(*)::integer FROM outcome_prepared_valuation_input_entry entry
         WHERE entry.prepared_input_set_id=prepared.prepared_input_set_id
           AND entry.state='blocked') AS actual_blocked_count
     FROM outcome_prepared_valuation_input_set prepared
     WHERE prepared_input_set_id=$1`,
    [preparedInputSetId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'NOT_FOUND',
      'Prepared valuation input set was not found.'
    );
  }

  let prepared: AflTradePreparedValuationInputSet;
  try {
    prepared = aflTradePreparedValuationInputSetSchema.parse(row.prepared_set_json);
  } catch {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Stored prepared valuation input set does not satisfy its contract.'
    );
  }
  const preparedAt =
    row.prepared_at instanceof Date
      ? row.prepared_at.toISOString()
      : new Date(row.prepared_at).toISOString();
  if (
    prepared.preparedInputSetId !== preparedInputSetId ||
    row.content_sha256 !== digestFromId(preparedInputSetId, 'prepared-valuation-input-set') ||
    row.schema_version !== prepared.content.schemaVersion ||
    row.environment !== prepared.content.environment ||
    row.scope_key !== prepared.content.scopeKey ||
    row.factual_release_scope_key !== prepared.content.factualReleaseScopeKey ||
    row.factual_release_id !== prepared.content.factualReleaseId ||
    row.qualification_report_id !== prepared.content.qualificationReportId ||
    preparedAt !== prepared.content.preparedAt ||
    !row.finalized_at ||
    row.content_canonical_json !== canonicalizeAflTradeJson(prepared.content) ||
    row.prepared_set_canonical_json !== canonicalizeAflTradeJson(prepared) ||
    row.trade_count !== prepared.content.tradeCount ||
    row.ready_count !== prepared.content.readyCount ||
    row.blocked_count !== prepared.content.blockedCount ||
    row.actual_count !== prepared.content.tradeCount ||
    row.actual_ready_count !== prepared.content.readyCount ||
    row.actual_blocked_count !== prepared.content.blockedCount
  ) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Stored prepared valuation input set is incomplete or disagrees with its immutable identity.'
    );
  }

  const entryResult = await client.query<PreparedEntryRow>(
    `SELECT ordinal,trade_id,state,entry_canonical_json,entry_json
       FROM outcome_prepared_valuation_input_entry
      WHERE prepared_input_set_id=$1 ORDER BY ordinal`,
    [preparedInputSetId]
  );
  const entriesMatch = entryResult.rows.every((entryRow, index) => {
    const expected = prepared.content.entries[index];
    return (
      entryRow.ordinal === index + 1 &&
      entryRow.trade_id === expected?.tradeId &&
      entryRow.state === expected?.state &&
      entryRow.entry_canonical_json === canonicalizeAflTradeJson(expected) &&
      canonicalizeAflTradeJson(entryRow.entry_json) === canonicalizeAflTradeJson(expected)
    );
  });
  if (entryResult.rows.length !== prepared.content.tradeCount || !entriesMatch) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Stored prepared valuation input entries do not exactly match their finalized parent.'
    );
  }
  return prepared;
}

function authenticateCurrentHead(
  row: CurrentPreparedSetHeadRow
): AflTradeCurrentPreparedValuationInputHead {
  const activatedAt =
    row.activated_at instanceof Date
      ? row.activated_at.toISOString()
      : new Date(row.activated_at).toISOString();
  if (
    row.scope_key.trim() === '' ||
    row.prepared_input_set_id.trim() === '' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision <= 0
  ) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Current prepared valuation input head is malformed.'
    );
  }
  return {
    scopeKey: row.scope_key,
    preparedInputSetId: row.prepared_input_set_id,
    revision: row.revision,
    activatedAt,
  };
}

async function loadCurrentFromClient(
  client: AflOutcomeSqlTransaction,
  scopeKey: string
): Promise<AflTradeCurrentPreparedValuationInputSet | null> {
  const result = await client.query<CurrentPreparedSetHeadRow>(
    `SELECT scope_key,prepared_input_set_id,revision,activated_at
       FROM outcome_current_prepared_valuation_input_set WHERE scope_key=$1`,
    [scopeKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const head = authenticateCurrentHead(row);
  const preparedInputSet = await loadExactFromClient(client, head.preparedInputSetId);
  if (
    preparedInputSet.content.schemaVersion !== 'afl-trade-prepared-valuation-input-set/v3' ||
    preparedInputSet.content.scopeKey !== scopeKey ||
    head.scopeKey !== scopeKey
  ) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Current prepared valuation input head does not authenticate finalized v3 scope authority.'
    );
  }
  return { head, preparedInputSet };
}

export async function loadCurrentAflTradePreparedValuationInputTradeFromTransaction(
  transaction: AflOutcomeSqlTransaction,
  input: { readonly scopeKey: string; readonly tradeId: string },
  cache?: AflTradePreparedValuationInputCohortCache
): Promise<AflTradeCurrentPreparedValuationInputTrade | null> {
  if (input.scopeKey.trim() === '' || input.tradeId.trim() === '') {
    throw new TypeError('Current prepared trade authority requires a complete selector.');
  }
  const headResult = await transaction.query<CurrentPreparedSetHeadRow>(
    `SELECT scope_key,prepared_input_set_id,revision,activated_at
       FROM outcome_current_prepared_valuation_input_set WHERE scope_key=$1`,
    [input.scopeKey]
  );
  const headRow = headResult.rows[0];
  if (headRow === undefined) return null;
  const head = authenticateCurrentHead(headRow);
  const preparedInputSet = await (cache?.load(head, () =>
    loadExactFromClient(transaction, head.preparedInputSetId)
  ) ?? loadExactFromClient(transaction, head.preparedInputSetId));
  if (
    preparedInputSet.content.schemaVersion !== 'afl-trade-prepared-valuation-input-set/v3' ||
    preparedInputSet.content.scopeKey !== input.scopeKey ||
    head.scopeKey !== input.scopeKey
  ) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Current prepared valuation input head does not authenticate finalized v3 scope authority.'
    );
  }
  const entryResult = await transaction.query<PreparedEntryRow>(
    `SELECT ordinal,trade_id,state,entry_canonical_json,entry_json
       FROM outcome_prepared_valuation_input_entry
      WHERE prepared_input_set_id=$1 AND trade_id=$2`,
    [head.preparedInputSetId, input.tradeId]
  );
  const row = entryResult.rows[0];
  if (row === undefined) return null;
  const expected = preparedInputSet.content.entries[row.ordinal - 1];
  if (
    entryResult.rows.length !== 1 ||
    row.ordinal < 1 ||
    row.trade_id !== input.tradeId ||
    expected?.tradeId !== row.trade_id ||
    expected.state !== row.state ||
    row.entry_canonical_json !== canonicalizeAflTradeJson(expected) ||
    canonicalizeAflTradeJson(row.entry_json) !== canonicalizeAflTradeJson(expected)
  ) {
    throw new AflTradePreparedValuationInputSetStoreError(
      'INTEGRITY_MISMATCH',
      'Targeted prepared trade custody disagrees with its authenticated parent.'
    );
  }
  return { head, preparedInputSet, entry: expected };
}

export interface AflTradePreparedValuationInputSetStore {
  register(prepared: AflTradePreparedValuationInputSet): Promise<AflTradePreparedValuationInputSet>;
  loadExact(preparedInputSetId: string): Promise<AflTradePreparedValuationInputSet>;
  loadTrade(input: {
    readonly preparedInputSetId: string;
    readonly tradeId: string;
  }): Promise<AflTradePreparedValuationInputEntry | null>;
  activateCurrent(input: {
    readonly scopeKey: string;
    readonly preparedInputSetId: string;
    readonly expectedRevision: number;
  }): Promise<AflTradeCurrentPreparedValuationInputHead>;
  loadCurrent(scopeKey: string): Promise<AflTradeCurrentPreparedValuationInputSet | null>;
  loadCurrentTrade(input: {
    readonly scopeKey: string;
    readonly tradeId: string;
  }): Promise<AflTradeCurrentPreparedValuationInputTrade | null>;
}

export class PostgresAflTradePreparedValuationInputSetStore implements AflTradePreparedValuationInputSetStore {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async register(
    input: AflTradePreparedValuationInputSet
  ): Promise<AflTradePreparedValuationInputSet> {
    const prepared = aflTradePreparedValuationInputSetSchema.parse(input);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-prepared-valuation-input-set:${prepared.preparedInputSetId}`,
      ]);

      const existing = await transaction.query(
        `SELECT prepared_input_set_id FROM outcome_prepared_valuation_input_set
          WHERE prepared_input_set_id=$1`,
        [prepared.preparedInputSetId]
      );
      if (existing.rowCount) {
        const replay = await loadExactFromClient(transaction, prepared.preparedInputSetId);
        if (canonicalizeAflTradeJson(replay) !== canonicalizeAflTradeJson(prepared)) {
          throw new AflTradePreparedValuationInputSetStoreError(
            'REPLAY_CONFLICT',
            'Prepared valuation input-set replay differs from stored evidence.'
          );
        }
        return replay;
      }

      const contentCanonicalJson = canonicalizeAflTradeJson(prepared.content);
      const preparedSetCanonicalJson = canonicalizeAflTradeJson(prepared);
      await transaction.query(
        `INSERT INTO outcome_prepared_valuation_input_set
          (prepared_input_set_id,content_sha256,schema_version,environment,scope_key,
           factual_release_scope_key,factual_release_id,qualification_report_id,
           trade_count,ready_count,blocked_count,prepared_at,content_canonical_json,
           prepared_set_canonical_json,prepared_set_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          prepared.preparedInputSetId,
          digestFromId(prepared.preparedInputSetId, 'prepared-valuation-input-set'),
          prepared.content.schemaVersion,
          prepared.content.environment,
          prepared.content.scopeKey,
          prepared.content.factualReleaseScopeKey,
          prepared.content.factualReleaseId,
          prepared.content.qualificationReportId,
          prepared.content.tradeCount,
          prepared.content.readyCount,
          prepared.content.blockedCount,
          prepared.content.preparedAt,
          contentCanonicalJson,
          preparedSetCanonicalJson,
          preparedSetCanonicalJson,
        ]
      );

      for (const [index, entry] of prepared.content.entries.entries()) {
        const entryCanonicalJson = canonicalizeAflTradeJson(entry);
        await transaction.query(
          `INSERT INTO outcome_prepared_valuation_input_entry
            (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            prepared.preparedInputSetId,
            index + 1,
            entry.tradeId,
            entry.state,
            entryCanonicalJson,
            entryCanonicalJson,
          ]
        );
      }
      await transaction.query(
        `UPDATE outcome_prepared_valuation_input_set
            SET finalized_at=transaction_timestamp()
          WHERE prepared_input_set_id=$1 AND finalized_at IS NULL`,
        [prepared.preparedInputSetId]
      );
      return loadExactFromClient(transaction, prepared.preparedInputSetId);
    });
  }

  loadExact(preparedInputSetId: string): Promise<AflTradePreparedValuationInputSet> {
    return loadExactFromClient(this.client, preparedInputSetId);
  }

  async loadTrade(input: {
    readonly preparedInputSetId: string;
    readonly tradeId: string;
  }): Promise<AflTradePreparedValuationInputEntry | null> {
    const prepared = await this.loadExact(input.preparedInputSetId);
    return prepared.content.entries.find(({ tradeId }) => tradeId === input.tradeId) ?? null;
  }

  activateCurrent(input: {
    readonly scopeKey: string;
    readonly preparedInputSetId: string;
    readonly expectedRevision: number;
  }): Promise<AflTradeCurrentPreparedValuationInputHead> {
    if (
      input.scopeKey.trim() === '' ||
      input.preparedInputSetId.trim() === '' ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    ) {
      throw new TypeError('Prepared valuation input activation requires a valid CAS selector.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(
        `SELECT activate_outcome_current_prepared_valuation_input_set($1,$2,$3)`,
        [input.scopeKey, input.preparedInputSetId, input.expectedRevision]
      );
      const result = await transaction.query<CurrentPreparedSetHeadRow>(
        `SELECT scope_key,prepared_input_set_id,revision,activated_at
           FROM outcome_current_prepared_valuation_input_set WHERE scope_key=$1`,
        [input.scopeKey]
      );
      const row = result.rows[0];
      if (!row) {
        throw new AflTradePreparedValuationInputSetStoreError(
          'INTEGRITY_MISMATCH',
          'Prepared valuation input activation did not retain a current head.'
        );
      }
      const head = authenticateCurrentHead(row);
      if (
        head.preparedInputSetId !== input.preparedInputSetId ||
        head.revision !== input.expectedRevision + 1
      ) {
        throw new AflTradePreparedValuationInputSetStoreError(
          'INTEGRITY_MISMATCH',
          'Prepared valuation input activation returned an unexpected head revision.'
        );
      }
      return head;
    });
  }

  loadCurrent(scopeKey: string): Promise<AflTradeCurrentPreparedValuationInputSet | null> {
    if (scopeKey.trim() === '') throw new TypeError('Current prepared authority requires a scope.');
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      return loadCurrentFromClient(transaction, scopeKey);
    });
  }

  async loadCurrentTrade(input: {
    readonly scopeKey: string;
    readonly tradeId: string;
  }): Promise<AflTradeCurrentPreparedValuationInputTrade | null> {
    if (input.tradeId.trim() === '') {
      throw new TypeError('Current prepared trade authority requires a trade identifier.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      return loadCurrentAflTradePreparedValuationInputTradeFromTransaction(transaction, input);
    });
  }
}
