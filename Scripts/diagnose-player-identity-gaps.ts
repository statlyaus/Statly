#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { prisma as PrismaClientInstance } from '../src/lib/prisma';
import type { PlayerIdentityInput } from '../shared/player-identity/playerIdentityResolver';
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

type PrismaClient = typeof PrismaClientInstance;
type AdminDb = Awaited<typeof import('../src/lib/firebaseAdmin')>['adminDb'];

let prismaClient: PrismaClient | null = null;
let firestoreAdminDb: AdminDb | null = null;

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function readRequiredPathArg(argv: string[], name: string): string | null {
  const value = readArgValue(argv, name);
  if (value == null) return null;
  if (!value.trim() || value.startsWith('--')) {
    throw new Error(`Expected ${name} to be followed by a non-empty output path`);
  }
  return value;
}

function parseRounds(value: string | undefined): number[] {
  if (value == null || !value.trim()) {
    throw new Error('Expected --rounds with at least one non-negative integer round');
  }

  const decimalRoundPattern = /^(0|[1-9]\d*)$/;
  const tokens = value.split(',');
  const rounds = tokens.map((token) => {
    const trimmed = token.trim();
    if (!decimalRoundPattern.test(trimmed)) {
      throw new Error('Expected --rounds to contain only comma-separated non-negative integers');
    }
    return Number(trimmed);
  });

  return [...new Set(rounds)].sort((left, right) => left - right);
}

function parseArgs(argv: string[]): CliArgs {
  const season = Number(readArgValue(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  const limitArg = readArgValue(argv, '--limit');
  const limit = limitArg ? Number(limitArg) : 25;

  return {
    season,
    rounds: parseRounds(readArgValue(argv, '--rounds')),
    limit: Number.isInteger(limit) && limit > 0 ? limit : 25,
    json: argv.includes('--json'),
    outputJsonl: readRequiredPathArg(argv, '--output-jsonl'),
    outputCsv: readRequiredPathArg(argv, '--output-csv'),
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
  adminDb: AdminDb;
}): Promise<DiagnosticFirestoreRow[]> {
  const docs: DiagnosticFirestoreRow[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  const pageSize = 1000;

  while (true) {
    let query = params.adminDb
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
  prisma: PrismaClient;
}): Promise<DiagnosticUnresolvedRow[]> {
  const rows = await params.prisma.unresolvedPlayerStatRow.findMany({
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
  const [{ adminDb }, { prisma }, identityResolver] = await Promise.all([
    import('../src/lib/firebaseAdmin'),
    import('../src/lib/prisma'),
    import('../shared/player-identity/playerIdentityResolver'),
  ]);
  firestoreAdminDb = adminDb;
  prismaClient = prisma;

  const result = await runIdentityGapDiagnosis({
    season: args.season,
    rounds: args.rounds,
    limit: args.limit,
    loadFirestoreRows: ({ season, rounds }) => loadFirestoreRows({ season, rounds, adminDb }),
    loadDirectory: ({ season }) => identityResolver.loadPlayerIdentityDirectory(prisma, season),
    loadUnresolvedRows: ({ season, rounds }) => loadUnresolvedRows({ season, rounds, prisma }),
    resolveIdentity: (input: PlayerIdentityInput, directory) =>
      identityResolver.resolvePlayerIdentityFromDirectory(directory, input),
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
    await Promise.allSettled([
      prismaClient?.$disconnect() ?? Promise.resolve(),
      firestoreAdminDb?.terminate() ?? Promise.resolve(),
    ]);
  });
