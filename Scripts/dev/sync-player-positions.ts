#!/usr/bin/env tsx
/**
 * Sync `Player.position` from Footywire club lists (fitzRoy).
 *
 *   npm run players:sync-positions                 # dry run: fetch and report
 *   npm run players:sync-positions -- --apply      # write the changes
 *   npm run players:sync-positions -- --input fw.ndjson [--apply]
 *
 * Positions are stored as DEF, MID, RUC, FWD, or a dual value such as DEF/MID. Writes are
 * refused against a non-local database unless --allow-remote is passed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  parseFootywirePositionNdjson,
  planPositionSync,
} from '../../src/server/players/footywirePositions';

interface Options {
  apply: boolean;
  allowRemote: boolean;
  input?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, allowRemote: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--allow-remote') options.allowRemote = true;
    else if (arg === '--input') options.input = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function isLocalDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('file:') || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

function fetchFootywireNdjson(): string {
  const script = path.join(process.cwd(), 'etl', 'fetch_fw_positions.R');
  const result = spawnSync('Rscript', [script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.error) throw new Error(`Could not run Rscript: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`fetch_fw_positions.R exited with ${result.status}`);
  return result.stdout;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && !options.allowRemote && !isLocalDatabase()) {
    throw new Error('Refusing to write to a non-local database without --allow-remote.');
  }

  const text = options.input ? readFileSync(options.input, 'utf8') : fetchFootywireNdjson();
  const rows = parseFootywirePositionNdjson(text);
  if (rows.length === 0) throw new Error('No Footywire rows to sync.');

  const prisma = new PrismaClient();
  try {
    const players = await prisma.player.findMany({
      where: { active: true },
      select: { id: true, name: true, club: true, position: true },
    });
    const plan = planPositionSync(rows, players);

    console.log(`Footywire rows: ${rows.length}. Statly players: ${players.length}.`);
    console.log(
      `Updates: ${plan.updates.length}. Unchanged: ${plan.unchanged}. Unmatched: ${plan.unmatched.length}. Ambiguous: ${plan.ambiguous.length}. No position: ${plan.withoutPosition.length}.`
    );
    for (const update of plan.updates.slice(0, 25)) {
      console.log(`  ${update.name} (${update.club}): ${update.from} → ${update.to}`);
    }
    if (plan.updates.length > 25) console.log(`  … and ${plan.updates.length - 25} more`);
    for (const row of plan.ambiguous) {
      console.log(`  Ambiguous: ${row.name} (${row.team}) → ${row.playerIds.join(', ')}`);
    }

    if (!options.apply) {
      console.log('Dry run. Pass --apply to write these changes.');
      return;
    }
    const chunkSize = 50;
    for (let index = 0; index < plan.updates.length; index += chunkSize) {
      const chunk = plan.updates.slice(index, index + chunkSize);
      await prisma.$transaction(
        chunk.map((update) =>
          prisma.player.update({ where: { id: update.playerId }, data: { position: update.to } })
        )
      );
    }
    console.log(`Wrote ${plan.updates.length} positions.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
