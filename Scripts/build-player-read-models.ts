#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { pathToFileURL } from 'node:url';

export interface BuildPlayerReadModelArgs {
  season?: number;
  rounds?: number[];
  playerIds?: string[];
  leagueId?: string;
  scope: string;
  mode: string;
  allowLiveFirebase: boolean;
}

export function parseArgs(argv: string[]): BuildPlayerReadModelArgs {
  const readArgValue = (name: string): string | undefined => {
    const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
    if (equalsValue != null) return equalsValue;
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const seasonArg = readArgValue('--season');
  const roundsArg = readArgValue('--rounds');
  const playerIdsArg = readArgValue('--playerIds') ?? readArgValue('--player-ids');
  const leagueId = readArgValue('--leagueId') ?? readArgValue('--league-id');
  const scope = readArgValue('--scope') ?? 'season';
  const mode = readArgValue('--mode') ?? 'full';
  const allowLiveFirebase =
    argv.includes('--allow-live-firebase') ||
    readArgValue('--allow-live-firebase') === 'true' ||
    readArgValue('--allow-live-firebase') === '1';

  return {
    season: seasonArg ? Number(seasonArg) : undefined,
    rounds: roundsArg
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0),
    playerIds: playerIdsArg
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    leagueId,
    scope,
    mode,
    allowLiveFirebase,
  };
}

export function assertSafeFirebaseTarget(
  args: Pick<BuildPlayerReadModelArgs, 'allowLiveFirebase'>,
  env: NodeJS.ProcessEnv = process.env
) {
  const runtime = env.STATLY_RUNTIME_ENV || env.VERCEL_ENV || env.NODE_ENV;
  const isLocalRuntime = runtime === 'local';
  const hasPrivateFirestoreEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST?.trim());
  const envOverride = env.STATLY_ALLOW_LIVE_FIREBASE_READ_MODELS === 'true';

  if (isLocalRuntime && !hasPrivateFirestoreEmulator && !args.allowLiveFirebase && !envOverride) {
    throw new Error(
      [
        'Refusing to build player read models against live Firebase from local runtime.',
        'Set FIRESTORE_EMULATOR_HOST for emulator-safe local runs,',
        'or pass --allow-live-firebase / set STATLY_ALLOW_LIVE_FIREBASE_READ_MODELS=true for an intentional live-target operation.',
      ].join(' ')
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSafeFirebaseTarget(args);
  const startedAt = Date.now();
  const { publishLeagueRosterSummaries, publishPlayerRankings, refreshPlayerReadModels } =
    await import('../src/server/readModels/playerReadModels');

  let result: Record<string, unknown>;

  if (args.mode === 'refresh') {
    result = (await refreshPlayerReadModels({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
      rounds: args.rounds,
      playerIds: args.playerIds,
    })) as unknown as Record<string, unknown>;
  } else if (args.mode === 'rankings') {
    result = (await publishPlayerRankings({
      season: args.season,
      scope: args.scope,
    })) as unknown as Record<string, unknown>;
  } else if (args.mode === 'rosters') {
    result = (await publishLeagueRosterSummaries({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
    })) as unknown as Record<string, unknown>;
  } else {
    const refreshResult = await refreshPlayerReadModels({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
      rounds: args.rounds,
      playerIds: args.playerIds,
    });
    const rankingResult = await publishPlayerRankings({
      season: args.season,
      scope: args.scope,
    });
    const rosterResult = await publishLeagueRosterSummaries({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
    });
    result = {
      refreshResult,
      rankingResult,
      rosterResult,
    };
  }

  const elapsedMs = Date.now() - startedAt;
  const verifierCommand = `npm run verify:player-read-models -- --season ${
    args.season ?? '<season>'
  }${args.rounds?.length ? ` --rounds ${args.rounds.join(',')}` : ''} --json`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.mode,
        elapsedMs,
        audit: {
          season: args.season ?? null,
          rounds: args.rounds ?? [],
          playerIds: args.playerIds ?? [],
          leagueId: args.leagueId ?? null,
          allowLiveFirebase: args.allowLiveFirebase,
          verifierCommand,
        },
        ...result,
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
