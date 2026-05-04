#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { adminDb } from '../src/lib/firebaseAdmin';
import { prisma } from '../src/lib/prisma';
import {
  loadPlayerIdentityDirectory,
  resolvePlayerIdentityFromDirectory,
  type PlayerIdentityInput,
} from '../shared/player-identity/playerIdentityResolver';
import {
  formatIdentityGapCsv,
  formatIdentityGapHumanReport,
  formatIdentityGapJsonl,
  runIdentityGapDiagnosis,
  type DiagnosticFirestoreRow,
  type DiagnosticUnresolvedRow,
} from '../src/server/diagnostics/playerIdentityGapDiagnosis';

type CliArgs = {
  season: number;
  rounds: number[];
  limit: number;
  json: boolean;
  outputJsonl: string | null;
  outputCsv: string | null;
};

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const season = Number(readArgValue(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  const roundsArg = readArgValue(argv, '--rounds');
  const rounds =
    roundsArg
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0) ?? [];
  if (rounds.length === 0) {
    throw new Error('Expected --rounds with at least one non-negative integer round');
  }

  const limitArg = readArgValue(argv, '--limit');
  const limit = limitArg ? Number(limitArg) : 25;

  return {
    season,
    rounds: [...new Set(rounds)].sort((left, right) => left - right),
    limit: Number.isInteger(limit) && limit > 0 ? limit : 25,
    json: argv.includes('--json'),
    outputJsonl: readArgValue(argv, '--output-jsonl') ?? null,
    outputCsv: readArgValue(argv, '--output-csv') ?? null,
  };
}

function readRound(data: Record<string, unknown>): number | null {
  const value = data.round_number ?? data.round ?? data.match_round;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function loadFirestoreRows(params: {
  season: number;
  rounds: number[];
}): Promise<DiagnosticFirestoreRow[]> {
  const docs: DiagnosticFirestoreRow[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  const pageSize = 1000;

  while (true) {
    let query = adminDb
      .collection('player_match_stats')
      .where('season', '==', params.season)
      .orderBy('__name__')
      .limit(pageSize);

    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const round = readRound(data);
      if (round != null && params.rounds.includes(round)) {
        docs.push({ docId: doc.id, data });
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }

  return docs;
}

async function loadUnresolvedRows(params: {
  season: number;
  rounds: number[];
}): Promise<DiagnosticUnresolvedRow[]> {
  const rows = await prisma.unresolvedPlayerStatRow.findMany({
    where: {
      season: params.season,
      status: { in: ['NEW', 'REVIEWED'] },
    },
    select: {
      source: true,
      sourceDocumentId: true,
      season: true,
      round: true,
      playerName: true,
      normalizedPlayerName: true,
      team: true,
      normalizedTeam: true,
      status: true,
      candidatePlayerIdsJson: true,
    },
  });

  return rows.filter((row) => row.round == null || params.rounds.includes(row.round));
}

async function writeOutput(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runIdentityGapDiagnosis({
    season: args.season,
    rounds: args.rounds,
    limit: args.limit,
    loadFirestoreRows,
    loadDirectory: ({ season }) => loadPlayerIdentityDirectory(prisma, season),
    loadUnresolvedRows,
    resolveIdentity: (input: PlayerIdentityInput, directory) =>
      resolvePlayerIdentityFromDirectory(directory, input),
  });

  if (args.outputJsonl) {
    await writeOutput(args.outputJsonl, formatIdentityGapJsonl(result.rows));
  }

  if (args.outputCsv) {
    await writeOutput(args.outputCsv, formatIdentityGapCsv(result.rows));
  }

  if (args.json) {
    console.log(JSON.stringify(result.summary, null, 2));
  } else {
    console.log(formatIdentityGapHumanReport(result));
  }
}

main()
  .catch((error) => {
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
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([prisma.$disconnect(), adminDb.terminate()]);
  });
