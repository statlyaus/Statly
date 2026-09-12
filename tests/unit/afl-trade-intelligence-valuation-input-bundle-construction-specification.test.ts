import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeValuationInputBundleConstructionSpecification,
  parseAflTradeValuationInputBundleConstructionSpecification,
} from '@/server/aflTradeIntelligence/valuation/valuationInputBundleConstructionSpecification';

const digest = (character: string) => character.repeat(64);
const artifact = (character: string, createdAt = '2026-08-15T01:00:00.000Z') => ({
  artifactId: `artifact:${digest(character)}`,
  contentSha256: digest(character),
  storageUri: `artifact://sha256/${digest(character)}`,
  mediaType: 'application/json',
  byteLength: 128,
  createdAt,
});

function input() {
  return {
    scopeKey: 'afl-men:2025-trades',
    valueUnitId: 'fixed-horizon-pav-v1',
    createdAt: '2026-08-15T02:00:00.000Z',
    currentView: {
      effectiveAt: '2026-08-15T01:45:00.000Z',
      knowledgeCutoffAt: '2026-08-15T01:45:00.000Z',
      valuationAsOf: '2026-08-15T01:50:00.000Z',
    },
    policies: {
      listSpot: artifact('1'),
      scarcity: artifact('2'),
      roleCongestion: artifact('3'),
      lowReturn: artifact('4'),
      eliteOutcome: artifact('5'),
      practicalEquivalence: artifact('6'),
      explanation: artifact('7'),
    },
    simulation: {
      draws: 10_000,
      seed: 'genuine-2025-valuation',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1' as const,
    },
  };
}

describe('AFL trade valuation-input bundle construction specification', () => {
  it('creates a deterministic immutable non-production specification', () => {
    const specification = createAflTradeValuationInputBundleConstructionSpecification(input());

    expect(specification.specificationId).toBe(
      createAflTradeContentAddress(
        'valuation-input-bundle-construction-specification',
        specification.content
      )
    );
    expect(parseAflTradeValuationInputBundleConstructionSpecification(specification)).toEqual(
      specification
    );
  });

  it('rejects a calculation policy artifact created after the specification', () => {
    const late = input();

    expect(() =>
      createAflTradeValuationInputBundleConstructionSpecification({
        ...late,
        policies: {
          ...late.policies,
          explanation: artifact('7', '2026-08-15T02:00:01.000Z'),
        },
      })
    ).toThrow('Every construction policy artifact must exist before specification creation.');
  });

  it('rejects unsupported future temporal context', () => {
    const invalid = input();

    expect(() =>
      createAflTradeValuationInputBundleConstructionSpecification({
        ...invalid,
        currentView: {
          ...invalid.currentView,
          knowledgeCutoffAt: '2026-08-15T01:50:01.000Z',
        },
      })
    ).toThrow('Current effective and knowledge-cutoff times cannot follow valuation time.');
  });
});
