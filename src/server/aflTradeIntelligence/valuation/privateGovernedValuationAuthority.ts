import {
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  resolveAflTradeGateEligibility,
  type AflTradeGateDecisionLedger,
  type AflTradeGateEligibilityBlocker,
} from '../governance/gateDecisionLedger';
import type { AflTradeGateDecisionRecord } from '../governance/gateDecisionTypes';
import {
  governedPrivateValuationAuthoritySchema,
  type GovernedPrivateValuationCalculationInput,
} from './governedPrivateValuationCalculationInput';

type GovernedAuthority = GovernedPrivateValuationCalculationInput['content']['authority'];
type BaseAuthority = Omit<GovernedAuthority, 'components' | 'valuationBundle'>;
type ComponentRole = GovernedAuthority['components'][number]['role'];

interface ComponentCandidate {
  readonly role: ComponentRole;
  readonly modelKind: ComponentRole;
  readonly protocolId: string;
  readonly runId: string;
  readonly datasetId: string;
  readonly decisionKey: string;
  readonly runArtifact: AflTradeArtifactRef;
}

interface BundleCandidate {
  readonly bundleId: string;
  readonly decisionKey: string;
  readonly bundleArtifact: AflTradeArtifactRef;
}

interface DecisionArtifact {
  readonly decisionId: string;
  readonly artifact: AflTradeArtifactRef;
}

export interface ResolvePrivateGovernedValuationAuthorityInput {
  readonly baseAuthority: BaseAuthority;
  readonly components: readonly ComponentCandidate[];
  readonly valuationBundle: BundleCandidate;
  readonly gateLedger: AflTradeGateDecisionLedger;
  readonly gateDecisionArtifacts: readonly DecisionArtifact[];
  readonly evaluatedAt: string;
}

export type PrivateGovernedValuationAuthorityBlocker =
  | {
      readonly code: 'component_gate3_unavailable';
      readonly subject: ComponentRole;
      readonly gateBlocker: AflTradeGateEligibilityBlocker['code'];
    }
  | {
      readonly code: 'bundle_gate3_unavailable';
      readonly subject: 'valuation_bundle';
      readonly gateBlocker: AflTradeGateEligibilityBlocker['code'];
    }
  | {
      readonly code: 'gate3_affected_artifact_mismatch';
      readonly subject: ComponentRole | 'valuation_bundle';
      readonly gateBlocker: null;
    }
  | {
      readonly code: 'gate3_decision_artifact_mismatch';
      readonly subject: ComponentRole | 'valuation_bundle';
      readonly gateBlocker: null;
    };

export type PrivateGovernedValuationAuthorityResult =
  | { readonly state: 'ready'; readonly authority: GovernedAuthority }
  | {
      readonly state: 'unavailable';
      readonly blockers: readonly PrivateGovernedValuationAuthorityBlocker[];
    };

function exactAffectedArtifacts(
  decision: AflTradeGateDecisionRecord,
  expected: readonly { kind: string; artifactId: string }[]
): boolean {
  const actual = decision.content.affectedArtifacts
    .map(({ kind, artifactId }) => `${kind}|${artifactId}`)
    .sort();
  const retained = expected.map(({ kind, artifactId }) => `${kind}|${artifactId}`).sort();
  return (
    actual.length === retained.length &&
    actual.every((identity, index) => identity === retained[index])
  );
}

function decisionArtifact(
  decision: AflTradeGateDecisionRecord,
  artifacts: readonly DecisionArtifact[]
): AflTradeArtifactRef | null {
  const matches = artifacts.filter(({ decisionId }) => decisionId === decision.decisionId);
  if (
    matches.length !== 1 ||
    !doesAflTradeArtifactRefMatchCanonicalJson(matches[0]!.artifact, decision)
  ) {
    return null;
  }
  return matches[0]!.artifact;
}

export function resolvePrivateGovernedValuationAuthority(
  input: ResolvePrivateGovernedValuationAuthorityInput
): PrivateGovernedValuationAuthorityResult {
  const blockers: PrivateGovernedValuationAuthorityBlocker[] = [];
  const resolvedComponents: GovernedAuthority['components'][number][] = [];

  for (const component of input.components) {
    const resolution = resolveAflTradeGateEligibility(input.gateLedger, {
      gate: 'gate_3_model_validity',
      decisionKey: component.decisionKey,
      environment: 'non_production',
      evaluatedAt: input.evaluatedAt,
    });
    if (resolution.status !== 'mechanically_eligible' || resolution.decision === null) {
      blockers.push({
        code: 'component_gate3_unavailable',
        subject: component.role,
        gateBlocker: resolution.blockers[0]?.code ?? 'decision_absent',
      });
      continue;
    }
    if (
      !exactAffectedArtifacts(resolution.decision, [
        { kind: 'model_protocol', artifactId: component.protocolId },
        { kind: 'model_run', artifactId: component.runId },
      ])
    ) {
      blockers.push({
        code: 'gate3_affected_artifact_mismatch',
        subject: component.role,
        gateBlocker: null,
      });
      continue;
    }
    const gate3DecisionArtifact = decisionArtifact(
      resolution.decision,
      input.gateDecisionArtifacts
    );
    if (gate3DecisionArtifact === null) {
      blockers.push({
        code: 'gate3_decision_artifact_mismatch',
        subject: component.role,
        gateBlocker: null,
      });
      continue;
    }
    const retainedComponent = {
      protocolId: component.protocolId,
      runId: component.runId,
      datasetId: component.datasetId,
      gate3DecisionId: resolution.decision.decisionId,
      environment: 'non_production' as const,
      outcome: 'succeeded' as const,
      gate3State: 'approved' as const,
      runArtifact: component.runArtifact,
      gate3DecisionArtifact,
      evidenceRefs: [component.runArtifact, gate3DecisionArtifact].sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId)
      ),
    };
    resolvedComponents.push(
      component.role === 'player_contribution_and_availability'
        ? {
            ...retainedComponent,
            role: 'player_contribution_and_availability',
            modelKind: 'player_contribution_and_availability',
          }
        : {
            ...retainedComponent,
            role: 'draft_pick_and_future_pick_distribution',
            modelKind: 'draft_pick_and_future_pick_distribution',
          }
    );
  }

  const bundleResolution = resolveAflTradeGateEligibility(input.gateLedger, {
    gate: 'gate_3_model_validity',
    decisionKey: input.valuationBundle.decisionKey,
    environment: 'non_production',
    evaluatedAt: input.evaluatedAt,
  });
  let resolvedBundle: GovernedAuthority['valuationBundle'] | null = null;
  if (bundleResolution.status !== 'mechanically_eligible' || bundleResolution.decision === null) {
    blockers.push({
      code: 'bundle_gate3_unavailable',
      subject: 'valuation_bundle',
      gateBlocker: bundleResolution.blockers[0]?.code ?? 'decision_absent',
    });
  } else if (
    !exactAffectedArtifacts(bundleResolution.decision, [
      { kind: 'valuation_bundle', artifactId: input.valuationBundle.bundleId },
    ])
  ) {
    blockers.push({
      code: 'gate3_affected_artifact_mismatch',
      subject: 'valuation_bundle',
      gateBlocker: null,
    });
  } else {
    const gate3DecisionArtifact = decisionArtifact(
      bundleResolution.decision,
      input.gateDecisionArtifacts
    );
    if (gate3DecisionArtifact === null) {
      blockers.push({
        code: 'gate3_decision_artifact_mismatch',
        subject: 'valuation_bundle',
        gateBlocker: null,
      });
    } else {
      resolvedBundle = {
        bundleId: input.valuationBundle.bundleId,
        bundleArtifact: input.valuationBundle.bundleArtifact,
        gate3DecisionId: bundleResolution.decision.decisionId,
        gate3DecisionArtifact,
        environment: 'non_production',
        gate3State: 'approved',
        evidenceRefs: [input.valuationBundle.bundleArtifact, gate3DecisionArtifact].sort(
          (left, right) => left.artifactId.localeCompare(right.artifactId)
        ),
      };
    }
  }

  if (blockers.length > 0 || resolvedBundle === null) {
    return { state: 'unavailable', blockers };
  }
  return {
    state: 'ready',
    authority: governedPrivateValuationAuthoritySchema.parse({
      ...input.baseAuthority,
      components: resolvedComponents,
      valuationBundle: resolvedBundle,
    }),
  };
}
