#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { playerDirectoryRepairs2026 } from '../src/data/playerDirectoryRepairs2026';
import { prisma } from '../src/lib/prisma';
import { applyPlayerDirectoryRepairPlan } from '../src/server/playerDirectoryRepair';

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await applyPlayerDirectoryRepairPlan(prisma, playerDirectoryRepairs2026, {
    dryRun: !options.apply,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.valid,
        dryRun: !options.apply,
        audit: {
          repairCount: playerDirectoryRepairs2026.length,
          verifierCommand:
            'npm run verify:player-read-models -- --season 2026 --json',
        },
        ...result,
      },
      null,
      2
    )
  );

  if (!result.valid) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
