import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
  AflOutcomeSqlTransactionOptions,
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

const ISOLATION_LEVEL_SQL = {
  read_committed: 'READ COMMITTED',
  repeatable_read: 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const;

const ACCESS_MODE_SQL = {
  read_write: 'READ WRITE',
  read_only: 'READ ONLY',
} as const;

function transactionStartSql(options: AflOutcomeSqlTransactionOptions = {}): string {
  const isolationLevel = ISOLATION_LEVEL_SQL[options.isolationLevel ?? 'read_committed'];
  const accessMode = options.accessMode ? ` ${ACCESS_MODE_SQL[options.accessMode]}` : '';
  return `BEGIN ISOLATION LEVEL ${isolationLevel}${accessMode}`;
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

    async transaction<T>(
      work: (transaction: AflOutcomeSqlTransaction) => Promise<T>,
      options?: AflOutcomeSqlTransactionOptions
    ) {
      const client = await pool.connect();
      try {
        await client.query(transactionStartSql(options));
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
