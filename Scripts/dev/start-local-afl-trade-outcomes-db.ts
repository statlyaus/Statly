import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import { AFL_TRADE_LOCAL_OUTCOMES_PORT } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntime';

const root = resolve(import.meta.dirname, '../..');
const dataDirectory = resolve(root, '.statly-local/afl-trade-outcomes-pgdata');

await mkdir(resolve(root, '.statly-local'), { recursive: true });

const database = await PGlite.create(dataDirectory);
const server = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: AFL_TRADE_LOCAL_OUTCOMES_PORT,
});

let closing: Promise<void> | null = null;
async function close(): Promise<void> {
  if (closing !== null) return closing;
  closing = (async () => {
    await server.stop();
    await database.close();
  })();
  return closing;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

await server.start();
process.stdout.write(
  `Local AFL outcomes PostgreSQL compatibility service is listening on 127.0.0.1:${AFL_TRADE_LOCAL_OUTCOMES_PORT}.\n`
);
