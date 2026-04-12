#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { prisma } from '../src/lib/prisma';

function parseArgs(argv: string[]) {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? Number(limitArg) : 25;

  return {
    season: seasonArg ? Number(seasonArg) : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await prisma.unresolvedPlayerStatRow.findMany({
    where: {
      status: {
        in: ['NEW', 'REVIEWED'],
      },
      ...(typeof options.season === 'number' ? { season: options.season } : {}),
    },
    orderBy: [{ season: 'asc' }, { createdAt: 'asc' }],
  });

  const grouped = new Map<
    string,
    {
      source: string;
      playerName: string;
      team: string | null;
      season: number;
      count: number;
      statuses: Set<string>;
      candidateSets: Set<string>;
      sampleDocumentIds: string[];
    }
  >();

  for (const row of rows) {
    const key = `${row.source}|${row.season}|${row.playerName}|${row.team ?? ''}`;
    const existing = grouped.get(key) ?? {
      source: row.source,
      playerName: row.playerName,
      team: row.team,
      season: row.season,
      count: 0,
      statuses: new Set<string>(),
      candidateSets: new Set<string>(),
      sampleDocumentIds: [],
    };

    existing.count += 1;
    existing.statuses.add(row.status);
    if (row.candidatePlayerIdsJson) {
      existing.candidateSets.add(row.candidatePlayerIdsJson);
    }
    if (existing.sampleDocumentIds.length < 3) {
      existing.sampleDocumentIds.push(row.sourceDocumentId);
    }
    grouped.set(key, existing);
  }

  const top = Array.from(grouped.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (left.season !== right.season) return left.season - right.season;
      return left.playerName.localeCompare(right.playerName);
    })
    .slice(0, options.limit)
    .map((entry) => ({
      source: entry.source,
      season: entry.season,
      playerName: entry.playerName,
      team: entry.team,
      count: entry.count,
      statuses: Array.from(entry.statuses).sort(),
      candidateSets: Array.from(entry.candidateSets).slice(0, 3),
      sampleDocumentIds: entry.sampleDocumentIds,
    }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        season: options.season ?? null,
        unresolvedRowCount: rows.length,
        unresolvedIdentityCount: grouped.size,
        top,
      },
      null,
      2
    )
  );
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
