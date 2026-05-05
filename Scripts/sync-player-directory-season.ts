#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises';

import type { ReviewedPlayerRosterEvidence } from '../src/server/playerDirectoryRosterEvidence';
import type { IdentityGapDiagnosticRow } from '../src/server/diagnostics/playerIdentityGapDiagnosis';
import type {
  ReviewedSeasonRosterEntry,
  SeasonRosterCoverage,
} from '../src/server/playerDirectorySeasonRoster';
import type {
  SeasonRosterSyncApplyResult,
  SeasonRosterSyncPlan,
} from '../src/server/playerDirectorySeasonRosterSync';

type CliOptions = {
  season: number;
  diagnosticJsonl?: string;
  apply: boolean;
  json: boolean;
};

type AdaptedRosterEvidence = {
  entries: ReviewedSeasonRosterEntry[];
  errors: string[];
};

function readRequiredArgValue(argv: string[], name: string): string {
  const equalsArg = argv.find((arg) => arg === `${name}=` || arg.startsWith(`${name}=`));
  if (equalsArg != null) {
    const value = equalsArg.slice(name.length + 1);
    if (!value.trim()) throw new Error(`Expected ${name} to have a non-empty value`);
    if (value.startsWith('--')) throw new Error(`Expected ${name} value, received flag ${value}`);
    return value;
  }

  const index = argv.indexOf(name);
  if (index === -1) throw new Error(`Missing required argument ${name}`);

  const value = argv[index + 1];
  if (value == null || !value.trim()) {
    throw new Error(`Expected ${name} to have a non-empty value`);
  }
  if (value.startsWith('--')) {
    throw new Error(`Expected ${name} value, received flag ${value}`);
  }

  return value;
}

function readOptionalArgValue(argv: string[], name: string): string | undefined {
  const hasSeparatedArg = argv.includes(name);
  const equalsArg = argv.find((arg) => arg === `${name}=` || arg.startsWith(`${name}=`));

  if (!hasSeparatedArg && equalsArg == null) return undefined;
  return readRequiredArgValue(argv, name);
}

function parseOptions(argv: string[]): CliOptions {
  const seasonValue = readRequiredArgValue(argv, '--season');
  const season = Number(seasonValue);

  if (!Number.isInteger(season)) {
    throw new Error('Expected --season to be an integer');
  }
  if (season !== 2026) {
    throw new Error('Only season 2026 is wired to reviewed roster evidence in this script');
  }

  return {
    season,
    diagnosticJsonl: readOptionalArgValue(argv, '--diagnostic-jsonl'),
    apply: argv.includes('--apply'),
    json: argv.includes('--json'),
  };
}

function parseJsonl(contents: string): IdentityGapDiagnosticRow[] {
  return contents
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected an object');
        }
        return parsed as IdentityGapDiagnosticRow;
      } catch (error) {
        throw new Error(
          `Invalid diagnostic JSONL at line ${lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
}

function deterministicPlayerId(playerName: string): string {
  return playerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function rosterNotes(evidence: ReviewedPlayerRosterEvidence): string {
  const sourceUrl = evidence.sourceUrl ? ` (${evidence.sourceUrl})` : '';
  return `Roster evidence: ${evidence.sourceLabel}${sourceUrl}. ${evidence.notes}`;
}

function adaptRosterEvidenceEntry(
  evidence: ReviewedPlayerRosterEvidence
): ReviewedSeasonRosterEntry {
  return {
    season: evidence.season,
    playerId: evidence.playerId ?? deterministicPlayerId(evidence.playerName),
    playerName: evidence.playerName,
    club: evidence.club,
    position: evidence.position,
    playerStatus: 'listed',
    listStatus: evidence.listStatus ?? 'active',
    active: evidence.active ?? true,
    source: evidence.source,
    sourceLabel: evidence.sourceLabel,
    sourceUrl: evidence.sourceUrl ?? '',
    reviewedBy: evidence.reviewedBy,
    reviewedAt: evidence.reviewedAt,
    notes: rosterNotes(evidence),
    aliases: [],
    diagnosticEvidence: evidence.unresolved,
  };
}

function adaptRosterEvidence(
  rosterEvidence: ReviewedPlayerRosterEvidence[]
): AdaptedRosterEvidence {
  const errors: string[] = [];
  const entries = rosterEvidence.map((evidence) => {
    const reviewedNamePlayerId = deterministicPlayerId(evidence.playerName);
    const sourceNamePlayerId = deterministicPlayerId(evidence.unresolved.sourcePlayerName);

    if (!evidence.playerId && sourceNamePlayerId !== reviewedNamePlayerId) {
      errors.push(
        `Roster evidence for ${evidence.playerName} requires explicit playerId because source player name "${evidence.unresolved.sourcePlayerName}" maps to ${sourceNamePlayerId}, not ${reviewedNamePlayerId}`
      );
    }

    return adaptRosterEvidenceEntry(evidence);
  });

  return { entries, errors };
}

function buildSummary(params: {
  apply: boolean;
  coverage: SeasonRosterCoverage;
  syncPlan: SeasonRosterSyncPlan | null;
  result: SeasonRosterSyncApplyResult | null;
}) {
  const syncPlan = params.syncPlan;
  const mayApply = Boolean(syncPlan?.valid && params.coverage.ok);

  return {
    ok: mayApply,
    apply: params.apply,
    coverage: params.coverage,
    sync: {
      built: syncPlan != null,
      valid: syncPlan?.valid ?? false,
      errors:
        syncPlan?.errors ??
        (params.coverage.ok ? [] : ['Diagnostic coverage incomplete; sync plan was not built']),
      playersToCreate: syncPlan?.playersToCreate.length ?? 0,
      playersToUpdate: syncPlan?.playersToUpdate.length ?? 0,
      registrationsToCreate: syncPlan?.registrationsToCreate.length ?? 0,
      registrationsToUpdate: syncPlan?.registrationsToUpdate.length ?? 0,
      aliasesToCreate: syncPlan?.aliasesToCreate.length ?? 0,
      existingPlayerIds: syncPlan?.existingPlayerIds.length ?? 0,
      applied: params.result?.applied ?? false,
    },
  };
}

let prismaClient: { $disconnect(): Promise<void> } | null = null;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.apply && !options.diagnosticJsonl) {
    throw new Error('Expected --diagnostic-jsonl when using --apply');
  }
  process.env.DOTENV_CONFIG_QUIET ??= 'true';
  await import('../src/lib/loadEnv');

  const [
    { playerRosterEvidence2026 },
    { prisma },
    { buildSeasonRosterCoverage },
    { applySeasonRosterSyncPlan, buildSeasonRosterSyncPlan },
  ] = await Promise.all([
    import('../src/data/playerRosterEvidence2026'),
    import('../src/lib/prisma'),
    import('../src/server/playerDirectorySeasonRoster'),
    import('../src/server/playerDirectorySeasonRosterSync'),
  ]);
  prismaClient = prisma;

  const adaptedRosterEvidence = adaptRosterEvidence(playerRosterEvidence2026);
  const rosterEntries = adaptedRosterEvidence.entries;
  const diagnosticRows = options.diagnosticJsonl
    ? parseJsonl(await readFile(options.diagnosticJsonl, 'utf8'))
    : [];
  const coverage = buildSeasonRosterCoverage({
    season: options.season,
    rosterEntries,
    diagnosticRows,
  });

  if (adaptedRosterEvidence.errors.length > 0) {
    const syncPlan: SeasonRosterSyncPlan = {
      valid: false,
      errors: adaptedRosterEvidence.errors,
      season: options.season,
      playersToCreate: [],
      playersToUpdate: [],
      registrationsToCreate: [],
      registrationsToUpdate: [],
      aliasesToCreate: [],
      existingPlayerIds: [],
    };
    const summary = buildSummary({
      apply: options.apply,
      coverage,
      syncPlan,
      result: { ...syncPlan, applied: false },
    });

    console.log(JSON.stringify(summary, null, options.json ? 0 : 2));
    process.exitCode = 1;
    return;
  }

  if (!coverage.ok) {
    const summary = buildSummary({
      apply: options.apply,
      coverage,
      syncPlan: null,
      result: null,
    });

    console.log(JSON.stringify(summary, null, options.json ? 0 : 2));
    process.exitCode = 1;
    return;
  }

  const syncPlan = await buildSeasonRosterSyncPlan(prisma, {
    season: options.season,
    entries: rosterEntries,
  });
  const mayApply = syncPlan.valid;
  const result =
    options.apply && mayApply
      ? await applySeasonRosterSyncPlan(prisma, syncPlan)
      : { ...syncPlan, applied: false };
  const summary = buildSummary({
    apply: options.apply,
    coverage,
    syncPlan,
    result,
  });

  console.log(JSON.stringify(summary, null, options.json ? 0 : 2));

  if (!mayApply) process.exitCode = 1;
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
    await prismaClient?.$disconnect();
  });
