import type { WarehouseQueryRunner } from '../../src/lib/warehouse/motherduckClient';

export type DuckDbMotherDuckRunner = WarehouseQueryRunner & {
  close(): Promise<void>;
};

function buildAuthenticatedMotherDuckUrl(databaseUrl: string, token?: string): string {
  if (!token) return databaseUrl;

  const separator = databaseUrl.includes('?') ? '&' : '?';
  const tokenParam = new URLSearchParams({
    motherduck_token: token,
  }).toString();

  return `${databaseUrl}${separator}${tokenParam}`;
}

function queryDuckDb<T>(
  connection: import('duckdb').Connection,
  sql: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows as T[]);
    });
  });
}

function closeDuckDbConnection(
  connection: import('duckdb').Connection
): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeDuckDbDatabase(
  database: import('duckdb').Database
): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeBestEffort(params: {
  connection?: import('duckdb').Connection;
  database?: import('duckdb').Database;
}): Promise<void> {
  const closeTasks: Promise<void>[] = [];
  if (params.connection) closeTasks.push(closeDuckDbConnection(params.connection));
  if (params.database) closeTasks.push(closeDuckDbDatabase(params.database));

  await Promise.allSettled(closeTasks);
}

export async function createDuckDbMotherDuckRunner(params: {
  databaseUrl: string;
  token?: string;
}): Promise<DuckDbMotherDuckRunner> {
  const duckdb = await import('duckdb');
  const database = new duckdb.Database(
    buildAuthenticatedMotherDuckUrl(params.databaseUrl, params.token)
  );

  let connection: import('duckdb').Connection | undefined;
  try {
    connection = database.connect();
  } catch (error) {
    await closeBestEffort({ connection, database });
    throw error;
  }

  return {
    query(sql) {
      return queryDuckDb(connection, sql);
    },
    async close() {
      const results = await Promise.allSettled([
        closeDuckDbConnection(connection),
        closeDuckDbDatabase(database),
      ]);
      const rejection = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejection) throw rejection.reason;
    },
  };
}
