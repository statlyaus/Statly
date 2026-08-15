export interface LocalAflTradeOutcomesIdentitySqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: readonly unknown[] }>;
}

const NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const identitySchema = 'statly_local_runtime';
const identityTable = `${identitySchema}.outcomes_process_identity`;

export function requireLocalAflTradeOutcomesRuntimeNonce(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error(
      'The local AFL outcomes runtime nonce must contain 64 lowercase hexadecimal characters.'
    );
  }
  return nonce;
}

export async function installLocalAflTradeOutcomesRuntimeIdentity(
  client: LocalAflTradeOutcomesIdentitySqlClient,
  nonce: string,
  processId: number
): Promise<void> {
  const safeNonce = requireLocalAflTradeOutcomesRuntimeNonce(nonce);
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error(
      'The local AFL outcomes runtime identity requires a positive process identifier.'
    );
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${identitySchema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${identityTable} (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      runtime_nonce TEXT NOT NULL CHECK (runtime_nonce ~ '^[a-f0-9]{64}$'),
      process_id INTEGER NOT NULL CHECK (process_id > 0),
      started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(
    `
      INSERT INTO ${identityTable} (singleton, runtime_nonce, process_id, started_at)
      VALUES (TRUE, $1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (singleton) DO UPDATE
      SET runtime_nonce = EXCLUDED.runtime_nonce,
          process_id = EXCLUDED.process_id,
          started_at = EXCLUDED.started_at
    `,
    [safeNonce, processId]
  );
}

export async function assertLocalAflTradeOutcomesRuntimeIdentity(
  client: LocalAflTradeOutcomesIdentitySqlClient,
  expectedNonce: string
): Promise<void> {
  const safeNonce = requireLocalAflTradeOutcomesRuntimeNonce(expectedNonce);
  const result = await client.query(
    `SELECT runtime_nonce FROM ${identityTable} WHERE singleton = TRUE`
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    typeof row !== 'object' ||
    row === null ||
    !('runtime_nonce' in row) ||
    row.runtime_nonce !== safeNonce
  ) {
    throw new Error(
      'The service on the AFL outcomes port does not belong to this local stack launch.'
    );
  }
}
