import type { PlayerDataConvergenceDiagnostic } from '@/server/playerDataConvergenceDiagnostic';
import type {
  PlayerDataConvergenceActionKind,
  PlayerDataConvergencePlan,
} from '@/server/playerDataConvergencePlanner';

export type PlayerDataConvergenceDryRunBlockerKind =
  | 'missingTempDatabasePath'
  | 'missingDatabaseUrl'
  | 'databaseUrlMustBeFileUrl'
  | 'databaseUrlMustMatchTempDatabasePath'
  | 'tempDatabaseMustUseTmpStatlyVerifyPath'
  | 'databaseUrlMustNotPointInsideRepository'
  | 'protectedDevDatabasePath'
  | 'diagnosticUnsafeForDryRun'
  | 'productDecisionRequired';

export type PlayerDataConvergenceDryRunBlocker = {
  kind: PlayerDataConvergenceDryRunBlockerKind;
  message: string;
};

export type PlayerDataConvergenceDryRunEvidence = {
  totalCanonicalPlayers: number;
  totalSourceStatRecords: number;
  totalRankingRecords: number;
  matchedRecordsByDirectId: number;
  matchedRecordsByCanonicalId: number;
  matchedRecordsByNormalizedNameTeam: number;
  ambiguousNameMatches: number;
  unmatchedCanonicalPlayers: number;
  unmatchedSourceRecords: number;
  duplicateSourceIdentities: number;
  missingExpectedCategoryValues: number;
  deprecatedCategoryKeys: number;
  skippedNullStatSourceEvidence: number;
  proposedRepairCount: number;
  skippedRepairCount: number;
};

export type PlayerDataConvergenceDryRunPlanStatus = 'readyForTempDbDryRun' | 'blocked';

export type PlayerDataConvergenceDryRunPlan = {
  status: PlayerDataConvergenceDryRunPlanStatus;
  safeForTempDbDryRun: boolean;
  safeForWritePlanning: false;
  safeForWriteApply: false;
  requiresProductDecision: boolean;
  tempDatabase: {
    statlyVerifyDb: string;
    databaseUrl: string;
    precreateRequired: true;
    cleanupCommand: string;
  };
  evidence: PlayerDataConvergenceDryRunEvidence;
  blockers: PlayerDataConvergenceDryRunBlocker[];
  approvalGates: string[];
  stopConditions: string[];
  recommendedNextAction: string;
};

export type PlayerDataConvergenceDryRunPlanInput = {
  diagnostic: PlayerDataConvergenceDiagnostic;
  convergencePlan: PlayerDataConvergencePlan;
  statlyVerifyDb?: string | null;
  databaseUrl?: string | null;
  repositoryRoot?: string | null;
};

const TMP_VERIFY_DB_PATTERN = /^\/tmp\/statly-verify-[^/]+\.db$/;

const APPROVAL_GATES = [
  'Add an apply function.',
  'Add a CLI or package script.',
  'Run any write-capable command, even against /tmp.',
  'Promote dry-run planning to temp apply simulation.',
  'Write Prisma player rows outside a disposable temp database.',
  'Touch Firestore, production, shared, or developer data.',
  'Change category mappings used by rankings or fantasy scoring.',
] as const;

const STOP_CONDITIONS = [
  'DATABASE_URL is missing, non-file://, outside /tmp, inside the repo, or points at prisma/dev.db.',
  'A command references, reads, or mutates prisma/dev.db.',
  'A command asks for .env, real secrets, production credentials, Firebase exports, or service account files.',
  'Generated files, dataconnect local data, coverage, dist, or test-results appear.',
  'An ambiguous name match or unmatched source record is present.',
  'Product judgment is required to merge, split, create, or delete players.',
  'A proposed repair is not explainable from diagnostic evidence.',
  'The work requires package scripts, Prisma schema changes, Firestore writes, ranking mutations, local JSON edits, fixture rewrites, branches, or stashes.',
] as const;

function trim(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function normalizedRepositoryRoot(repositoryRoot: string | null | undefined): string | undefined {
  const root = trim(repositoryRoot).replace(/\/+$/, '');
  return root || undefined;
}

function fileUrlFor(path: string): string {
  return `file://${path}`;
}

function actionCount(
  convergencePlan: PlayerDataConvergencePlan,
  kind: PlayerDataConvergenceActionKind
): number {
  return convergencePlan.actions
    .filter((action) => action.kind === kind)
    .reduce((total, action) => total + (action.count ?? 0), 0);
}

function blocker(
  kind: PlayerDataConvergenceDryRunBlockerKind,
  message: string
): PlayerDataConvergenceDryRunBlocker {
  return { kind, message };
}

function validateTempDatabase(input: PlayerDataConvergenceDryRunPlanInput) {
  const blockers: PlayerDataConvergenceDryRunBlocker[] = [];
  const statlyVerifyDb = trim(input.statlyVerifyDb);
  const databaseUrl = trim(input.databaseUrl);
  const repoRoot = normalizedRepositoryRoot(input.repositoryRoot);

  if (!statlyVerifyDb) {
    blockers.push(
      blocker(
        'missingTempDatabasePath',
        'STATLY_VERIFY_DB must be provided before planning a temp DB dry-run.'
      )
    );
  }

  if (!databaseUrl) {
    blockers.push(
      blocker('missingDatabaseUrl', 'DATABASE_URL must be provided before planning a dry-run.')
    );
  }

  if (databaseUrl && !databaseUrl.startsWith('file://')) {
    blockers.push(
      blocker('databaseUrlMustBeFileUrl', 'DATABASE_URL must use a file:// SQLite URL.')
    );
  }

  if (statlyVerifyDb && !TMP_VERIFY_DB_PATTERN.test(statlyVerifyDb)) {
    blockers.push(
      blocker(
        'tempDatabaseMustUseTmpStatlyVerifyPath',
        'STATLY_VERIFY_DB must match /tmp/statly-verify-*.db.'
      )
    );
  }

  if (statlyVerifyDb && databaseUrl && databaseUrl !== fileUrlFor(statlyVerifyDb)) {
    blockers.push(
      blocker(
        'databaseUrlMustMatchTempDatabasePath',
        'DATABASE_URL must equal file://${STATLY_VERIFY_DB}.'
      )
    );
  }

  if (
    statlyVerifyDb.includes('prisma/dev.db') ||
    databaseUrl.includes('prisma/dev.db') ||
    databaseUrl.includes('/prisma/dev.db')
  ) {
    blockers.push(
      blocker(
        'protectedDevDatabasePath',
        'The dry-run plan must never point at the protected prisma/dev.db database.'
      )
    );
  }

  if (
    repoRoot &&
    ((statlyVerifyDb && statlyVerifyDb.startsWith(`${repoRoot}/`)) ||
      (databaseUrl && databaseUrl.startsWith(fileUrlFor(`${repoRoot}/`))))
  ) {
    blockers.push(
      blocker(
        'databaseUrlMustNotPointInsideRepository',
        'The temp database must live outside the repository.'
      )
    );
  }

  return { statlyVerifyDb, databaseUrl, blockers };
}

function diagnosticBlockers({
  diagnostic,
  convergencePlan,
}: Pick<PlayerDataConvergenceDryRunPlanInput, 'diagnostic' | 'convergencePlan'>) {
  const blockers: PlayerDataConvergenceDryRunBlocker[] = [];

  if (
    diagnostic.summary.severity === 'error' ||
    diagnostic.ambiguousNameMatches.length > 0 ||
    diagnostic.unmatchedSourceRecords.length > 0 ||
    convergencePlan.status === 'blocked' ||
    !convergencePlan.safeForNextReadOnlyDryRun
  ) {
    blockers.push(
      blocker(
        'diagnosticUnsafeForDryRun',
        'Resolve ambiguous identity or unmatched source evidence before temp DB dry-run planning.'
      )
    );
  }

  if (convergencePlan.requiresProductDecision) {
    blockers.push(
      blocker(
        'productDecisionRequired',
        'Product/data decisions must be resolved before dry-run planning.'
      )
    );
  }

  return blockers;
}

function dryRunEvidence(
  diagnostic: PlayerDataConvergenceDiagnostic,
  convergencePlan: PlayerDataConvergencePlan
): PlayerDataConvergenceDryRunEvidence {
  const skippedNullStatSourceEvidence = actionCount(
    convergencePlan,
    'skippedNullStatSourceEvidence'
  );

  return {
    totalCanonicalPlayers: diagnostic.summary.totalCanonicalPlayers,
    totalSourceStatRecords: diagnostic.summary.totalSourceStatRecords,
    totalRankingRecords: diagnostic.summary.totalRankingRecords,
    matchedRecordsByDirectId: diagnostic.summary.matchedRecordsByDirectId,
    matchedRecordsByCanonicalId: diagnostic.summary.matchedRecordsByCanonicalId,
    matchedRecordsByNormalizedNameTeam: diagnostic.summary.matchedRecordsByNormalizedNameTeam,
    ambiguousNameMatches: diagnostic.summary.ambiguousNameMatches,
    unmatchedCanonicalPlayers: diagnostic.summary.unmatchedCanonicalPlayers,
    unmatchedSourceRecords: diagnostic.summary.unmatchedSourceRecords,
    duplicateSourceIdentities: diagnostic.summary.duplicateSourceIdentities,
    missingExpectedCategoryValues: diagnostic.summary.missingExpectedCategoryValues,
    deprecatedCategoryKeys: diagnostic.summary.deprecatedCategoryKeys,
    skippedNullStatSourceEvidence,
    proposedRepairCount: 0,
    skippedRepairCount:
      diagnostic.summary.unmatchedCanonicalPlayers +
      diagnostic.summary.unmatchedSourceRecords +
      diagnostic.summary.ambiguousNameMatches +
      diagnostic.summary.duplicateSourceIdentities +
      diagnostic.summary.deprecatedCategoryKeys +
      skippedNullStatSourceEvidence,
  };
}

export function planPlayerDataConvergenceTempDbDryRun(
  input: PlayerDataConvergenceDryRunPlanInput
): PlayerDataConvergenceDryRunPlan {
  const {
    statlyVerifyDb,
    databaseUrl,
    blockers: tempDatabaseBlockers,
  } = validateTempDatabase(input);
  const blockers = [
    ...tempDatabaseBlockers,
    ...diagnosticBlockers({
      diagnostic: input.diagnostic,
      convergencePlan: input.convergencePlan,
    }),
  ];
  const safeForTempDbDryRun = blockers.length === 0;

  return {
    status: safeForTempDbDryRun ? 'readyForTempDbDryRun' : 'blocked',
    safeForTempDbDryRun,
    safeForWritePlanning: false,
    safeForWriteApply: false,
    requiresProductDecision: input.convergencePlan.requiresProductDecision,
    tempDatabase: {
      statlyVerifyDb,
      databaseUrl,
      precreateRequired: true,
      cleanupCommand: 'rm -f "$STATLY_VERIFY_DB"',
    },
    evidence: dryRunEvidence(input.diagnostic, input.convergencePlan),
    blockers,
    approvalGates: [...APPROVAL_GATES],
    stopConditions: [...STOP_CONDITIONS],
    recommendedNextAction: safeForTempDbDryRun
      ? 'Run a separately approved temp DB dry-run with structured evidence; do not add an apply path yet.'
      : 'Resolve blockers before any temp DB dry-run or write-capable convergence work.',
  };
}
