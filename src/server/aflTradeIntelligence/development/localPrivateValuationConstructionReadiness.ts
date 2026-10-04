import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  assessAflTradeConstructionCompatibility,
  type AflTradeConstructionCompatibilityIssue,
} from '../valuation/constructionCompatibility';
import { aflTradeValuationCalculationInputPackageSchema } from '../valuation/valuationCalculationInputPackage';

/** Matches the ceiling the compatibility assessment loads its own evidence with. */
const maximumArtifactBytes = 2_000_000;

export type LocalPrivateValuationConstructionAssessmentState =
  'compatible' | 'incompatible' | 'unavailable' | 'not_attempted';

export interface LocalPrivateValuationConstructionReadinessReport {
  readonly schemaVersion: 'afl-private-valuation-construction-readiness/v1';
  readonly state: 'assessed' | 'not_assessable';
  readonly assessmentState: LocalPrivateValuationConstructionAssessmentState;
  readonly qualificationGranted: false;
  readonly policyArtifactId: string;
  /** Every `${assetId}/${view}` the selected case and policy require, so coverage cannot shrink silently. */
  readonly requiredViewKeys: readonly string[];
  readonly issues: readonly AflTradeConstructionCompatibilityIssue[];
  readonly blockerCodes: readonly string[];
}

function report(input: {
  readonly policyArtifactId: string;
  readonly state: 'assessed' | 'not_assessable';
  readonly assessmentState: LocalPrivateValuationConstructionAssessmentState;
  readonly requiredViewKeys: readonly string[];
  readonly issues: readonly AflTradeConstructionCompatibilityIssue[];
  readonly blockerCodes: readonly string[];
}): LocalPrivateValuationConstructionReadinessReport {
  return {
    schemaVersion: 'afl-private-valuation-construction-readiness/v1',
    state: input.state,
    assessmentState: input.assessmentState,
    qualificationGranted: false,
    policyArtifactId: input.policyArtifactId,
    requiredViewKeys: input.requiredViewKeys,
    issues: input.issues,
    blockerCodes: [...new Set(input.blockerCodes)].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Reports whether the selected construction inputs could compose, naming each blocked asset and view.
 *
 * Read-only and qualification-free: it loads retained artifacts, runs the existing compatibility
 * assessment, and returns a stable report. Coverage follows the valuation case and the policy
 * artifact, so a new asset or view is a policy change rather than a code change. Absent inputs yield
 * `not_assessable` with named reasons instead of a silent pass. The local preflight and the local
 * valuation worker both consume this, so a genuine dispatch fails with the same precise reasons.
 */
export async function inspectLocalPrivateValuationConstructionReadiness(options: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly environment: 'test_fixture' | 'non_production';
  readonly assessedAt: string;
  readonly selection: {
    readonly calculationInputPackage: AflTradeArtifactRef;
    readonly policy: AflTradeArtifactRef;
    readonly runs: { readonly player: string; readonly pick: string };
  };
}): Promise<LocalPrivateValuationConstructionReadinessReport> {
  const policyReference = aflTradeArtifactRefSchema.parse(options.selection.policy);
  const packageReference = aflTradeArtifactRefSchema.parse(
    options.selection.calculationInputPackage
  );
  const loaded = await options.repository.loadExact(packageReference, maximumArtifactBytes);
  if (!loaded) {
    return report({
      policyArtifactId: policyReference.artifactId,
      state: 'not_assessable',
      assessmentState: 'not_attempted',
      requiredViewKeys: [],
      issues: [],
      blockerCodes: ['calculation_input_package_missing'],
    });
  }
  if (!doesAflTradeArtifactRefMatchBytes(packageReference, loaded.bytes, 'application/json')) {
    throw new TypeError('Retained calculation input package does not match its exact reference.');
  }
  const packageContent = aflTradeValuationCalculationInputPackageSchema.parse(
    JSON.parse(new TextDecoder().decode(loaded.bytes)) as unknown
  ).content;
  if (!('valuationCase' in packageContent) || !('componentDrawSet' in packageContent)) {
    return report({
      policyArtifactId: policyReference.artifactId,
      state: 'not_assessable',
      assessmentState: 'not_attempted',
      requiredViewKeys: [],
      issues: [],
      blockerCodes: ['calculation_input_package_unsupported'],
    });
  }
  const valuationCase = packageContent.valuationCase;
  const requiredViewKeys = [
    ...new Set(
      valuationCase.content.parties.flatMap((party) =>
        party.receivedRootAssetIds.flatMap((assetId) =>
          valuationCase.content.viewContexts.map(({ view }) => `${assetId}/${view}`)
        )
      )
    ),
  ].sort((a, b) => a.localeCompare(b));
  const assessment = await assessAflTradeConstructionCompatibility({
    environment: options.environment,
    assessedAt: options.assessedAt,
    valuationCase,
    componentDrawSet: packageContent.componentDrawSet,
    policyReference,
    selectedRuns: options.selection.runs,
    repository: options.repository,
  });
  if (assessment.state === 'unavailable') {
    return report({
      policyArtifactId: policyReference.artifactId,
      state: 'assessed',
      assessmentState: 'unavailable',
      requiredViewKeys,
      issues: [],
      blockerCodes: [assessment.reason],
    });
  }
  return report({
    policyArtifactId: policyReference.artifactId,
    state: 'assessed',
    assessmentState: assessment.state,
    requiredViewKeys,
    issues: assessment.issues,
    blockerCodes: assessment.issues.map((issue) => issue.reason),
  });
}
