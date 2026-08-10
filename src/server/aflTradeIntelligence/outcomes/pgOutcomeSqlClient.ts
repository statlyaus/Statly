import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

interface PgQueryResultLike {
  rows: readonly unknown[];
  rowCount: number | null;
}

interface PgQueryable {
  query(sql: string, parameters?: readonly unknown[]): Promise<PgQueryResultLike>;
}

export interface AflOutcomePgPoolClient extends PgQueryable {
  release(): void;
}

export interface AflOutcomePgPool extends PgQueryable {
  connect(): Promise<AflOutcomePgPoolClient>;
}

function normalizeResult<Row>(result: PgQueryResultLike): AflOutcomeSqlQueryResult<Row> {
  return {
    rows: result.rows as readonly Row[],
    rowCount: result.rowCount,
  };
}

function createTransaction(client: AflOutcomePgPoolClient): AflOutcomeSqlTransaction {
  return {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      return normalizeResult<Row>(await client.query(sql, parameters));
    },
  };
}

/**
 * Adapts an explicitly configured pg Pool to the factual-outcomes persistence port. Configuration
 * remains the caller's responsibility so this boundary cannot discover or borrow fantasy secrets.
 */
export function createPgAflOutcomeSqlClient(pool: AflOutcomePgPool): AflOutcomeSqlClient {
  return {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      return normalizeResult<Row>(await pool.query(sql, parameters));
    },

    async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await work(createTransaction(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The factual-outcomes transaction and its rollback both failed.'
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
