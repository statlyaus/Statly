#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { prisma } from '../src/lib/prisma';
import { auditUnresolvedPlayerDirectory } from '../src/server/playerDirectoryRepair';

type Options = {
  season: number;
  rounds?: number[];
  limit?: number;
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const readArgValue = (name: string): string | undefined => {
    const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
    if (equalsValue != null) return equalsValue;
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const seasonArg = readArgValue('--season');
  const roundsArg = readArgValue('--rounds');
  const limitArg = readArgValue('--limit');
  const season = seasonArg ? Number(seasonArg) : new Date().getFullYear();
  const rounds = roundsArg
    ? roundsArg
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value))
    : undefined;
  const limit = limitArg ? Number(limitArg) : undefined;

  if (!Number.isInteger(season)) {
    throw new Error(`Invalid season: ${seasonArg ?? '<missing>'}`);
  }

  return {
    season,
    rounds,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    json: argv.includes('--json'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const groups = await auditUnresolvedPlayerDirectory(prisma, options);

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...options, groups }, null, 2));
    return;
  }

  console.log(`Unresolved player directory audit: season ${options.season}`);
  if (options.rounds?.length) console.log(`Rounds: ${options.rounds.join(', ')}`);
  console.log(`Groups: ${groups.length}`);
  for (const group of groups) {
    console.log(
      [
        `${group.playerName} (${group.team ?? 'unknown club'})`,
        `count=${group.count}`,
        `rounds=${group.rounds.join(',') || 'unknown'}`,
        `recommendation=${group.recommendedRepair.action}:${group.recommendedRepair.reason}`,
        `docs=${group.sourceDocumentIds.slice(0, 3).join(',')}`,
      ].join(' | ')
    );
    if (group.nearMatches.length > 0) {
      console.log(
        `  near: ${group.nearMatches
          .map((match) => `${match.name} [${match.id}, ${match.club}, ${match.reason}]`)
          .join('; ')}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
