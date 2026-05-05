#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import { adminDb } from '../src/lib/firebaseAdmin';
import {
  buildEmptyMatchLogStageSnapshot,
  buildMatchLogEntityKey,
  buildMatchLogStageSnapshot,
  classifyMatchLogReconciliationIssues,
  type MatchLogPopulatedStages,
  type MatchLogReconciliationRecord,
  type MatchLogReconciliationStage,
  MATCH_LOG_RECONCILIATION_STAT_KEYS,
  type MatchLogStageSnapshot,
} from '../src/lib/matchLogs';
import { prisma } from '../src/lib/prisma';
import { fetchMergedIngestRowsForRounds } from '../src/lib/footywireStatsIngestion';
import {
  listProjectedMatchLogStageRows,
  listRawMatchLogStageRows,
} from '../src/server/readModels/playerReadModels';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const POPULATED_STAGES: MatchLogPopulatedStages = {
  merged: true,
  raw: true,
  projection: true,
  api: true,
};

type ApiMatchLogRow = {
  matchId: string;
  season: number;
  roundNumber: number;
  date: string;
  opponent: string;
  stats: Record<string, number | null>;
};

function parseArgs(argv: string[]) {
  const playerArg = argv.find((arg) => !arg.startsWith('--'))?.trim() ?? '';
  const seasonsArg = argv.find((arg) => arg.startsWith('--seasons='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const json = argv.includes('--json');

  const seasons =
    seasonsArg?.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)) ??
    [getDefaultAflSeason()];

  return {
    playerArg,
    seasons: Array.from(new Set(seasons)),
    limit: limitArg ? Number(limitArg) : 25,
    json,
  };
}

function normalizedName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function resolvePlayer(playerArg: string) {
  const byId = await prisma.player.findUnique({
    where: { id: playerArg },
    select: { id: true, name: true },
  });
  if (byId) return byId;

  const players = await prisma.player.findMany({
    select: { id: true, name: true },
  });
  return players.find((player) => player.name.toLowerCase() === playerArg.toLowerCase()) ?? null;
}

function buildApiStage(stats: ApiMatchLogRow['stats']): MatchLogStageSnapshot {
  return buildMatchLogStageSnapshot(stats, {
    availability: Object.fromEntries(
      MATCH_LOG_RECONCILIATION_STAT_KEYS.map((key) => [key, stats[key] !== null && stats[key] !== undefined])
    ),
  });
}

async function fetchApiRows(playerId: string, seasons: number[]): Promise<ApiMatchLogRow[]> {
  const params = new URLSearchParams();
  params.set('seasons', seasons.join(','));
  const response = await fetch(`${API_BASE}/api/players/${encodeURIComponent(playerId)}/matches?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`API returned ${response.status} for /api/players/${playerId}/matches`);
  }
  const body = (await response.json()) as { data?: ApiMatchLogRow[] };
  return Array.isArray(body.data) ? body.data : [];
}

function summarizeByIssue(records: MatchLogReconciliationRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const issue of record.issues) {
      counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function buildRecord(params: {
  entityKey: string;
  matchId: string;
  season: number;
  roundNumber: number;
  playerId: string | null;
  playerName: string;
  opponent: string;
  stages: Partial<Record<MatchLogReconciliationStage, MatchLogStageSnapshot>>;
}): MatchLogReconciliationRecord {
  const stages: Record<MatchLogReconciliationStage, MatchLogStageSnapshot> = {
    merged: params.stages.merged ?? buildEmptyMatchLogStageSnapshot(),
    raw: params.stages.raw ?? buildEmptyMatchLogStageSnapshot(),
    projection: params.stages.projection ?? buildEmptyMatchLogStageSnapshot(),
    api: params.stages.api ?? buildEmptyMatchLogStageSnapshot(),
  };

  return {
    entityKey: params.entityKey,
    matchId: params.matchId,
    season: params.season,
    roundNumber: params.roundNumber,
    playerId: params.playerId,
    playerName: params.playerName,
    opponent: params.opponent,
    stages,
    issues: classifyMatchLogReconciliationIssues(stages, {
      populatedStages: POPULATED_STAGES,
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.playerArg) {
    throw new Error(
      'Usage: npm run verify-match-logs -- "Player Name" --seasons=2026 [--limit=25] [--json]'
    );
  }

  const player = await resolvePlayer(args.playerArg);
  if (!player) {
    throw new Error(`Could not resolve player "${args.playerArg}"`);
  }

  const [rawRows, projectionRows, apiRows] = await Promise.all([
    Promise.all(args.seasons.map((season) => listRawMatchLogStageRows({ season, playerId: player.id }))).then((rows) =>
      rows.flat()
    ),
    Promise.all(
      args.seasons.map((season) =>
        listProjectedMatchLogStageRows({ season, playerId: player.id, prismaClient: prisma })
      )
    ).then((rows) => rows.flat()),
    fetchApiRows(player.id, args.seasons),
  ]);

  const roundsBySeason = new Map<number, Set<number>>();
  for (const row of [...rawRows, ...projectionRows]) {
    const set = roundsBySeason.get(row.season) ?? new Set<number>();
    set.add(row.roundNumber);
    roundsBySeason.set(row.season, set);
  }
  for (const row of apiRows) {
    const set = roundsBySeason.get(row.season) ?? new Set<number>();
    set.add(row.roundNumber);
    roundsBySeason.set(row.season, set);
  }

  const mergedRows = (
    await Promise.all(
      [...roundsBySeason.entries()].map(([season, rounds]) =>
        fetchMergedIngestRowsForRounds({
          season,
          rounds: [...rounds].sort((a, b) => a - b),
          dryRun: true,
        })
      )
    )
  )
    .flatMap((result) => result.rows)
    .filter((row) => normalizedName(row.playerName) === normalizedName(player.name));

  const mergedByKey = new Map(mergedRows.map((row) => [row.entityKey, row] as const));
  const rawByKey = new Map(rawRows.map((row) => [row.entityKey, row] as const));
  const projectionByKey = new Map(projectionRows.map((row) => [row.entityKey, row] as const));
  const apiByKey = new Map(
    apiRows.map((row) => {
      const entityKey = buildMatchLogEntityKey({
        season: row.season,
        roundNumber: row.roundNumber,
        playerId: player.id,
        matchId: row.matchId,
        playerName: player.name,
        opponent: row.opponent,
      });
      return [
        entityKey,
        {
          entityKey,
          matchId: row.matchId,
          season: row.season,
          roundNumber: row.roundNumber,
          playerId: player.id,
          playerName: player.name,
          opponent: row.opponent,
          stage: buildApiStage(row.stats),
        },
      ] as const;
    })
  );

  const entityKeys = Array.from(
    new Set([...mergedByKey.keys(), ...rawByKey.keys(), ...projectionByKey.keys(), ...apiByKey.keys()])
  ).sort();

  const records = entityKeys.map((entityKey) => {
    const merged = mergedByKey.get(entityKey);
    const raw = rawByKey.get(entityKey);
    const projection = projectionByKey.get(entityKey);
    const api = apiByKey.get(entityKey);

    return buildRecord({
      entityKey,
      matchId: merged?.matchId ?? raw?.matchId ?? projection?.matchId ?? api?.matchId ?? entityKey,
      season: merged?.season ?? raw?.season ?? projection?.season ?? api?.season ?? 0,
      roundNumber:
        merged?.roundNumber ?? raw?.roundNumber ?? projection?.roundNumber ?? api?.roundNumber ?? 0,
      playerId: raw?.playerId ?? projection?.playerId ?? api?.playerId ?? player.id,
      playerName: merged?.playerName ?? raw?.playerName ?? projection?.playerName ?? api?.playerName ?? player.name,
      opponent: merged?.opponent ?? raw?.opponent ?? projection?.opponent ?? api?.opponent ?? 'Unknown',
      stages: {
        merged: merged?.stage,
        raw: raw?.stage,
        projection: projection?.stage,
        api: api?.stage,
      },
    });
  });

  const mismatched = records.filter((record) => record.issues.length > 0);
  const summary = {
    ok: mismatched.length === 0,
    player: {
      id: player.id,
      name: player.name,
    },
    seasons: args.seasons,
    stageCounts: {
      merged: mergedRows.length,
      raw: rawRows.length,
      projection: projectionRows.length,
      api: apiRows.length,
    },
    mismatchCounts: summarizeByIssue(records),
    mismatchedMatches: mismatched.length,
  };

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          records: mismatched.slice(0, args.limit),
        },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify(summary, null, 2));
    if (mismatched.length > 0) {
      console.log('\nSample mismatches:');
      for (const record of mismatched.slice(0, args.limit)) {
        console.log(`- ${record.season} R${record.roundNumber} vs ${record.opponent} [${record.entityKey}]`);
        for (const issue of record.issues.slice(0, 10)) {
          console.log(`  • ${issue.code}: ${issue.statKey}`);
        }
      }
    }
  }

  if (mismatched.length > 0) {
    await prisma.$disconnect().catch(() => undefined);
    await adminDb.terminate().catch(() => undefined);
    process.exit(1);
  }

  await prisma.$disconnect().catch(() => undefined);
  await adminDb.terminate().catch(() => undefined);
  process.exit(0);
}

main().catch((error) => {
  void prisma.$disconnect().catch(() => undefined);
  void adminDb.terminate().catch(() => undefined);
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
