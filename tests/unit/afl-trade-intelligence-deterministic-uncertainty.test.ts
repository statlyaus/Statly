import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_UNCERTAINTY_COMPONENTS,
  aflTradeClusterBootstrapProtocolContentSchema,
  aflTradeClusterBootstrapProtocolSchema,
  aflTradeClusterBootstrapReplicateSchema,
  createAflTradeClusterBootstrapProtocol,
  createAflTradeClusterBootstrapReplicate,
  sampleAflTradeDeterministicBoundedIndex,
  sampleAflTradeDeterministicUnitInterval,
  sampleAflTradeDeterministicWeightedIndex,
  type AflTradeClusterBootstrapProtocolContent,
  type AflTradeDeterministicSampleCoordinate,
} from '@/server/aflTradeIntelligence/modeling/deterministicUncertainty';

function coordinate(
  overrides: Partial<AflTradeDeterministicSampleCoordinate> = {}
): AflTradeDeterministicSampleCoordinate {
  return {
    algorithmVersion: 'counter_sha256_rejection_v1',
    seed: 'fixture-seed',
    stream: 'outcome_distribution',
    streamKey: 'fixture-stream-key',
    counters: [3, 7, 11],
    ...overrides,
  };
}

function protocolContent(): AflTradeClusterBootstrapProtocolContent {
  return {
    schemaVersion: 'afl-trade-cluster-bootstrap-protocol/v1',
    algorithmVersion: 'counter_sha256_rejection_v1',
    seed: 'fixture-bootstrap-seed',
    replicateCount: 100,
    resamplingUnit: 'whole_draft_class',
    preserveClusterCountWithinStratum: true,
    stratificationPolicy: 'declared_pre_prediction_strata',
    targetUncertainty: 'model_estimation',
    separatelyReportedUncertaintyComponents: [
      'model_estimation',
      'outcome_distribution',
      'draft_class_shared_effect',
      'future_ladder_landing',
      'monte_carlo_error',
    ],
    strata: [
      { stratumId: 'modern', draftClassIds: ['class-2020', 'class-2018', 'class-2019'] },
      { stratumId: 'early', draftClassIds: ['class-2001', 'class-2000'] },
    ],
    limitation:
      'Bootstrap replicates estimate model uncertainty only and are not outcome, shared-effect, landing, or Monte Carlo uncertainty.',
  };
}

describe('AFL trade-intelligence deterministic uncertainty primitives', () => {
  it('locks the versioned unit, bounded, and weighted samplers to golden vectors', () => {
    const sampleCoordinate = coordinate();

    expect(sampleAflTradeDeterministicUnitInterval(sampleCoordinate)).toBe(0.44653531439925187);
    expect(sampleAflTradeDeterministicBoundedIndex(sampleCoordinate, 17)).toBe(7);
    expect(sampleAflTradeDeterministicWeightedIndex(sampleCoordinate, [1, 2, 7])).toBe(2);
  });

  it('separates semantic streams and coordinates without mutable generator state', () => {
    const base = sampleAflTradeDeterministicUnitInterval(coordinate());
    const otherStream = sampleAflTradeDeterministicUnitInterval(
      coordinate({ stream: 'future_ladder_landing' })
    );
    const otherKey = sampleAflTradeDeterministicUnitInterval(
      coordinate({ streamKey: 'another-key' })
    );
    const otherCounter = sampleAflTradeDeterministicUnitInterval(
      coordinate({ counters: [3, 7, 12] })
    );

    expect(sampleAflTradeDeterministicUnitInterval(coordinate())).toBe(base);
    expect(new Set([base, otherStream, otherKey, otherCounter])).toHaveLength(4);
    expect(
      [base, otherStream, otherKey, otherCounter].every((value) => value >= 0 && value < 1)
    ).toBe(true);
  });

  it('keeps rejection-sampled bounded draws inside range for awkward bounds', () => {
    const draws = Array.from({ length: 700 }, (_, drawIndex) =>
      sampleAflTradeDeterministicBoundedIndex(coordinate({ counters: [drawIndex] }), 7)
    );

    expect(draws.every((draw) => Number.isInteger(draw) && draw >= 0 && draw < 7)).toBe(true);
    expect(new Set(draws)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(() => sampleAflTradeDeterministicBoundedIndex(coordinate(), 0)).toThrow(/positive/i);
    expect(() =>
      sampleAflTradeDeterministicBoundedIndex(coordinate(), Number.MAX_SAFE_INTEGER)
    ).toThrow(/uint52/i);
  });

  it('handles zero-weight outcomes and rejects invalid weight vectors', () => {
    for (let drawIndex = 0; drawIndex < 20; drawIndex += 1) {
      expect(
        sampleAflTradeDeterministicWeightedIndex(coordinate({ counters: [drawIndex] }), [0, 4, 0])
      ).toBe(1);
    }
    expect(() => sampleAflTradeDeterministicWeightedIndex(coordinate(), [])).toThrow(
      /non-negative weights/i
    );
    expect(() => sampleAflTradeDeterministicWeightedIndex(coordinate(), [0, 0])).toThrow(
      /positive finite total/i
    );
    expect(() => sampleAflTradeDeterministicWeightedIndex(coordinate(), [1, -1])).toThrow(
      /non-negative weights/i
    );
  });

  it('canonicalizes protocol inputs without mutation and binds their content address', () => {
    const content = protocolContent();
    const before = structuredClone(content);
    const forward = createAflTradeClusterBootstrapProtocol(content);
    const reverse = createAflTradeClusterBootstrapProtocol({
      ...content,
      strata: [...content.strata]
        .reverse()
        .map((stratum) => ({ ...stratum, draftClassIds: [...stratum.draftClassIds].reverse() })),
    });

    expect(content).toEqual(before);
    expect(forward).toEqual(reverse);
    expect(forward.bootstrapProtocolId).toMatch(/^cluster-bootstrap-protocol:[a-f0-9]{64}$/);
    expect(forward.content.strata).toEqual([
      { stratumId: 'early', draftClassIds: ['class-2000', 'class-2001'] },
      {
        stratumId: 'modern',
        draftClassIds: ['class-2018', 'class-2019', 'class-2020'],
      },
    ]);
  });

  it('resamples whole draft classes within strata and preserves stratum cluster counts', () => {
    const protocol = createAflTradeClusterBootstrapProtocol(protocolContent());
    const replicate = createAflTradeClusterBootstrapReplicate(protocol, 7);
    const repeated = createAflTradeClusterBootstrapReplicate(protocol, 7);

    expect(replicate).toEqual(repeated);
    expect(replicate.bootstrapReplicateId).toMatch(/^cluster-bootstrap-replicate:[a-f0-9]{64}$/);
    expect(replicate.content).toMatchObject({
      bootstrapProtocolId: protocol.bootstrapProtocolId,
      replicateIndex: 7,
      resamplingUnit: 'whole_draft_class',
      targetUncertainty: 'model_estimation',
    });
    expect(replicate.content.sampledStrata).toEqual([
      {
        stratumId: 'early',
        sourceDraftClassCount: 2,
        sampledDraftClassIds: ['class-2001', 'class-2001'],
      },
      {
        stratumId: 'modern',
        sourceDraftClassCount: 3,
        sampledDraftClassIds: ['class-2018', 'class-2020', 'class-2018'],
      },
    ]);
  });

  it('separates replicate indices and rejects indices outside the declared protocol', () => {
    const protocol = createAflTradeClusterBootstrapProtocol(protocolContent());
    const first = createAflTradeClusterBootstrapReplicate(protocol, 0);
    const second = createAflTradeClusterBootstrapReplicate(protocol, 1);

    expect(first.bootstrapReplicateId).not.toBe(second.bootstrapReplicateId);
    expect(first.content.sampledStrata).not.toEqual(second.content.sampledStrata);
    expect(() => createAflTradeClusterBootstrapReplicate(protocol, -1)).toThrow(/range/i);
    expect(() => createAflTradeClusterBootstrapReplicate(protocol, 100)).toThrow(/range/i);
  });

  it('rejects duplicate clusters, uncertainty conflation, tampering, and ownership fields', () => {
    const content = protocolContent();
    expect(
      aflTradeClusterBootstrapProtocolContentSchema.safeParse({
        ...content,
        strata: [
          { stratumId: 'one', draftClassIds: ['shared-class'] },
          { stratumId: 'two', draftClassIds: ['shared-class'] },
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeClusterBootstrapProtocolContentSchema.safeParse({
        ...content,
        targetUncertainty: 'outcome_distribution',
      }).success
    ).toBe(false);
    expect(AFL_TRADE_UNCERTAINTY_COMPONENTS).toEqual(
      content.separatelyReportedUncertaintyComponents
    );

    const protocol = createAflTradeClusterBootstrapProtocol(content);
    expect(
      aflTradeClusterBootstrapProtocolSchema.safeParse({
        ...protocol,
        content: { ...protocol.content, replicateCount: 99 },
      }).success
    ).toBe(false);
    const replicate = createAflTradeClusterBootstrapReplicate(protocol, 2);
    expect(
      aflTradeClusterBootstrapReplicateSchema.safeParse({
        ...replicate,
        content: {
          ...replicate.content,
          ownerId: 'fantasy-user',
          fantasyLeagueId: 'fantasy-league',
        },
      }).success
    ).toBe(false);
  });
});
