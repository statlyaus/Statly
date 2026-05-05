#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import {
  buildPlayerDataConvergenceRun,
  buildRunId,
  parseConvergenceRounds,
  type PlayerDataConvergenceCommand,
} from '../src/server/playerDataConvergenceRun';

type CliArgs = {
  season: number;
  rounds: number[];
  applyDirectorySync: boolean;
  includeMergedLive: boolean;
  skipBuild: boolean;
  skipVerify: boolean;
  json: boolean;
};

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const season = Number(readArgValue(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  return {
    season,
    rounds: parseConvergenceRounds(readArgValue(argv, '--rounds')),
    applyDirectorySync: argv.includes('--apply-directory-sync'),
    includeMergedLive: argv.includes('--include-merged-live'),
    skipBuild: argv.includes('--skip-build'),
    skipVerify: argv.includes('--skip-verify'),
    json: argv.includes('--json'),
  };
}

async function runCommand(command: PlayerDataConvergenceCommand): Promise<void> {
  console.error(`[player-data-convergence] starting ${command.phase}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Phase ${command.phase} failed with exit code ${code ?? 'unknown'}`));
      }
    });
  });
  console.error(`[player-data-convergence] completed ${command.phase}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const run = buildPlayerDataConvergenceRun({
    season: args.season,
    rounds: args.rounds,
    runId: buildRunId(),
    applyDirectorySync: args.applyDirectorySync,
    includeMergedLive: args.includeMergedLive,
    skipBuild: args.skipBuild,
    skipVerify: args.skipVerify,
    json: args.json,
  });

  await mkdir(run.artifactDir, { recursive: true });

  console.error(
    `[player-data-convergence] season=${run.season} rounds=${run.rounds.join(',')} artifacts=${run.artifactDir}`
  );
  if (!args.applyDirectorySync) {
    console.error(
      '[player-data-convergence] directory sync is dry-run only; pass --apply-directory-sync to apply reviewed roster evidence'
    );
  }

  for (const command of run.commands) {
    await runCommand(command);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
