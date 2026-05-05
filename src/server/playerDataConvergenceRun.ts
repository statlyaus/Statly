export type PlayerDataConvergencePhase =
  | 'diagnose'
  | 'sync-dry-run'
  | 'sync-apply'
  | 'build-read-models'
  | 'verify-read-models';

export type PlayerDataConvergenceCommand = {
  phase: PlayerDataConvergencePhase;
  command: string;
  args: string[];
};

export type PlayerDataConvergenceRun = {
  season: number;
  rounds: number[];
  roundLabel: string;
  artifactDir: string;
  diagnosticJsonlPath: string;
  diagnosticCsvPath: string;
  commands: PlayerDataConvergenceCommand[];
};

export type BuildPlayerDataConvergenceRunInput = {
  season: number;
  rounds: number[];
  runId: string;
  applyDirectorySync: boolean;
  includeMergedLive: boolean;
  skipBuild: boolean;
  skipVerify: boolean;
  json: boolean;
};

export function parseConvergenceRounds(value: string | undefined): number[] {
  if (value == null || !value.trim()) {
    throw new Error('Expected --rounds with at least one non-negative integer round');
  }

  const decimalRoundPattern = /^(0|[1-9]\d*)$/;
  const rounds = value.split(',').map((token) => {
    const trimmed = token.trim();
    if (!decimalRoundPattern.test(trimmed)) {
      throw new Error('Expected --rounds to contain only comma-separated non-negative integers');
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error('Expected --rounds to contain only safe non-negative integer rounds');
    }
    return parsed;
  });

  return [...new Set(rounds)].sort((left, right) => left - right);
}

export function buildRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function buildPlayerDataConvergenceRun(
  input: BuildPlayerDataConvergenceRunInput
): PlayerDataConvergenceRun {
  if (!Number.isInteger(input.season) || input.season < 2020 || input.season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  if (input.rounds.length === 0) {
    throw new Error('Expected at least one round');
  }

  const rounds = [...new Set(input.rounds)].sort((left, right) => left - right);
  const roundCsv = rounds.join(',');
  const roundLabel = `r${roundCsv.replace(/,/g, '-')}`;
  const artifactDir = `tmp/player-data-convergence/${input.season}-${roundLabel}-${input.runId}`;
  const diagnosticJsonlPath = `${artifactDir}/identity-gap.jsonl`;
  const diagnosticCsvPath = `${artifactDir}/identity-gap.csv`;
  const jsonArgs = input.json ? ['--json'] : [];

  const commands: PlayerDataConvergenceCommand[] = [
    {
      phase: 'diagnose',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'diagnose:player-identity-gaps',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        '--output-jsonl',
        diagnosticJsonlPath,
        '--output-csv',
        diagnosticCsvPath,
        ...jsonArgs,
      ],
    },
    {
      phase: 'sync-dry-run',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'sync:player-directory-season',
        '--',
        `--season=${input.season}`,
        '--diagnostic-jsonl',
        diagnosticJsonlPath,
        ...jsonArgs,
      ],
    },
  ];

  if (input.applyDirectorySync) {
    commands.push({
      phase: 'sync-apply',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'sync:player-directory-season',
        '--',
        `--season=${input.season}`,
        '--diagnostic-jsonl',
        diagnosticJsonlPath,
        '--apply',
        ...jsonArgs,
      ],
    });
  }

  if (!input.skipBuild) {
    commands.push({
      phase: 'build-read-models',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'build:player-read-models',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        '--mode=refresh',
        ...jsonArgs,
      ],
    });
  }

  if (!input.skipVerify) {
    commands.push({
      phase: 'verify-read-models',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'verify:player-read-models',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        ...(input.includeMergedLive ? ['--include-merged-live'] : []),
        ...jsonArgs,
      ],
    });
  }

  return {
    season: input.season,
    rounds,
    roundLabel,
    artifactDir,
    diagnosticJsonlPath,
    diagnosticCsvPath,
    commands,
  };
}
