/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
  aflTradeJointOutcomeValueQuantizationPolicySchema,
  quantizeAflTradeJointOutcomeValue,
  type AflTradeJointOutcomeValueQuantizationPolicy,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeValueQuantization';

function policy(decimalPlaces: number): AflTradeJointOutcomeValueQuantizationPolicy {
  return {
    definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
    decimalPlaces,
  };
}

describe('AFL trade joint-outcome value quantization policy', () => {
  it('accepts the governed policy at both precision limits', () => {
    expect(aflTradeJointOutcomeValueQuantizationPolicySchema.parse(policy(0))).toEqual(policy(0));
    expect(aflTradeJointOutcomeValueQuantizationPolicySchema.parse(policy(9))).toEqual(policy(9));
  });

  it.each([
    { ...policy(2), extra: true },
    { ...policy(2), definitionVersion: 'unapproved-rounding/v2' },
    policy(-1),
    policy(10),
    policy(1.5),
  ])('rejects a non-contract policy %#', (candidate) => {
    expect(aflTradeJointOutcomeValueQuantizationPolicySchema.safeParse(candidate).success).toBe(
      false
    );
  });
});

describe('quantizeAflTradeJointOutcomeValue', () => {
  it.each([
    [12, 0, 12],
    [12, 2, 1_200],
    [12.34, 2, 1_234],
    [-12.34, 2, -1_234],
    [0, 9, 0],
    [-0, 9, 0],
    [0.0049, 2, 0],
    [-0.0049, 2, 0],
  ])('quantizes %d at %i decimal places to %i quanta', (value, decimals, expected) => {
    expect(quantizeAflTradeJointOutcomeValue(value, policy(decimals))).toBe(expected);
  });

  it.each([
    [1.005, 2, 101],
    [-1.005, 2, -101],
    [2.675, 2, 268],
    [-2.675, 2, -268],
    [0.5, 0, 1],
    [-0.5, 0, -1],
    [1.0049, 2, 100],
    [-1.0049, 2, -100],
  ])('uses decimal half-away-from-zero rounding for %d', (value, decimals, expected) => {
    expect(quantizeAflTradeJointOutcomeValue(value, policy(decimals))).toBe(expected);
  });

  it.each([
    [1e-7, 9, 100],
    [-1e-7, 9, -100],
    [1.234e5, 2, 12_340_000],
    [-1.234e5, 2, -12_340_000],
    [5e-10, 9, 1],
    [-5e-10, 9, -1],
  ])('supports canonical scientific notation for %d', (value, decimals, expected) => {
    expect(quantizeAflTradeJointOutcomeValue(value, policy(decimals))).toBe(expected);
  });

  it('accepts both safe-integer limits', () => {
    expect(quantizeAflTradeJointOutcomeValue(Number.MAX_SAFE_INTEGER, policy(0))).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(quantizeAflTradeJointOutcomeValue(Number.MIN_SAFE_INTEGER, policy(0))).toBe(
      Number.MIN_SAFE_INTEGER
    );
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ])('fails closed when %d cannot be represented as safe-integer quanta', (value) => {
    expect(() => quantizeAflTradeJointOutcomeValue(value, policy(0))).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite input %s',
    (value) => {
      expect(() => quantizeAflTradeJointOutcomeValue(value, policy(2))).toThrow();
    }
  );

  it('is deterministic and does not mutate a frozen policy', () => {
    const frozenPolicy = Object.freeze(policy(6));
    const outputs = Array.from({ length: 100 }, () =>
      quantizeAflTradeJointOutcomeValue(-123.4567895, frozenPolicy)
    );

    expect(new Set(outputs)).toEqual(new Set([-123_456_790]));
    expect(frozenPolicy).toEqual(policy(6));
  });
});
