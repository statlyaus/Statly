import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createGovernedPrivateEvaluationInputTrace } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationInputTrace';
import { constructAflTradeAuthenticatedCurrentValuationTrade } from '@/server/aflTradeIntelligence/valuation/authenticatedCurrentValuationTradeConstruction';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

const CREATED_AT = '2026-09-05T01:00:00.000Z';

function retained<T>(value: T) {
  return {
    value,
    reference: createAflTradeCanonicalJsonArtifactRef(value, CREATED_AT),
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
  };
}

function readyInput() {
  const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
  return {
    fixture,
    input: {
      state: 'ready' as const,
      createdAt: CREATED_AT,
      factualReleaseId: fixture.trace.content.factualReleaseId,
      valuationInputBundleId: fixture.trace.content.valuationInputBundleId,
      components: structuredClone(fixture.trace.content.components),
      trace: retained(fixture.trace),
      explanationPolicy: retained(fixture.explanationPolicy),
      valuationCase: fixture.calculationInputPackage.content.valuationCase,
      componentDrawSet: fixture.calculationInputPackage.content.componentDrawSet,
      realizedContributionLedger:
        fixture.calculationInputPackage.content.realizedContributionLedger,
      packagePolicy: fixture.calculationInputPackage.content.packagePolicy,
      lineageGraph: retained(fixture.lineageGraph),
      pickBenchmarks: fixture.pickBenchmarks.map(retained),
      playerObservations: [],
    },
  };
}

describe('authenticated current valuation trade construction', () => {
  it('packages existing authenticated evidence into deterministic retained ancestry', () => {
    const { fixture, input } = readyInput();

    const first = constructAflTradeAuthenticatedCurrentValuationTrade(input);
    const replay = constructAflTradeAuthenticatedCurrentValuationTrade(input);

    expect(first).toEqual(replay);
    expect(first.state).toBe('ready');
    if (first.state !== 'ready') return;
    expect(first.manifest.content.selector).toEqual(fixture.trace.content.selector);
    expect(first.retainedParents).toHaveLength(5);
    expect(first.retainedParents.map(({ reference }) => reference.artifactId)).toEqual(
      [...first.retainedParents]
        .map(({ reference }) => reference.artifactId)
        .sort((left, right) => left.localeCompare(right))
    );
    expect(
      first.retainedParents.every(({ reference, bytes }) =>
        doesAflTradeArtifactRefMatchBytes(reference, bytes, 'application/json')
      )
    ).toBe(true);
  });

  it('preserves authenticated blockers without constructing artifacts', () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const blocker = {
      code: 'component_output_unavailable' as const,
      subject: { kind: 'model_component' as const, id: 'player-pav-forecast' },
      evidenceRefs: [fixture.materializationManifest.content.calculationInputArtifact],
    };

    expect(
      constructAflTradeAuthenticatedCurrentValuationTrade({
        state: 'blocked',
        blockers: [blocker],
      })
    ).toEqual({ state: 'blocked', blockers: [blocker] });
  });

  it('rejects evidence that does not match selected component authority', () => {
    const { input } = readyInput();

    expect(() =>
      constructAflTradeAuthenticatedCurrentValuationTrade({
        ...input,
        components: input.components.map((component) => ({
          ...component,
          runId:
            component.role === 'player_contribution_and_availability'
              ? `model-run:${'f'.repeat(64)}`
              : component.runId,
        })),
      })
    ).toThrow('selected release, bundle, or component authority');
  });

  it('rejects duplicate component authority and forged retained bytes', () => {
    const { input } = readyInput();
    expect(() =>
      constructAflTradeAuthenticatedCurrentValuationTrade({
        ...input,
        components: [...input.components, input.components[0]!],
      })
    ).toThrow('selected release, bundle, or component authority');

    expect(() =>
      constructAflTradeAuthenticatedCurrentValuationTrade({
        ...input,
        trace: { ...input.trace, bytes: new TextEncoder().encode('{}') },
      })
    ).toThrow('exact retained evidence');
  });

  it('does not expose retained ancestry through caller-owned mutable bytes', () => {
    const { input } = readyInput();
    const constructed = constructAflTradeAuthenticatedCurrentValuationTrade(input);
    expect(constructed.state).toBe('ready');
    if (constructed.state !== 'ready') return;
    input.trace.bytes.fill(0);
    input.trace.reference.contentSha256 = '0'.repeat(64);

    expect(
      constructed.retainedParents.every(({ reference, bytes }) =>
        doesAflTradeArtifactRefMatchBytes(reference, bytes, 'application/json')
      )
    ).toBe(true);
  });

  it.each([
    ['protocolId', 'model-protocol'],
    ['datasetId', 'dataset'],
    ['datasetAdmissionId', 'dataset-admission'],
    ['gate3DecisionId', 'gate-decision'],
  ] as const)('rejects substituted %s while preserving selected run IDs', (field, prefix) => {
    const { input } = readyInput();
    const changed = structuredClone(input.trace.value.content);
    changed.components[0]![field] = `${prefix}:${'f'.repeat(64)}`;
    expect(() =>
      constructAflTradeAuthenticatedCurrentValuationTrade({
        ...input,
        trace: retained(createGovernedPrivateEvaluationInputTrace(changed)),
      })
    ).toThrow();
  });

  it.each(['runManifest', 'protocol', 'datasetAdmission', 'gate3Decision'] as const)(
    'rejects substituted %s artifact references even when all component IDs match',
    (field) => {
      const { input } = readyInput();
      const changed = structuredClone(input.trace.value.content);
      changed.components[0]!.evidence[field] = createAflTradeCanonicalJsonArtifactRef(
        { substituted: field },
        changed.derivedAt
      );
      expect(() =>
        constructAflTradeAuthenticatedCurrentValuationTrade({
          ...input,
          trace: retained(createGovernedPrivateEvaluationInputTrace(changed)),
        })
      ).toThrow('selected release, bundle, or component authority');
    }
  );

  it('rejects empty, duplicate, and oversized blocker collections', () => {
    const { input } = readyInput();
    const blocker = {
      code: 'component_output_unavailable' as const,
      subject: { kind: 'model_component' as const, id: 'player-forecast' },
      evidenceRefs: [input.trace.reference],
    };
    for (const blockers of [
      [],
      [blocker, blocker],
      Array.from({ length: 101 }, (_, index) => ({
        ...blocker,
        subject: { ...blocker.subject, id: `component-${index}` },
      })),
    ]) {
      expect(() =>
        constructAflTradeAuthenticatedCurrentValuationTrade({
          state: 'blocked',
          blockers,
        })
      ).toThrow();
    }
  });

  it('orders valid blockers using the shared prepared-input contract', () => {
    const { input } = readyInput();
    const blockers = ['z-player', 'A-player', 'a-player'].map((id) => ({
      code: 'component_output_unavailable' as const,
      subject: { kind: 'model_component' as const, id },
      evidenceRefs: [input.trace.reference],
    }));
    const result = constructAflTradeAuthenticatedCurrentValuationTrade({
      state: 'blocked',
      blockers,
    });
    expect(result.state).toBe('blocked');
    if (result.state !== 'blocked') return;
    expect(result.blockers.map(({ subject }) => subject.id)).toEqual([
      'A-player',
      'a-player',
      'z-player',
    ]);
  });
});
