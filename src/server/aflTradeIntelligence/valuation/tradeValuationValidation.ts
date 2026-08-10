import {
  buildAflTradeAttributionFrontier,
  validateAflTradeAttribution,
} from '../domain/lineageAttribution';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';
import { aflTradeComponentDrawSetSchema, type AflTradeComponentDrawSet } from './componentDrawSet';
import { aflTradePackagePolicySchema, type AflTradePackagePolicy } from './packagePolicy';
import {
  aflTradeRealizedContributionLedgerSchema,
  validateAflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedger,
} from './realizedContributionLedger';
import {
  aflTradeStructuredExplanationSchema,
  createAflTradeStructuredExplanation,
  validateAflTradeStructuredExplanationParity,
  type AflTradeStructuredExplanation,
} from './structuredExplanations';
import {
  aflTradeValuationCalculationSchema,
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import {
  aflTradeValuationCaseSchema,
  createAflTradeLineageGraphId,
  validateAflTradeValuationCaseLineage,
  type AflTradeValuationCase,
} from './valuationCaseContracts';
import {
  aflTradeValuationSnapshotSetSchema,
  createAflTradeValuationSnapshotSet,
  type AflTradeValuationSnapshotSet,
} from './valuationSnapshots';

export const AFL_TRADE_VALUATION_VALIDATION_CHECKS = [
  'artifact_schemas',
  'lineage_graph',
  'valuation_case_lineage',
  'realized_contribution_attribution',
  'terminal_frontier_exactly_once',
  'calculation_deterministic_replay',
  'snapshot_deterministic_replay',
  'explanation_deterministic_replay',
  'explanation_numerical_parity',
  'public_asset_ownership_boundary',
] as const;

export type AflTradeValuationValidationCheckId =
  (typeof AFL_TRADE_VALUATION_VALIDATION_CHECKS)[number];

export type AflTradeValuationValidationIssueCode =
  | 'invalid_artifact_schema'
  | 'invalid_lineage_graph'
  | 'lineage_graph_id_mismatch'
  | 'invalid_case_lineage'
  | 'invalid_realized_attribution'
  | 'invalid_terminal_frontier'
  | 'calculation_replay_mismatch'
  | 'snapshot_replay_mismatch'
  | 'explanation_replay_mismatch'
  | 'explanation_parity_mismatch'
  | 'forbidden_ownership_or_legacy_value_field'
  | 'validation_execution_failed';

export interface AflTradeValuationValidationIssue {
  code: AflTradeValuationValidationIssueCode;
  checkId: AflTradeValuationValidationCheckId;
  subjectId: string | null;
  message: string;
}

export interface AflTradeValuationValidationCheck {
  checkId: AflTradeValuationValidationCheckId;
  status: 'passed' | 'failed';
  issueCount: number;
}

export const AFL_TRADE_VALUATION_EXTERNAL_BLOCKERS = [
  'lawful_source_rights_unproven',
  'real_historical_data_not_run',
  'model_calibration_exit_criteria_unproven',
  'gate_approvals_unproven',
  'production_storage_and_release_unproven',
] as const;

export interface AflTradeValuationValidationReport {
  schemaVersion: 'afl-trade-valuation-validation-report/v1';
  structurallyValid: boolean;
  publicationReady: false;
  checks: AflTradeValuationValidationCheck[];
  issues: AflTradeValuationValidationIssue[];
  externalBlockers: readonly (typeof AFL_TRADE_VALUATION_EXTERNAL_BLOCKERS)[number][];
  limitation: 'Source-independent validation cannot establish lawful source rights, real-data performance, Gate approval, production migration, or release readiness.';
}

export interface AflTradeValuationArtifactChain {
  valuationCase: AflTradeValuationCase;
  lineageGraph: AflTradeLineageGraph;
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  calculation: AflTradeValuationCalculation;
  snapshotSet: AflTradeValuationSnapshotSet;
  explanation: AflTradeStructuredExplanation;
}

const forbiddenKeys = new Set([
  'userId',
  'fantasyLeagueId',
  'fantasyTeamId',
  'ownerId',
  'rosterOwnerId',
  'legacyExpectedValue',
  'legacyActualValue',
]);

function collectForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectForbiddenKeys(child, `${path}[${index}]`, found));
    return found;
  }
  if (value === null || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key)) found.push(childPath);
    collectForbiddenKeys(child, childPath, found);
  }
  return found;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown validation failure.';
}

export function validateAflTradeValuationArtifactChain(
  chain: AflTradeValuationArtifactChain
): AflTradeValuationValidationReport {
  const issues: AflTradeValuationValidationIssue[] = [];
  const issue = (
    checkId: AflTradeValuationValidationCheckId,
    code: AflTradeValuationValidationIssueCode,
    message: string,
    subjectId: string | null = null
  ) => issues.push({ checkId, code, subjectId, message });

  const schemaResults = [
    ['valuation-case', aflTradeValuationCaseSchema.safeParse(chain.valuationCase)],
    ['component-draw-set', aflTradeComponentDrawSetSchema.safeParse(chain.componentDrawSet)],
    [
      'realized-contribution-ledger',
      aflTradeRealizedContributionLedgerSchema.safeParse(chain.realizedContributionLedger),
    ],
    ['package-policy', aflTradePackagePolicySchema.safeParse(chain.packagePolicy)],
    ['valuation-calculation', aflTradeValuationCalculationSchema.safeParse(chain.calculation)],
    ['valuation-snapshot-set', aflTradeValuationSnapshotSetSchema.safeParse(chain.snapshotSet)],
    ['structured-explanation', aflTradeStructuredExplanationSchema.safeParse(chain.explanation)],
  ] as const;
  for (const [subjectId, result] of schemaResults) {
    if (!result.success) {
      issue(
        'artifact_schemas',
        'invalid_artifact_schema',
        `${subjectId} failed its strict immutable schema.`,
        subjectId
      );
    }
  }

  const graphValidation = validateAflTradeLineageGraph(chain.lineageGraph);
  if (!graphValidation.valid) {
    for (const graphIssue of graphValidation.issues) {
      issue('lineage_graph', 'invalid_lineage_graph', graphIssue.message, graphIssue.subjectId);
    }
  }
  try {
    if (
      createAflTradeLineageGraphId(chain.lineageGraph) !==
      chain.valuationCase.content.lineageGraphId
    ) {
      issue(
        'lineage_graph',
        'lineage_graph_id_mismatch',
        'The supplied lineage graph does not match the valuation-case content address.'
      );
    }
  } catch (error) {
    issue(
      'lineage_graph',
      'validation_execution_failed',
      `Lineage graph identity could not be calculated: ${errorMessage(error)}`
    );
  }

  if (schemaResults[0][1].success) {
    try {
      const caseLineage = validateAflTradeValuationCaseLineage(
        chain.valuationCase,
        chain.lineageGraph
      );
      for (const caseIssue of caseLineage.issues) {
        issue(
          'valuation_case_lineage',
          'invalid_case_lineage',
          caseIssue.message,
          caseIssue.assetId
        );
      }
    } catch (error) {
      issue('valuation_case_lineage', 'validation_execution_failed', errorMessage(error));
    }
  }

  if (schemaResults[0][1].success && schemaResults[2][1].success) {
    try {
      const ledgerValidation = validateAflTradeRealizedContributionLedger(
        chain.realizedContributionLedger,
        chain.valuationCase,
        chain.lineageGraph
      );
      for (const ledgerIssue of ledgerValidation.issues) {
        issue(
          'realized_contribution_attribution',
          'invalid_realized_attribution',
          ledgerIssue.message,
          ledgerIssue.contributionRecordId
        );
      }
    } catch (error) {
      issue(
        'realized_contribution_attribution',
        'validation_execution_failed',
        errorMessage(error)
      );
    }
  }

  if (schemaResults[0][1].success && graphValidation.valid) {
    try {
      const rootAssetIds = chain.valuationCase.content.parties.flatMap(
        (party) => party.receivedRootAssetIds
      );
      const current = chain.valuationCase.content.viewContexts.find(
        (view) => view.view === 'current'
      )!;
      const cutoff = {
        effectiveAsOf: current.effectiveAt,
        knowledgeCutoffAt: current.knowledgeCutoffAt,
      };
      const frontier = buildAflTradeAttributionFrontier(
        rootAssetIds,
        chain.lineageGraph.edges,
        cutoff,
        chain.lineageGraph.dispositions
      );
      const attribution = validateAflTradeAttribution(chain.lineageGraph, {
        ...cutoff,
        rootAssetIds,
        creditedAssetIds: frontier,
        excludedAssetIds: [],
      });
      for (const attributionIssue of attribution.issues) {
        issue(
          'terminal_frontier_exactly_once',
          'invalid_terminal_frontier',
          attributionIssue.message,
          attributionIssue.assetId
        );
      }
    } catch (error) {
      issue('terminal_frontier_exactly_once', 'validation_execution_failed', errorMessage(error));
    }
  }

  if (schemaResults.slice(0, 5).every((entry) => entry[1].success)) {
    try {
      const replay = calculateAflTradeValuation(
        chain.valuationCase,
        chain.componentDrawSet,
        chain.realizedContributionLedger,
        chain.packagePolicy
      );
      if (replay.valuationCalculationId !== chain.calculation.valuationCalculationId) {
        issue(
          'calculation_deterministic_replay',
          'calculation_replay_mismatch',
          'The supplied valuation calculation does not match deterministic replay.'
        );
      }
    } catch (error) {
      issue(
        'calculation_deterministic_replay',
        'calculation_replay_mismatch',
        `Calculation replay could not reproduce the supplied chain: ${errorMessage(error)}`
      );
    }
  }

  if (schemaResults[0][1].success && schemaResults[4][1].success && schemaResults[5][1].success) {
    try {
      const firstSnapshot = chain.snapshotSet.content.snapshots[0];
      const replay = createAflTradeValuationSnapshotSet(
        chain.calculation,
        chain.valuationCase,
        firstSnapshot.content.definitions,
        firstSnapshot.content.snapshotCreatedAt
      );
      if (replay.valuationSnapshotSetId !== chain.snapshotSet.valuationSnapshotSetId) {
        issue(
          'snapshot_deterministic_replay',
          'snapshot_replay_mismatch',
          'The supplied snapshot set does not match deterministic replay.'
        );
      }
    } catch (error) {
      issue(
        'snapshot_deterministic_replay',
        'snapshot_replay_mismatch',
        `Snapshot replay could not reproduce the supplied chain: ${errorMessage(error)}`
      );
    }
  }

  if (
    schemaResults[0][1].success &&
    schemaResults[4][1].success &&
    schemaResults[5][1].success &&
    schemaResults[6][1].success
  ) {
    try {
      const replay = createAflTradeStructuredExplanation(
        chain.calculation,
        chain.snapshotSet,
        chain.valuationCase
      );
      if (replay.structuredExplanationId !== chain.explanation.structuredExplanationId) {
        issue(
          'explanation_deterministic_replay',
          'explanation_replay_mismatch',
          'The supplied explanation does not match deterministic fixed-template replay.'
        );
      }
      const parity = validateAflTradeStructuredExplanationParity(
        chain.explanation,
        chain.calculation,
        chain.snapshotSet
      );
      for (const statementId of parity.issueStatementIds) {
        issue(
          'explanation_numerical_parity',
          'explanation_parity_mismatch',
          `Explanation statement ${statementId} does not match its numerical source.`,
          statementId
        );
      }
    } catch (error) {
      issue(
        'explanation_deterministic_replay',
        'explanation_replay_mismatch',
        `Explanation replay could not reproduce the supplied chain: ${errorMessage(error)}`
      );
    }
  }

  const forbiddenPaths = collectForbiddenKeys(chain);
  for (const path of forbiddenPaths) {
    issue(
      'public_asset_ownership_boundary',
      'forbidden_ownership_or_legacy_value_field',
      `Forbidden ownership, fantasy, roster, or legacy-value field at ${path}.`,
      path
    );
  }

  const checks = AFL_TRADE_VALUATION_VALIDATION_CHECKS.map((checkId) => {
    const issueCount = issues.filter((item) => item.checkId === checkId).length;
    return {
      checkId,
      status: issueCount === 0 ? ('passed' as const) : ('failed' as const),
      issueCount,
    };
  });
  return {
    schemaVersion: 'afl-trade-valuation-validation-report/v1',
    structurallyValid: issues.length === 0,
    publicationReady: false,
    checks,
    issues,
    externalBlockers: AFL_TRADE_VALUATION_EXTERNAL_BLOCKERS,
    limitation:
      'Source-independent validation cannot establish lawful source rights, real-data performance, Gate approval, production migration, or release readiness.',
  };
}
