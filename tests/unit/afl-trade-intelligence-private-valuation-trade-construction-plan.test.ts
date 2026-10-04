import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  planPrivateValuationTradeConstruction,
  type PrivateValuationTradeConstructionBinding,
  type PrivateValuationTradeConstructionDerivedInput,
  type PrivateValuationTradeConstructionSuppliedRole,
} from '@/server/aflTradeIntelligence/valuation/internal/privateValuationTradeConstructionPlan';

const at = '2026-09-23T00:00:00.000Z';
const tradeId = 'trade-001';
const sealedCohortTradeIds = [tradeId];

const reference = (label: string) => createAflTradeCanonicalJsonArtifactRef({ label }, at);

const inspected = [reference('inspected-transaction')];

const supplied = (
  role: PrivateValuationTradeConstructionSuppliedRole,
  label: string
): { role: PrivateValuationTradeConstructionSuppliedRole; reference: ReturnType<typeof reference> } => ({
  role,
  reference: reference(label),
});

const allSupplied = [
  supplied('input_trace', 'trace'),
  supplied('explanation_policy', 'explanation-policy'),
  supplied('lineage_graph', 'lineage-graph'),
  supplied('pick_benchmark', 'pick-benchmark'),
  supplied('player_observation', 'player-observation'),
];

const allDerived: PrivateValuationTradeConstructionDerivedInput[] = [
  'valuation_case',
  'component_draw_set',
  'realized_contribution_ledger',
  'package_policy',
];

const allBindings: PrivateValuationTradeConstructionBinding[] = [
  'release_binding',
  'selected_component_authority',
];

const plan = (input: {
  supplied?: ReturnType<typeof supplied>[];
  derived?: PrivateValuationTradeConstructionDerivedInput[];
  bindings?: PrivateValuationTradeConstructionBinding[];
  inspectedEvidenceRefs?: ReturnType<typeof reference>[];
  tradeIds?: string[];
}) =>
  planPrivateValuationTradeConstruction({
    tradeId,
    sealedCohortTradeIds: input.tradeIds ?? sealedCohortTradeIds,
    supplied: input.supplied ?? allSupplied,
    derived: input.derived ?? allDerived,
    bindings: input.bindings ?? allBindings,
    inspectedEvidenceRefs: input.inspectedEvidenceRefs ?? inspected,
  });

describe('planPrivateValuationTradeConstruction', () => {
  it('is ready only when every supplied document and derived input resolved', () => {
    const outcome = plan({});

    expect(outcome.state).toBe('ready');
    if (outcome.state !== 'ready') throw new Error('expected a ready plan');
    // The ready parents are the supplied documents in manifest order; the derived documents are
    // produced by the packager and have no caller-known reference to hand back.
    expect(outcome.parents.map((parent) => parent.role)).toEqual([
      'input_trace',
      'explanation_policy',
      'lineage_graph',
      'pick_benchmark',
      'player_observation',
    ]);
    expect(outcome.parents[0]?.reference.artifactId).toBe(reference('trace').artifactId);
  });

  it('reports every absent supplied document by name with its own code and subject', () => {
    const outcome = plan({ supplied: [supplied('input_trace', 'trace')] });

    expect(outcome.state).toBe('blocked');
    if (outcome.state !== 'blocked') throw new Error('expected a blocked plan');
    // The supplied trace resolved, so it must not be reported; only the four unresolved documents are.
    expect(outcome.blockers).toEqual([
      {
        code: 'policy_unavailable',
        subject: { kind: 'policy', id: 'explanation_policy' },
        evidenceRefs: inspected,
      },
      {
        code: 'lineage_unresolved',
        subject: { kind: 'lineage', id: 'lineage_graph' },
        evidenceRefs: inspected,
      },
      {
        code: 'insufficient_data',
        subject: { kind: 'pick_asset', id: 'pick_benchmark' },
        evidenceRefs: inspected,
      },
      {
        code: 'insufficient_data',
        subject: { kind: 'player_asset', id: 'player_observation' },
        evidenceRefs: inspected,
      },
    ]);
  });

  it('reports each unresolved derived input rather than assuming the packager can invent it', () => {
    const outcome = plan({ derived: ['valuation_case'] });

    expect(outcome.state).toBe('blocked');
    if (outcome.state !== 'blocked') throw new Error('expected a blocked plan');
    expect(outcome.blockers).toEqual([
      {
        code: 'component_output_unavailable',
        subject: { kind: 'model_component', id: 'component_draw_set' },
        evidenceRefs: inspected,
      },
      {
        code: 'insufficient_data',
        subject: { kind: 'model_component', id: 'realized_contribution_ledger' },
        evidenceRefs: inspected,
      },
      {
        code: 'policy_unavailable',
        subject: { kind: 'policy', id: 'package_policy' },
        evidenceRefs: inspected,
      },
    ]);
  });

  it('reports the release and model authority it does not have, not just the documents', () => {
    const outcome = plan({ bindings: [] });

    expect(outcome.state).toBe('blocked');
    if (outcome.state !== 'blocked') throw new Error('expected a blocked plan');
    expect(outcome.blockers).toEqual([
      {
        code: 'insufficient_data',
        subject: { kind: 'source', id: 'release_binding' },
        evidenceRefs: inspected,
      },
      {
        code: 'model_not_approved',
        subject: { kind: 'model_component', id: 'selected_component_authority' },
        evidenceRefs: inspected,
      },
    ]);
  });

  it('refuses a trade the release did not seal into the cohort', () => {
    const outcome = plan({ tradeIds: ['trade-002'] });

    expect(outcome).toEqual({
      state: 'blocked',
      blockers: [
        {
          code: 'unsupported_trade',
          subject: { kind: 'trade', id: tradeId },
          evidenceRefs: inspected,
        },
      ],
    });
  });

  it('refuses to block on evidence it did not inspect', () => {
    expect(() => plan({ inspectedEvidenceRefs: [] })).toThrow(/between one and twenty/);
    expect(() =>
      plan({ inspectedEvidenceRefs: Array.from({ length: 21 }, (_, i) => reference(`e-${i}`)) })
    ).toThrow(/between one and twenty/);
  });

  it('refuses two different retained documents for one role', () => {
    expect(() =>
      plan({
        supplied: [...allSupplied, supplied('input_trace', 'other-trace')],
      })
    ).toThrow(/more than one retained reference/);
  });
});
