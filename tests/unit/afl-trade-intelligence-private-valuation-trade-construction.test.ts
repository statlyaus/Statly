import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  assemblePrivateValuationTradeConstruction,
  type PrivateValuationTradeConstructor,
  type PrivateValuationTradeConstructionOutcome,
  type PrivateValuationTradeResolvedEvidence,
} from '@/server/aflTradeIntelligence/valuation/internal/privateValuationTradeConstruction';

const at = '2026-09-23T00:00:00.000Z';
const tradeId = 'trade-001';

type ComponentAuthority = PrivateValuationTradeResolvedEvidence['components'][number];
type Compatibility = Parameters<PrivateValuationTradeConstructor>[1];

function retained<T>(label: string, value: T) {
  return {
    value,
    reference: createAflTradeCanonicalJsonArtifactRef({ label }, at),
    bytes: new TextEncoder().encode(JSON.stringify({ label })),
  };
}

/**
 * The construction boundary validates these documents deeply. These stand-ins only carry identity,
 * because the assembler's contract is *which* resolved evidence it passes, not what the document
 * contains; deep validation is covered by the boundary's own tests.
 */
const document = <T>(label: string) => retained(label, {} as T);

const component = (role: ComponentAuthority['role']): ComponentAuthority =>
  ({ role, runId: `${role}-run` }) as unknown as ComponentAuthority;

const inspectedEvidenceRefs = [createAflTradeCanonicalJsonArtifactRef({ label: 'transaction' }, at)];

const compatibility = {
  environment: 'non_production',
  policyReference: createAflTradeCanonicalJsonArtifactRef({ label: 'policy' }, at),
  repository: {},
} as unknown as Compatibility;

const emptyEvidence: PrivateValuationTradeResolvedEvidence = {
  createdAt: null,
  factualReleaseId: null,
  valuationInputBundleId: null,
  components: [],
  trace: null,
  explanationPolicy: null,
  valuationCase: null,
  componentDrawSet: null,
  realizedContributionLedger: null,
  packagePolicy: null,
  lineageGraph: null,
  pickBenchmarks: [],
  playerObservations: [],
};

function fullEvidence(
  overrides: Partial<PrivateValuationTradeResolvedEvidence> = {}
): PrivateValuationTradeResolvedEvidence {
  return {
    ...emptyEvidence,
    createdAt: at,
    factualReleaseId: 'outcome-release-1',
    valuationInputBundleId: 'valuation-input-bundle-1',
    components: [
      component('player_contribution_and_availability'),
      component('draft_pick_and_future_pick_distribution'),
    ],
    trace: document('trace'),
    explanationPolicy: document('explanation-policy'),
    valuationCase: document('valuation-case'),
    componentDrawSet: document('draw-set'),
    realizedContributionLedger: document('ledger'),
    packagePolicy: document('package-policy'),
    lineageGraph: document('lineage-graph'),
    pickBenchmarks: [document('benchmark')],
    playerObservations: [document('observation')],
    ...overrides,
  };
}

/** Records what the construction boundary was handed, and returns a sentinel unchanged. */
function boundary(sentinel: PrivateValuationTradeConstructionOutcome) {
  const calls: Parameters<PrivateValuationTradeConstructor>[] = [];
  const construct: PrivateValuationTradeConstructor = async (input, request) => {
    calls.push([input, request]);
    return sentinel;
  };
  return { construct, calls };
}

// A boundary that must not be reached when the plan refuses the trade.
const unreachable: PrivateValuationTradeConstructor = async () => {
  throw new Error('Trade construction boundary must not be called for an unplannable trade.');
};

const assemble = (input: {
  evidence: PrivateValuationTradeResolvedEvidence;
  construct?: PrivateValuationTradeConstructor;
  tradeId?: string;
}) =>
  assemblePrivateValuationTradeConstruction({
    tradeId: input.tradeId ?? tradeId,
    sealedCohortTradeIds: [tradeId],
    inspectedEvidenceRefs,
    evidence: input.evidence,
    compatibility,
    construct: input.construct ?? unreachable,
  });

describe('assemblePrivateValuationTradeConstruction', () => {
  it('names every unresolved document instead of constructing a partly-evidenced trade', async () => {
    const outcome = await assemble({ evidence: emptyEvidence });

    expect(outcome.state).toBe('blocked');
    if (outcome.state !== 'blocked') throw new Error('expected a blocked outcome');
    expect(outcome.blockers.map((blocker) => blocker.subject.id)).toEqual([
      'input_trace',
      'explanation_policy',
      'lineage_graph',
      'pick_benchmark',
      'player_observation',
      'valuation_case',
      'component_draw_set',
      'realized_contribution_ledger',
      'package_policy',
      'release_binding',
      'selected_component_authority',
    ]);
  });

  it('refuses a trade the release did not seal, before it asks for any document', async () => {
    const outcome = await assemble({ evidence: emptyEvidence, tradeId: 'trade-999' });

    expect(outcome).toEqual({
      state: 'blocked',
      blockers: [
        {
          code: 'unsupported_trade',
          subject: { kind: 'trade', id: 'trade-999' },
          evidenceRefs: inspectedEvidenceRefs,
        },
      ],
    });
  });

  it('refuses a component draw that is not the release’s two selected runs', async () => {
    const evidence = fullEvidence({
      components: [component('player_contribution_and_availability')],
    });

    const outcome = await assemble({ evidence });

    expect(outcome.state).toBe('blocked');
    if (outcome.state !== 'blocked') throw new Error('expected a blocked outcome');
    expect(outcome.blockers).toEqual([
      {
        code: 'model_not_approved',
        subject: { kind: 'model_component', id: 'selected_component_authority' },
        evidenceRefs: inspectedEvidenceRefs,
      },
    ]);
  });

  it('hands the boundary exactly the evidence the plan approved and returns its outcome', async () => {
    const evidence = fullEvidence();
    const sentinel: PrivateValuationTradeConstructionOutcome = { state: 'blocked', blockers: [] };
    const { construct, calls } = boundary(sentinel);

    const outcome = await assemble({ evidence, construct });

    expect(outcome).toBe(sentinel);
    expect(calls).toHaveLength(1);
    const [assembly, request] = calls[0]!;
    expect(request).toBe(compatibility);
    if (assembly.state !== 'ready') throw new Error('expected a ready assembly');
    expect(assembly.createdAt).toBe(at);
    expect(assembly.factualReleaseId).toBe('outcome-release-1');
    expect(assembly.valuationInputBundleId).toBe('valuation-input-bundle-1');
    expect(assembly.components).toBe(evidence.components);
    // Retained evidence passes through with its reference and bytes intact, never re-serialised.
    expect(assembly.trace).toBe(evidence.trace);
    expect(assembly.explanationPolicy).toBe(evidence.explanationPolicy);
    expect(assembly.lineageGraph).toBe(evidence.lineageGraph);
    expect(assembly.pickBenchmarks).toBe(evidence.pickBenchmarks);
    expect(assembly.playerObservations).toBe(evidence.playerObservations);
    expect(assembly.valuationCase).toBe(evidence.valuationCase);
    expect(assembly.componentDrawSet).toBe(evidence.componentDrawSet);
    expect(assembly.realizedContributionLedger).toBe(evidence.realizedContributionLedger);
    expect(assembly.packagePolicy).toBe(evidence.packagePolicy);
  });
});
