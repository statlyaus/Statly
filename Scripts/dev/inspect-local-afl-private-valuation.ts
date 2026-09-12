import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import {
  inspectExact2025AflPrivateValuationRehearsalPreflight,
  type Exact2025AflPrivateValuationRehearsalPreflight,
  type LocalPrivateValuationPreflightQueryClient,
} from '../../src/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface InventoryPool extends LocalPrivateValuationPreflightQueryClient {
  end(): Promise<void>;
}

interface InventoryPoolConfiguration {
  readonly connectionString: string;
  readonly application_name: string;
  readonly connectionTimeoutMillis: number;
  readonly max: 1;
  readonly options: string;
}

function localConfiguration(environment: Readonly<Record<string, string | undefined>>) {
  const databaseUrl = environment.AFL_OUTCOMES_DATABASE_URL?.trim();
  const runtimeNonce = environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
  if (!databaseUrl || !runtimeNonce || !/^[a-f0-9]{64}$/u.test(runtimeNonce)) {
    throw new Error('The admitted local outcomes database and runtime nonce are required.');
  }
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('Inventory requires disposable loopback PostgreSQL without URL options.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOOPBACK_HOSTS.has(database.hostname) ||
    database.pathname !== '/statly_outcomes_test' ||
    database.search !== '' ||
    database.hash !== ''
  ) {
    throw new Error('Inventory requires disposable loopback PostgreSQL without URL options.');
  }
  return { databaseUrl, runtimeNonce };
}

/** Inspect an existing runtime; never provision a database or enqueue valuation work. */
export async function inspectLocalAflPrivateValuationCommand(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly writeOutput?: (line: string) => void;
  readonly createPool?: (configuration: InventoryPoolConfiguration) => InventoryPool;
}) {
  const config = localConfiguration(input.env);
  const pool = (input.createPool ?? ((options) => new Pool(options)))({
    connectionString: config.databaseUrl,
    application_name: 'statly-local-private-valuation-inventory',
    connectionTimeoutMillis: 5_000,
    max: 1,
    options: '-c default_transaction_read_only=on -c statement_timeout=30000',
  });
  let inventory: Exact2025AflPrivateValuationRehearsalPreflight;
  try {
    // One connection owns identity verification and inventory in the same read-only snapshot.
    await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assertLocalAflTradeOutcomesRuntimeIdentity(pool, config.runtimeNonce);
      inventory = await inspectExact2025AflPrivateValuationRehearsalPreflight(pool);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await pool.end();
  }
  const report = {
    purpose: 'existing_database_inventory' as const,
    databaseOrigin: 'existing_admitted_local_database' as const,
    rehearsalExecuted: false as const,
    inventory,
  };
  (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(report));
  return report;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  inspectLocalAflPrivateValuationCommand({ env: process.env }).catch(() => {
    process.stderr.write('Local private valuation inventory failed closed.\n');
    process.exitCode = 1;
  });
}
