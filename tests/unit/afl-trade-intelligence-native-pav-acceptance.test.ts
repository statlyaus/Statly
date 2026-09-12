import { describe, expect, it } from 'vitest';
import {
  assessAflTradeNativePavAcceptance,
  createAflTradeNativePavAcceptanceCriteria,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavAcceptance';

const input = () => ({
  schemaVersion: 'afl-trade-native-pav-acceptance-input/v1' as const,
  cumulativeCrps: { candidate: 9, baseline: 10 },
  horizons: ['annual_1', 'annual_2', 'annual_3', 'cumulative_3'].map((horizon) => ({
    horizon,
    coverage: 0.8 as number | null,
    mae: { candidate: 9, baseline: 10 },
  })),
  precision: null,
});

const supported = () => ({
  ...input(),
  precision: {
    jointConfidence: 0.95,
    scope: 'simultaneous_all_nine_criteria',
    methodReference: 'artifact:' + 'a'.repeat(64),
    improvement: { lower: 0.05, upper: 0.15 },
    horizons: input().horizons.map((row) => ({
      horizon: row.horizon,
      coverage: { lower: 0.75, upper: 0.85 },
      maeRatio: { lower: 0.8, upper: 1.05 },
    })),
  },
});

describe('native PAV numerical acceptance', () => {
  it('accepts inclusive numerical bounds without granting qualification', () => {
    const result = assessAflTradeNativePavAcceptance(supported());
    expect(result.status).toBe('pass');
    expect(result.qualificationGranted).toBe(false);
  });

  it('keeps good point scores inconclusive when simultaneous precision is unestablished', () => {
    const result = assessAflTradeNativePavAcceptance(input());
    expect(result.status).toBe('inconclusive');
    expect(result.criteria).toHaveLength(9);
    expect(result.criteria.every((criterion) => criterion.status === 'inconclusive')).toBe(true);
    expect(result.qualificationGranted).toBe(false);
  });
  it('does not pass a point improvement below 5% even with favorable supplied bounds', () => {
    const evidence = supported();
    evidence.cumulativeCrps.candidate = 9.9;
    expect(assessAflTradeNativePavAcceptance(evidence).status).toBe('inconclusive');
  });

  it('keeps overlapping uncertainty inconclusive and reports exact reasons', () => {
    const evidence = supported();
    evidence.precision.improvement.lower = 0.04;
    const result = assessAflTradeNativePavAcceptance(evidence);
    expect(result.status).toBe('inconclusive');
    expect(result.criteria[0]).toMatchObject({ reason: 'overlaps_tolerance' });
  });

  it('reports a supported failure even when other required precision is missing', () => {
    const evidence = supported();
    evidence.precision.improvement = { lower: -0.1, upper: 0.04 };
    evidence.horizons[0].coverage = null;
    const result = assessAflTradeNativePavAcceptance(evidence);
    expect(result.status).toBe('fail');
    expect(result.criteria[0]).toMatchObject({ status: 'fail', reason: 'outside_tolerance' });
    expect(result.criteria[1]).toMatchObject({
      status: 'inconclusive',
      reason: 'score_unavailable',
    });
  });

  it('does not replace zero reference errors with epsilon', () => {
    const evidence = supported();
    evidence.cumulativeCrps = { candidate: 0, baseline: 0 };
    evidence.horizons[0].mae = { candidate: 0, baseline: 0 };
    const result = assessAflTradeNativePavAcceptance(evidence);
    expect(result.status).toBe('inconclusive');
    expect(result.criteria[0]).toMatchObject({ estimate: null, reason: 'zero_reference' });
    expect(result.criteria[2]).toMatchObject({ estimate: null, reason: 'zero_reference' });
  });

  it('rejects nonfinite arithmetic rather than producing a report', () => {
    const evidence = supported();
    evidence.cumulativeCrps = { candidate: Number.MAX_VALUE, baseline: Number.MIN_VALUE };
    expect(() => assessAflTradeNativePavAcceptance(evidence)).toThrow(/finite/);
  });

  it('rejects wrong confidence scope, reversed intervals, duplicate horizons and negative scores', () => {
    const wrongScope = supported();
    wrongScope.precision.scope = 'marginal';
    const reversed = supported();
    reversed.precision.improvement = { lower: 0.2, upper: 0.1 };
    const duplicate = supported();
    duplicate.horizons[1].horizon = 'annual_1';
    const negative = supported();
    negative.cumulativeCrps.candidate = -1;
    for (const evidence of [wrongScope, reversed, duplicate, negative])
      expect(() => assessAflTradeNativePavAcceptance(evidence)).toThrow();
  });

  it('replays exact criteria and numerical results without mutation', () => {
    const evidence = supported();
    const original = structuredClone(evidence);
    expect(assessAflTradeNativePavAcceptance(evidence)).toEqual(
      assessAflTradeNativePavAcceptance(original)
    );
    expect(evidence).toEqual(original);
    expect(createAflTradeNativePavAcceptanceCriteria()).toEqual(
      createAflTradeNativePavAcceptanceCriteria()
    );
  });
  it('accepts exactly 5% improvement at small scales without accepting a material shortfall', () => {
    const evidence = supported();
    evidence.cumulativeCrps = { candidate: 0.0285, baseline: 0.03 };
    expect(assessAflTradeNativePavAcceptance(evidence).status).toBe('pass');
    evidence.cumulativeCrps.candidate = 0.02850003;
    expect(assessAflTradeNativePavAcceptance(evidence).status).toBe('inconclusive');
  });

  it('retains original zero-reference scores without hiding a nonzero candidate error', () => {
    const evidence = supported();
    evidence.cumulativeCrps = { candidate: 100, baseline: 0 };
    evidence.horizons[0].mae = { candidate: 50, baseline: 0 };
    const result = assessAflTradeNativePavAcceptance(evidence);
    expect(result.criteria[0]).toMatchObject({ rawScores: { candidate: 100, baseline: 0 } });
    expect(result.criteria[2]).toMatchObject({ rawScores: { candidate: 50, baseline: 0 } });
  });
});
