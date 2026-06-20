import type { PlayerDataConvergenceDiagnostic } from '@/server/playerDataConvergenceDiagnostic';
import type {
  PlayerDataConvergenceAction,
  PlayerDataConvergencePlan,
} from '@/server/playerDataConvergencePlanner';

export type PlayerDataConvergenceApplyPlanStatus =
  | 'noProductRepairs'
  | 'blocked'
  | 'requiresReview';

export type PlayerDataConvergenceApplyPlanBlockerKind =
  | 'plannerBlocked'
  | 'plannerUnsafeForReadOnlyFollowUp'
  | 'ambiguousNameMatches'
  | 'unmatchedSourceRecords'
  | 'unsafeForWritePlanning'
  | 'productDecisionRequired';

export type PlayerDataConvergenceApplyPlanBlocker = {
  kind: PlayerDataConvergenceApplyPlanBlockerKind;
  message: string;
  count?: number;
};

export type PlayerDataConvergenceSkippedEvidenceKind =
  | 'nullStatSourceEvidence'
  | 'duplicateSourceIdentity'
  | 'missingCategoryValue'
  | 'staleCategoryKey'
  | 'unmatchedCanonicalPlayer';

export type PlayerDataConvergenceSkippedEvidence = {
  kind: PlayerDataConvergenceSkippedEvidenceKind;
  message: string;
  count: number;
  sourceIndexes?: number[];
  sourceIdentities?: string[];
  categories?: string[];
};

export type PlayerDataConvergenceProductMutationKind =
  | 'createPlayer'
  | 'updatePlayerIdentity'
  | 'updatePlayerClub'
  | 'updatePlayerPosition'
  | 'updateCategoryMapping';

export type PlayerDataConvergenceProductMutation = {
  kind: PlayerDataConvergenceProductMutationKind;
  playerId?: string;
  reason: string;
};

export type PlayerDataConvergenceApplyPlan = {
  status: PlayerDataConvergenceApplyPlanStatus;
  safeForTempDbApplySimulation: boolean;
  safeForProductApply: false;
  requiresProductDecision: boolean;
  productMutationCount: number;
  skippedEvidenceCount: number;
  productMutations: PlayerDataConvergenceProductMutation[];
  skippedEvidence: PlayerDataConvergenceSkippedEvidence[];
  blockers: PlayerDataConvergenceApplyPlanBlocker[];
  approvalGates: string[];
  stopConditions: string[];
  recommendedNextAction: string;
};

export type PlayerDataConvergenceApplyPlanInput = {
  diagnostic: PlayerDataConvergenceDiagnostic;
  convergencePlan: PlayerDataConvergencePlan;
};

function blocker(
  kind: PlayerDataConvergenceApplyPlanBlockerKind,
  message: string,
  count?: number
): PlayerDataConvergenceApplyPlanBlocker {
  return count === undefined ? { kind, message } : { kind, message, count };
}

function toSkippedEvidence(
  action: PlayerDataConvergenceAction
): PlayerDataConvergenceSkippedEvidence | undefined {
  if (!action.count || action.count < 1) return undefined;

  if (action.kind === 'skippedNullStatSourceEvidence') {
    return {
      kind: 'nullStatSourceEvidence',
      message:
        'Rows with all expected stat categories missing are skipped source evidence, not product repair candidates.',
      count: action.count,
      sourceIndexes: action.sourceIndexes,
      sourceIdentities: action.sourceIdentities,
      categories: action.categories,
    };
  }

  if (action.kind === 'duplicateSourceIdentityReviewRequired') {
    return {
      kind: 'duplicateSourceIdentity',
      message: 'Duplicate source identities need source-quality review before apply planning.',
      count: action.count,
      sourceIdentities: action.sourceIdentities,
    };
  }

  if (action.kind === 'missingExpectedCategoryValueReviewRequired') {
    return {
      kind: 'missingCategoryValue',
      message: 'Missing category values need source coverage review before apply planning.',
      count: action.count,
      sourceIndexes: action.sourceIndexes,
      sourceIdentities: action.sourceIdentities,
      categories: action.categories,
    };
  }

  if (action.kind === 'staleCategoryKeyMappingReviewRequired') {
    return {
      kind: 'staleCategoryKey',
      message: 'Stale category keys need explicit mapping review before apply planning.',
      count: action.count,
      sourceIndexes: action.sourceIndexes,
      sourceIdentities: action.sourceIdentities,
      categories: action.categories,
    };
  }

  if (action.kind === 'identityReviewRequired') {
    return {
      kind: 'unmatchedCanonicalPlayer',
      message: 'Canonical players without source evidence need review before apply planning.',
      count: action.count,
      sourceIdentities: action.sourceIdentities,
    };
  }

  return undefined;
}

function applyPlanBlockers({
  diagnostic,
  convergencePlan,
}: PlayerDataConvergenceApplyPlanInput): PlayerDataConvergenceApplyPlanBlocker[] {
  const blockers: PlayerDataConvergenceApplyPlanBlocker[] = [];

  if (convergencePlan.status === 'blocked') {
    blockers.push(
      blocker(
        'plannerBlocked',
        'The convergence planner is blocked and cannot produce an apply plan.'
      )
    );
  }

  if (!convergencePlan.safeForNextReadOnlyDryRun) {
    blockers.push(
      blocker(
        'plannerUnsafeForReadOnlyFollowUp',
        'The diagnostic evidence is not safe for the next read-only follow-up.'
      )
    );
  }

  if (diagnostic.ambiguousNameMatches.length > 0) {
    blockers.push(
      blocker(
        'ambiguousNameMatches',
        'Ambiguous name matches require a product/data decision before apply planning.',
        diagnostic.ambiguousNameMatches.length
      )
    );
  }

  if (diagnostic.unmatchedSourceRecords.length > 0) {
    blockers.push(
      blocker(
        'unmatchedSourceRecords',
        'Unmatched source records must not create or update players automatically.',
        diagnostic.unmatchedSourceRecords.length
      )
    );
  }

  if (convergencePlan.actions.some((action) => action.kind === 'unsafeForWritePlanning')) {
    blockers.push(
      blocker(
        'unsafeForWritePlanning',
        'The planner marked this evidence unsafe for write planning.'
      )
    );
  }

  if (convergencePlan.requiresProductDecision) {
    blockers.push(
      blocker(
        'productDecisionRequired',
        'A product/data decision is required before any apply plan can proceed.'
      )
    );
  }

  return blockers;
}

export function planPlayerDataConvergenceApply({
  diagnostic,
  convergencePlan,
}: PlayerDataConvergenceApplyPlanInput): PlayerDataConvergenceApplyPlan {
  const blockers = applyPlanBlockers({ diagnostic, convergencePlan });
  const skippedEvidence = convergencePlan.actions
    .map(toSkippedEvidence)
    .filter((item): item is PlayerDataConvergenceSkippedEvidence => Boolean(item));
  const productMutations: PlayerDataConvergenceProductMutation[] = [];
  const productMutationCount = productMutations.length;
  const skippedEvidenceCount = skippedEvidence.reduce((total, item) => total + item.count, 0);
  const hasReviewOnlyEvidence = skippedEvidence.length > 0;
  const status: PlayerDataConvergenceApplyPlanStatus =
    blockers.length > 0 ? 'blocked' : hasReviewOnlyEvidence ? 'requiresReview' : 'noProductRepairs';

  return {
    status,
    safeForTempDbApplySimulation: blockers.length === 0 && productMutationCount === 0,
    safeForProductApply: false,
    requiresProductDecision: convergencePlan.requiresProductDecision,
    productMutationCount,
    skippedEvidenceCount,
    productMutations,
    skippedEvidence,
    blockers,
    approvalGates: [
      'Add a deterministic product mutation kind.',
      'Run a temp-DB apply simulation.',
      'Promote temp-DB apply simulation into durable product apply.',
      'Write Prisma Player rows, Firestore stats, local JSON, rankings, or category mappings.',
    ],
    stopConditions: [
      'Any ambiguous name match or unmatched source record is present.',
      'Any proposed mutation requires player merge, split, create, delete, or category product judgment.',
      'Any apply path points at prisma/dev.db or a database outside /tmp/statly-verify-*.db during simulation.',
      'Any future implementation tries to make safeForProductApply true by default.',
    ],
    recommendedNextAction:
      blockers.length > 0
        ? 'Resolve blockers before temp-DB apply simulation.'
        : 'Use this zero-repair apply plan as input to a temp-DB apply simulation; do not perform product writes.',
  };
}
