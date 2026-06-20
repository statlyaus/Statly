import type {
  PlayerDataConvergenceDiagnostic,
  PlayerDataDeprecatedCategoryKey,
  PlayerDataMissingCategoryValue,
} from '@/server/playerDataConvergenceDiagnostic';

export type PlayerDataConvergenceActionKind =
  | 'noActionRequired'
  | 'skippedNullStatSourceEvidence'
  | 'identityReviewRequired'
  | 'ambiguousNameReviewRequired'
  | 'sourceRecordReviewRequired'
  | 'duplicateSourceIdentityReviewRequired'
  | 'staleCategoryKeyMappingReviewRequired'
  | 'missingExpectedCategoryValueReviewRequired'
  | 'unsafeForWritePlanning'
  | 'safeForNextReadOnlyDryRun'
  | 'blockedPendingProductDecision';

export type PlayerDataConvergenceActionSeverity = 'info' | 'warning' | 'error';

export type PlayerDataConvergenceAction = {
  kind: PlayerDataConvergenceActionKind;
  severity: PlayerDataConvergenceActionSeverity;
  message: string;
  count?: number;
  sourceIndexes?: number[];
  sourceIdentities?: string[];
  categories?: string[];
};

export type PlayerDataConvergencePlanStatus =
  | 'allClear'
  | 'readOnlyFollowUpSafe'
  | 'reviewRequired'
  | 'blocked';

export type PlayerDataConvergencePlan = {
  status: PlayerDataConvergencePlanStatus;
  safeForNextReadOnlyDryRun: boolean;
  safeForWritePlanning: boolean;
  requiresProductDecision: boolean;
  actions: PlayerDataConvergenceAction[];
};

export type PlayerDataConvergencePlannerInput = {
  diagnostic: PlayerDataConvergenceDiagnostic;
  expectedCategoryKeys?: readonly string[];
};

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function groupMissingValuesBySourceIndex(
  missingValues: readonly PlayerDataMissingCategoryValue[]
): Map<number, PlayerDataMissingCategoryValue[]> {
  const grouped = new Map<number, PlayerDataMissingCategoryValue[]>();

  for (const value of missingValues) {
    const values = grouped.get(value.sourceIndex) ?? [];
    values.push(value);
    grouped.set(value.sourceIndex, values);
  }

  return grouped;
}

function splitMissingCategoryValues(
  missingValues: readonly PlayerDataMissingCategoryValue[],
  expectedCategoryKeys: readonly string[]
): {
  skippedNullStatSourceEvidence: PlayerDataMissingCategoryValue[][];
  partialMissingCategoryValues: PlayerDataMissingCategoryValue[];
} {
  const expectedCategories = new Set(expectedCategoryKeys);
  const grouped = groupMissingValuesBySourceIndex(missingValues);
  const skippedNullStatSourceEvidence: PlayerDataMissingCategoryValue[][] = [];
  const partialMissingCategoryValues: PlayerDataMissingCategoryValue[] = [];

  for (const values of grouped.values()) {
    const missingCategories = new Set(values.map((value) => value.category));
    const isAllNullStatEvidence =
      expectedCategories.size > 0 &&
      [...expectedCategories].every((category) => missingCategories.has(category));

    if (isAllNullStatEvidence) {
      skippedNullStatSourceEvidence.push(values);
    } else {
      partialMissingCategoryValues.push(...values);
    }
  }

  return { skippedNullStatSourceEvidence, partialMissingCategoryValues };
}

function action(
  kind: PlayerDataConvergenceActionKind,
  severity: PlayerDataConvergenceActionSeverity,
  message: string,
  details: Omit<PlayerDataConvergenceAction, 'kind' | 'severity' | 'message'> = {}
): PlayerDataConvergenceAction {
  return { kind, severity, message, ...details };
}

function skippedNullStatAction(
  skippedGroups: readonly PlayerDataMissingCategoryValue[][]
): PlayerDataConvergenceAction {
  const firstValues = skippedGroups.map((values) => values[0]).filter(Boolean);

  return action(
    'skippedNullStatSourceEvidence',
    'warning',
    'Source rows with all expected category values missing should be skipped as source evidence, not converted into identity repair candidates.',
    {
      count: skippedGroups.length,
      sourceIndexes: firstValues.map((value) => value.sourceIndex),
      sourceIdentities: unique(firstValues.map((value) => value.sourceIdentity)),
      categories: unique(skippedGroups.flatMap((values) => values.map((value) => value.category))),
    }
  );
}

function missingCategoryAction(
  missingValues: readonly PlayerDataMissingCategoryValue[]
): PlayerDataConvergenceAction {
  return action(
    'missingExpectedCategoryValueReviewRequired',
    'warning',
    'Some source rows are missing expected category values; review source coverage before defining any repair plan.',
    {
      count: missingValues.length,
      sourceIndexes: unique(missingValues.map((value) => String(value.sourceIndex))).map(Number),
      sourceIdentities: unique(missingValues.map((value) => value.sourceIdentity)),
      categories: unique(missingValues.map((value) => value.category)),
    }
  );
}

function staleCategoryAction(
  deprecatedKeys: readonly PlayerDataDeprecatedCategoryKey[]
): PlayerDataConvergenceAction {
  return action(
    'staleCategoryKeyMappingReviewRequired',
    'warning',
    'Deprecated or stale category keys need explicit mapping review before they can be used in convergence work.',
    {
      count: deprecatedKeys.length,
      sourceIndexes: unique(deprecatedKeys.map((value) => String(value.sourceIndex))).map(Number),
      sourceIdentities: unique(deprecatedKeys.map((value) => value.sourceIdentity)),
      categories: unique(deprecatedKeys.map((value) => value.key)),
    }
  );
}

function appendIssueActions(
  diagnostic: PlayerDataConvergenceDiagnostic,
  actions: PlayerDataConvergenceAction[]
): void {
  if (diagnostic.ambiguousNameMatches.length > 0) {
    actions.push(
      action(
        'ambiguousNameReviewRequired',
        'error',
        'Ambiguous name matches require manual identity review; the planner must not guess between candidates.',
        {
          count: diagnostic.ambiguousNameMatches.length,
          sourceIndexes: diagnostic.ambiguousNameMatches.map((match) => match.sourceIndex),
          sourceIdentities: unique(
            diagnostic.ambiguousNameMatches.map((match) => match.sourceIdentity)
          ),
        }
      )
    );
  }

  if (diagnostic.unmatchedCanonicalPlayers.length > 0) {
    actions.push(
      action(
        'identityReviewRequired',
        'warning',
        'Canonical players without source evidence need identity review before write planning.',
        {
          count: diagnostic.unmatchedCanonicalPlayers.length,
          sourceIdentities: diagnostic.unmatchedCanonicalPlayers.map(
            (player) => player.canonicalPlayerId
          ),
        }
      )
    );
  }

  if (diagnostic.unmatchedSourceRecords.length > 0) {
    actions.push(
      action(
        'sourceRecordReviewRequired',
        'error',
        'Unmatched source records require source review; they must not create or repair players automatically.',
        {
          count: diagnostic.unmatchedSourceRecords.length,
          sourceIndexes: diagnostic.unmatchedSourceRecords.map((record) => record.sourceIndex),
          sourceIdentities: unique(
            diagnostic.unmatchedSourceRecords.map((record) => record.sourceIdentity)
          ),
        }
      )
    );
  }

  if (diagnostic.duplicateSourceIdentities.length > 0) {
    actions.push(
      action(
        'duplicateSourceIdentityReviewRequired',
        'warning',
        'Duplicate source identities need source-quality review before any convergence plan consumes them.',
        {
          count: diagnostic.duplicateSourceIdentities.length,
          sourceIdentities: unique(
            diagnostic.duplicateSourceIdentities.map((entry) => entry.sourceIdentity)
          ),
        }
      )
    );
  }
}

function planStatus(
  actions: readonly PlayerDataConvergenceAction[],
  unsafeForWritePlanning: boolean,
  requiresProductDecision: boolean
): PlayerDataConvergencePlanStatus {
  if (requiresProductDecision || unsafeForWritePlanning) return 'blocked';
  if (actions.some((item) => item.severity === 'warning')) return 'readOnlyFollowUpSafe';
  return 'allClear';
}

export function planPlayerDataConvergenceActions({
  diagnostic,
  expectedCategoryKeys = [],
}: PlayerDataConvergencePlannerInput): PlayerDataConvergencePlan {
  const actions: PlayerDataConvergenceAction[] = [];
  const { skippedNullStatSourceEvidence, partialMissingCategoryValues } =
    splitMissingCategoryValues(diagnostic.missingExpectedCategoryValues, expectedCategoryKeys);

  appendIssueActions(diagnostic, actions);

  if (skippedNullStatSourceEvidence.length > 0) {
    actions.push(skippedNullStatAction(skippedNullStatSourceEvidence));
  }

  if (partialMissingCategoryValues.length > 0) {
    actions.push(missingCategoryAction(partialMissingCategoryValues));
  }

  if (diagnostic.deprecatedCategoryKeys.length > 0) {
    actions.push(staleCategoryAction(diagnostic.deprecatedCategoryKeys));
  }

  const requiresProductDecision = diagnostic.ambiguousNameMatches.length > 0;
  const unsafeForWritePlanning =
    diagnostic.summary.severity === 'error' ||
    requiresProductDecision ||
    diagnostic.unmatchedSourceRecords.length > 0;

  if (unsafeForWritePlanning) {
    actions.push(
      action(
        'unsafeForWritePlanning',
        'error',
        'This diagnostic is unsafe for write planning until blocking identity/source issues are resolved.'
      )
    );
  }

  if (requiresProductDecision) {
    actions.push(
      action(
        'blockedPendingProductDecision',
        'error',
        'Ambiguous identity evidence requires an explicit product/data decision before implementation.'
      )
    );
  }

  if (actions.length === 0) {
    actions.push(
      action(
        'noActionRequired',
        'info',
        'No player data convergence action is required for this diagnostic.'
      )
    );
  }

  if (!unsafeForWritePlanning) {
    actions.push(
      action(
        'safeForNextReadOnlyDryRun',
        'info',
        'The next read-only dry-run can proceed with the current diagnostic evidence.'
      )
    );
  }

  return {
    status: planStatus(actions, unsafeForWritePlanning, requiresProductDecision),
    safeForNextReadOnlyDryRun: !unsafeForWritePlanning,
    safeForWritePlanning: false,
    requiresProductDecision,
    actions,
  };
}
