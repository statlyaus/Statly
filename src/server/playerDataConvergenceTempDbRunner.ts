import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';

export type PlayerDataConvergenceTempDbRunnerStatus = 'previewWritten' | 'blocked';

export type PlayerDataConvergenceTempDbRunnerBlockerKind =
  | 'dryRunNotReady'
  | 'simulationNotReady'
  | 'writePlanningEnabled'
  | 'writeApplyEnabled'
  | 'proposedWriteCountNonZero'
  | 'tempDatabaseMissing'
  | 'dryRunBlockersPresent'
  | 'runtimeBlockersPresent';

export type PlayerDataConvergenceTempDbRunnerBlocker = {
  kind: PlayerDataConvergenceTempDbRunnerBlockerKind;
  message: string;
};

export type PlayerDataConvergenceTempDbExecutor = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
};

export type PlayerDataConvergenceTempDbRunnerInput = {
  report: PlayerDataConvergenceTrackedDryRunReport;
  executor: PlayerDataConvergenceTempDbExecutor;
  now?: Date;
};

export type PlayerDataConvergenceTempDbPreviewResult = {
  status: PlayerDataConvergenceTempDbRunnerStatus;
  tempDatabase: string;
  safeForProductWrites: false;
  previewTables: readonly string[];
  previewRunId: string | null;
  previewEvidenceRows: number;
  blockers: PlayerDataConvergenceTempDbRunnerBlocker[];
  acceptance: {
    statusReadyForUat: boolean;
    simulationReady: boolean;
    proposedWriteCountZero: boolean;
    writeApplyBlocked: boolean;
    tempDatabasePresent: boolean;
  };
};

type CountRow = {
  count: bigint | number | string;
};

const PREVIEW_RUN_TABLE = 'player_data_convergence_preview_runs';
const PREVIEW_EVIDENCE_TABLE = 'player_data_convergence_preview_evidence';
const PREVIEW_TABLES = [PREVIEW_RUN_TABLE, PREVIEW_EVIDENCE_TABLE] as const;

function blocker(
  kind: PlayerDataConvergenceTempDbRunnerBlockerKind,
  message: string
): PlayerDataConvergenceTempDbRunnerBlocker {
  return { kind, message };
}

function countValue(rows: readonly CountRow[]): number {
  const value = rows[0]?.count ?? 0;
  return Number(value);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function previewRunId(now: Date): string {
  return `player-data-preview-${now.toISOString()}`;
}

export function validatePlayerDataConvergenceTempDbRunner(
  report: PlayerDataConvergenceTrackedDryRunReport
): PlayerDataConvergenceTempDbRunnerBlocker[] {
  const blockers: PlayerDataConvergenceTempDbRunnerBlocker[] = [];

  if (report.status !== 'readyForUat') {
    blockers.push(
      blocker('dryRunNotReady', 'The tracked dry-run report must be readyForUat before preview.')
    );
  }

  if (
    report.simulation.status !== 'readyForTempDbSimulation' ||
    !report.simulation.safeForTempDbSimulation
  ) {
    blockers.push(
      blocker('simulationNotReady', 'The temp DB simulation contract must be ready before preview.')
    );
  }

  if (report.simulation.safeForWritePlanning || report.dryRunSummary.safeForWritePlanning) {
    blockers.push(
      blocker('writePlanningEnabled', 'Write planning must remain disabled for preview.')
    );
  }

  if (report.simulation.safeForWriteApply || report.dryRunSummary.safeForWriteApply) {
    blockers.push(blocker('writeApplyEnabled', 'Write apply must remain disabled for preview.'));
  }

  if (
    report.simulation.proposedWriteCount !== 0 ||
    report.dryRunSummary.proposedRepairCount !== 0
  ) {
    blockers.push(
      blocker('proposedWriteCountNonZero', 'Preview requires zero proposed writes or repairs.')
    );
  }

  if (!report.runtimeChecks.tempDatabaseFileExists) {
    blockers.push(
      blocker('tempDatabaseMissing', 'STATLY_VERIFY_DB must be pre-created before preview.')
    );
  }

  if (report.dryRunPlan.blockers.length > 0) {
    blockers.push(
      blocker('dryRunBlockersPresent', 'Dry-run blockers must be resolved before preview.')
    );
  }

  if (report.runtimeChecks.blockers.length > 0) {
    blockers.push(
      blocker('runtimeBlockersPresent', 'Runtime blockers must be resolved before preview.')
    );
  }

  return blockers;
}

async function createPreviewTables(executor: PlayerDataConvergenceTempDbExecutor): Promise<void> {
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS "${PREVIEW_RUN_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "tempDatabase" TEXT NOT NULL,
      "safeForProductWrites" INTEGER NOT NULL,
      "diagnosticJson" TEXT NOT NULL,
      "simulationJson" TEXT NOT NULL
    )
  `);
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS "${PREVIEW_EVIDENCE_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "runId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "payloadJson" TEXT NOT NULL,
      FOREIGN KEY ("runId") REFERENCES "${PREVIEW_RUN_TABLE}"("id") ON DELETE CASCADE
    )
  `);
}

async function insertPreviewRows({
  executor,
  report,
  runId,
  createdAt,
}: {
  executor: PlayerDataConvergenceTempDbExecutor;
  report: PlayerDataConvergenceTrackedDryRunReport;
  runId: string;
  createdAt: string;
}): Promise<void> {
  await executor.execute(
    `
      INSERT INTO "${PREVIEW_RUN_TABLE}" (
        "id",
        "createdAt",
        "status",
        "tempDatabase",
        "safeForProductWrites",
        "diagnosticJson",
        "simulationJson"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      runId,
      createdAt,
      report.status,
      report.dryRunPlan.tempDatabase.statlyVerifyDb,
      0,
      json(report.diagnostic),
      json(report.simulation),
    ]
  );

  const evidenceRows = [
    ['dryRunSummary', report.dryRunSummary],
    ['skippedSourceEvidence', report.skippedSourceEvidence],
    ['runtimeChecks', report.runtimeChecks],
    ['trackedDataWarnings', report.trackedDataWarnings],
  ] as const;

  for (const [kind, payload] of evidenceRows) {
    await executor.execute(
      `
        INSERT INTO "${PREVIEW_EVIDENCE_TABLE}" (
          "id",
          "runId",
          "kind",
          "payloadJson"
        )
        VALUES (?, ?, ?, ?)
      `,
      [`${runId}:${kind}`, runId, kind, json(payload)]
    );
  }
}

export async function runPlayerDataConvergenceTempDbPreview({
  report,
  executor,
  now = new Date(),
}: PlayerDataConvergenceTempDbRunnerInput): Promise<PlayerDataConvergenceTempDbPreviewResult> {
  const blockers = validatePlayerDataConvergenceTempDbRunner(report);
  const acceptance = {
    statusReadyForUat: report.status === 'readyForUat',
    simulationReady: report.simulation.status === 'readyForTempDbSimulation',
    proposedWriteCountZero: report.simulation.proposedWriteCount === 0,
    writeApplyBlocked:
      !report.simulation.safeForWriteApply && !report.dryRunSummary.safeForWriteApply,
    tempDatabasePresent: report.runtimeChecks.tempDatabaseFileExists,
  };

  if (blockers.length > 0) {
    return {
      status: 'blocked',
      tempDatabase: report.dryRunPlan.tempDatabase.statlyVerifyDb,
      safeForProductWrites: false,
      previewTables: PREVIEW_TABLES,
      previewRunId: null,
      previewEvidenceRows: 0,
      blockers,
      acceptance,
    };
  }

  const runId = previewRunId(now);
  await createPreviewTables(executor);
  await insertPreviewRows({
    executor,
    report,
    runId,
    createdAt: now.toISOString(),
  });
  const rows = await executor.query<CountRow>(
    `SELECT COUNT(*) AS "count" FROM "${PREVIEW_EVIDENCE_TABLE}" WHERE "runId" = ?`,
    [runId]
  );

  return {
    status: 'previewWritten',
    tempDatabase: report.dryRunPlan.tempDatabase.statlyVerifyDb,
    safeForProductWrites: false,
    previewTables: PREVIEW_TABLES,
    previewRunId: runId,
    previewEvidenceRows: countValue(rows),
    blockers: [],
    acceptance,
  };
}
