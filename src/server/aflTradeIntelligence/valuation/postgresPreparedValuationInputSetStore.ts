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
    `SELECT prepared_set_json,content_canonical_json,prepared_set_canonical_json,finalized_at,
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
  if (
    prepared.preparedInputSetId !== preparedInputSetId ||
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

export interface AflTradePreparedValuationInputSetStore {
  register(prepared: AflTradePreparedValuationInputSet): Promise<AflTradePreparedValuationInputSet>;
  loadExact(preparedInputSetId: string): Promise<AflTradePreparedValuationInputSet>;
  loadTrade(input: {
    readonly preparedInputSetId: string;
    readonly tradeId: string;
  }): Promise<AflTradePreparedValuationInputEntry | null>;
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
}
