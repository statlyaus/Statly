#!/usr/bin/env node
/**
 * Reads `fetch_fw_results.R` NDJSON from stdin and stores the results in `AflMatchResult`
 * (DATABASE_URL, the fantasy PostgreSQL). Any unreadable line, rejected row or database error exits
 * non-zero with nothing written: the ingest runs in one transaction.
 */
import * as readline from 'readline';
import { Pool } from 'pg';

import { completeResultRows, ingestResultRows } from './resultIngest';
import { pgResultStore } from './resultStore';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to store AFL match results');

  const parsed: unknown[] = [];
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    parsed.push(JSON.parse(line));
  }
  const rows = completeResultRows(parsed);

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const summary = await ingestResultRows(rows, {
      store: pgResultStore(pool),
      fetchedAt: new Date(),
    });
    console.log(`AFL match results stored: ${JSON.stringify(summary)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('AFL match result ingest failed; nothing was written:', error);
  process.exit(1);
});
