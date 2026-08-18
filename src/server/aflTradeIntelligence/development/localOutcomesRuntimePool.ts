import 'server-only';

import { Pool } from 'pg';

type LocalOutcomesRuntimePoolConfiguration = Readonly<{
  connectionString: string;
  application_name: string;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  max: number;
  allowExitOnIdle: boolean;
}>;

type PoolFactory = (configuration: LocalOutcomesRuntimePoolConfiguration) => Pool;

export interface LocalOutcomesRuntimePoolProvider {
  get(connectionString: string): Pool;
}

export function createLocalOutcomesRuntimePoolProvider(
  createPool: PoolFactory = (configuration) => new Pool(configuration)
): LocalOutcomesRuntimePoolProvider {
  let admittedConnectionString: string | null = null;
  let pool: Pool | null = null;

  return Object.freeze({
    get(connectionString: string): Pool {
      if (pool !== null) {
        if (connectionString !== admittedConnectionString) {
          throw new Error(
            'The admitted local outcomes runtime changed; restart the development server.'
          );
        }
        return pool;
      }

      admittedConnectionString = connectionString;
      pool = createPool({
        connectionString,
        application_name: 'statly-private-workbook-runtime',
        connectionTimeoutMillis: 30_000,
        idleTimeoutMillis: 30_000,
        max: 4,
        allowExitOnIdle: true,
      });
      return pool;
    },
  });
}

declare global {
  // Reuse the bounded local-only pool across Next.js development hot reloads.
  var __statlyLocalOutcomesRuntimePool__: LocalOutcomesRuntimePoolProvider | undefined;
}

export function getLocalOutcomesRuntimePool(connectionString: string): Pool {
  globalThis.__statlyLocalOutcomesRuntimePool__ ??=
    createLocalOutcomesRuntimePoolProvider();
  return globalThis.__statlyLocalOutcomesRuntimePool__.get(connectionString);
}
