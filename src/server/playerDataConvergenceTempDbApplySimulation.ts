import type { PlayerDataConvergenceApplyPlan } from '@/server/playerDataConvergenceApplyPlan';
import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import type { PlayerDataConvergenceTempDbExecutor } from '@/server/playerDataConvergenceTempDbRunner';

export type PlayerDataConvergenceTempDbApplySimulationStatus = 'simulationApplied' | 'blocked';

export type PlayerDataConvergenceTempDbApplySimulationBlockerKind =
  | 'dryRunNotReady'
  | 'applyPlanNotReady'
  | 'tempDbApplySimulationDisabled'
  | 'productApplyEnabled'
  | 'productMutationsPresent'
  | 'tempDatabaseMissing'
  | 'dryRunBlockersPresent'
  | 'runtimeBlockersPresent';

export type PlayerDataConvergenceTempDbApplySimulationBlocker = {
  kind: PlayerDataConvergenceTempDbApplySimulationBlockerKind;
  message: string;
};

export type PlayerDataConvergenceTempDbApplySimulationInput = {
  report: PlayerDataConvergenceTrackedDryRunReport;
  applyPlan: PlayerDataConvergenceApplyPlan;
  executor: PlayerDataConvergenceTempDbExecutor;
  now?: Date;
};

export type PlayerDataConvergenceTempDbApplySimulationResult = {
  status: PlayerDataConvergenceTempDbApplySimulationStatus;
  tempDatabase: string;
  safeForProductApply: false;
  simulationTables: readonly string[];
  productShapeTable: string;
  simulationRunId: string | null;
  plannedMutationCount: number;
  appliedMutationCount: number;
  beforeProductRows: number;
  afterProductRows: number;
  blockers: PlayerDataConvergenceTempDbApplySimulationBlocker[];
  acceptance: {
    statusReadyForUat: boolean;
    applyPlanReady: boolean;
    zeroProductMutations: boolean;
    productApplyBlocked: boolean;
    tempDatabasePresent: boolean;
  };
};

type CountRow = {
  count: bigint | number | string;
};

const APPLY_RUN_TABLE = 'player_data_convergence_apply_simulation_runs';
const APPLY_MUTATION_TABLE = 'player_data_convergence_apply_simulation_mutations';
const APPLY_PRODUCT_SHAPE_TABLE = 'player_data_convergence_apply_simulated_players';
const APPLY_SIMULATION_TABLES = [
  APPLY_RUN_TABLE,
  APPLY_MUTATION_TABLE,
  APPLY_PRODUCT_SHAPE_TABLE,
] as const;

function blocker(
  kind: PlayerDataConvergenceTempDbApplySimulationBlockerKind,
  message: string
): PlayerDataConvergenceTempDbApplySimulationBlocker {
  return { kind, message };
}

function countValue(rows: readonly CountRow[]): number {
  const value = rows[0]?.count ?? 0;
  return Number(value);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function simulationRunId(now: Date): string {
  return `player-data-apply-simulation-${now.toISOString()}`;
}

export function validatePlayerDataConvergenceTempDbApplySimulation({
  report,
  applyPlan,
}: Pick<
  PlayerDataConvergenceTempDbApplySimulationInput,
  'report' | 'applyPlan'
>): PlayerDataConvergenceTempDbApplySimulationBlocker[] {
  const blockers: PlayerDataConvergenceTempDbApplySimulationBlocker[] = [];

  if (report.status !== 'readyForUat') {
    blockers.push(
      blocker(
        'dryRunNotReady',
        'The tracked dry-run report must be readyForUat before apply simulation.'
      )
    );
  }

  if (applyPlan.status === 'blocked') {
    blockers.push(
      blocker('applyPlanNotReady', 'The apply plan must not be blocked before simulation.')
    );
  }

  if (!applyPlan.safeForTempDbApplySimulation) {
    blockers.push(
      blocker(
        'tempDbApplySimulationDisabled',
        'The apply plan must explicitly allow temp-DB apply simulation.'
      )
    );
  }

  if (applyPlan.safeForProductApply) {
    blockers.push(
      blocker('productApplyEnabled', 'Product apply must remain disabled during simulation.')
    );
  }

  if (applyPlan.productMutationCount !== 0 || applyPlan.productMutations.length !== 0) {
    blockers.push(
      blocker(
        'productMutationsPresent',
        'The first temp-DB apply simulation only accepts a zero-mutation apply plan.'
      )
    );
  }

  if (!report.runtimeChecks.tempDatabaseFileExists) {
    blockers.push(
      blocker('tempDatabaseMissing', 'STATLY_VERIFY_DB must be pre-created before simulation.')
    );
  }

  if (report.dryRunPlan.blockers.length > 0) {
    blockers.push(
      blocker('dryRunBlockersPresent', 'Dry-run blockers must be resolved before simulation.')
    );
  }

  if (report.runtimeChecks.blockers.length > 0) {
    blockers.push(
      blocker('runtimeBlockersPresent', 'Runtime blockers must be resolved before simulation.')
    );
  }

  return blockers;
}

async function createApplySimulationTables(
  executor: PlayerDataConvergenceTempDbExecutor
): Promise<void> {
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS "${APPLY_RUN_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "tempDatabase" TEXT NOT NULL,
      "safeForProductApply" INTEGER NOT NULL,
      "plannedMutationCount" INTEGER NOT NULL,
      "applyPlanJson" TEXT NOT NULL
    )
  `);
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS "${APPLY_MUTATION_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "runId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "playerId" TEXT,
      "payloadJson" TEXT NOT NULL,
      FOREIGN KEY ("runId") REFERENCES "${APPLY_RUN_TABLE}"("id") ON DELETE CASCADE
    )
  `);
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS "${APPLY_PRODUCT_SHAPE_TABLE}" (
      "runId" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "club" TEXT,
      "position" TEXT,
      "active" INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY ("runId", "id"),
      FOREIGN KEY ("runId") REFERENCES "${APPLY_RUN_TABLE}"("id") ON DELETE CASCADE
    )
  `);
}

async function countSimulatedProductRows({
  executor,
  runId,
}: {
  executor: PlayerDataConvergenceTempDbExecutor;
  runId: string;
}): Promise<number> {
  const rows = await executor.query<CountRow>(
    `SELECT COUNT(*) AS "count" FROM "${APPLY_PRODUCT_SHAPE_TABLE}" WHERE "runId" = ?`,
    [runId]
  );

  return countValue(rows);
}

export async function runPlayerDataConvergenceTempDbApplySimulation({
  report,
  applyPlan,
  executor,
  now = new Date(),
}: PlayerDataConvergenceTempDbApplySimulationInput): Promise<PlayerDataConvergenceTempDbApplySimulationResult> {
  const blockers = validatePlayerDataConvergenceTempDbApplySimulation({ report, applyPlan });
  const acceptance = {
    statusReadyForUat: report.status === 'readyForUat',
    applyPlanReady: applyPlan.status !== 'blocked' && applyPlan.safeForTempDbApplySimulation,
    zeroProductMutations:
      applyPlan.productMutationCount === 0 && applyPlan.productMutations.length === 0,
    productApplyBlocked: !applyPlan.safeForProductApply,
    tempDatabasePresent: report.runtimeChecks.tempDatabaseFileExists,
  };

  if (blockers.length > 0) {
    return {
      status: 'blocked',
      tempDatabase: report.dryRunPlan.tempDatabase.statlyVerifyDb,
      safeForProductApply: false,
      simulationTables: APPLY_SIMULATION_TABLES,
      productShapeTable: APPLY_PRODUCT_SHAPE_TABLE,
      simulationRunId: null,
      plannedMutationCount: applyPlan.productMutationCount,
      appliedMutationCount: 0,
      beforeProductRows: 0,
      afterProductRows: 0,
      blockers,
      acceptance,
    };
  }

  const runId = simulationRunId(now);
  await createApplySimulationTables(executor);
  const beforeProductRows = await countSimulatedProductRows({ executor, runId });

  await executor.execute(
    `
      INSERT INTO "${APPLY_RUN_TABLE}" (
        "id",
        "createdAt",
        "status",
        "tempDatabase",
        "safeForProductApply",
        "plannedMutationCount",
        "applyPlanJson"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      runId,
      now.toISOString(),
      applyPlan.status,
      report.dryRunPlan.tempDatabase.statlyVerifyDb,
      0,
      applyPlan.productMutationCount,
      json(applyPlan),
    ]
  );

  const afterProductRows = await countSimulatedProductRows({ executor, runId });

  return {
    status: 'simulationApplied',
    tempDatabase: report.dryRunPlan.tempDatabase.statlyVerifyDb,
    safeForProductApply: false,
    simulationTables: APPLY_SIMULATION_TABLES,
    productShapeTable: APPLY_PRODUCT_SHAPE_TABLE,
    simulationRunId: runId,
    plannedMutationCount: applyPlan.productMutationCount,
    appliedMutationCount: 0,
    beforeProductRows,
    afterProductRows,
    blockers: [],
    acceptance,
  };
}
