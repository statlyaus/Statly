#!/usr/bin/env node
import * as fs from 'fs';
import * as readline from 'readline';

import { processPlayerRow } from './processFootywireData';

type ProcessResult = 'written' | 'skipped_status' | 'skipped_unchanged';

async function run(): Promise<void> {
  const outfile = process.env.OUTFILE || '/tmp/player_stats_fryzigg_backfill.json';
  process.env.BACKFILL_MODE = process.env.BACKFILL_MODE || 'true';
  process.env.DATA_SOURCE = process.env.DATA_SOURCE || 'fryzigg';

  if (!fs.existsSync(outfile)) {
    throw new Error(`Expected NDJSON file at ${outfile}, but it does not exist`);
  }

  const stream = fs.createReadStream(outfile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let written = 0;
  let skippedStatus = 0;
  let skippedUnchanged = 0;
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const result = (await processPlayerRow(row)) as ProcessResult;
      if (result === 'written') written++;
      if (result === 'skipped_status') skippedStatus++;
      if (result === 'skipped_unchanged') skippedUnchanged++;
    } catch (error) {
      console.error('Backfill row error:', error instanceof Error ? error.message : error);
      errors++;
    }
  }

  console.log(
    `Backfill complete: ${written} written, ${skippedStatus} skipped_status, ${skippedUnchanged} skipped_unchanged, ${errors} errors`
  );
}

run().catch((error) => {
  console.error('Backfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
