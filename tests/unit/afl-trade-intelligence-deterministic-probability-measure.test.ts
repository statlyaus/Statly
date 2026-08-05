// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_PROBABILITY_MEASURE_ERROR_CODES,
  AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE,
  addAflTradeCompensatedTerm,
  AflTradeProbabilityMeasureError,
  canonicalizeAflTradeZero,
  compareAflTradeCodeUnits,
  createAflTradeCompensatedAccumulator,
  doAflTradeProbabilityMassesReconcile,
  isAflTradeProbabilityMeasureError,
  isAflTradeUnitProbabilityMass,
  normalizeAflTradeProbabilityMass,
  readAflTradeCompensatedValue,
  requireAflTradeUnitProbabilityMass,
  sumAflTradeFiniteNumbers,
  type AflTradeProbabilityMeasureErrorCode,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';

function expectErrorCode(
  operation: () => unknown,
  expectedCode: AflTradeProbabilityMeasureErrorCode
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeProbabilityMeasureError);
    expect((error as AflTradeProbabilityMeasureError).code).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected probability-measure error ${expectedCode}.`);
}

describe('deterministic AFL trade probability-measure contract', () => {
  it('pins its definition, tolerance, error codes, and typed error identity', () => {
    expect(AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION).toBe(
      'binary64_code_unit_ordered_neumaier_actual_total_normalization_v1'
    );
    expect(AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE).toBe(1e-8);
    expect(AFL_TRADE_PROBABILITY_MEASURE_ERROR_CODES).toEqual([
      'NON_FINITE_TERM',
      'NON_FINITE_DERIVATION',
      'INVALID_TOTAL_MASS',
      'INVALID_PROBABILITY_MASS',
    ]);

    const error = new AflTradeProbabilityMeasureError('INVALID_TOTAL_MASS', 'fixture');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AflTradeProbabilityMeasureError);
    expect(error.name).toBe('AflTradeProbabilityMeasureError');
    expect(error.code).toBe('INVALID_TOTAL_MASS');
  });

  it('recognizes only privately branded errors without inspecting hostile prototypes', () => {
    const genuine = new AflTradeProbabilityMeasureError('INVALID_TOTAL_MASS', 'fixture');
    const prototypeSpoof = Object.create(AflTradeProbabilityMeasureError.prototype);
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('secret-prototype-trap');
        },
      }
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(isAflTradeProbabilityMeasureError(genuine)).toBe(true);
    expect(isAflTradeProbabilityMeasureError({})).toBe(false);
    expect(isAflTradeProbabilityMeasureError(prototypeSpoof)).toBe(false);
    expect(isAflTradeProbabilityMeasureError(throwingPrototype)).toBe(false);
    expect(isAflTradeProbabilityMeasureError(revocable.proxy)).toBe(false);
  });

  it('uses locale-independent code-unit ordering', () => {
    const identifiers = ['club-a', 'club-2', 'club-A', 'club-10'];
    expect([...identifiers].sort(compareAflTradeCodeUnits)).toEqual([
      'club-10',
      'club-2',
      'club-A',
      'club-a',
    ]);
    expect(compareAflTradeCodeUnits('club-a', 'club-a')).toBe(0);
    expect(compareAflTradeCodeUnits('club-a', 'club-A')).toBeGreaterThan(0);
    expect(compareAflTradeCodeUnits('club-A', 'club-a')).toBeLessThan(0);
  });

  it('makes keyed accumulation deterministic when callers first use canonical ordering', () => {
    const keyedTerms = [
      { key: 'draw-b', value: 0.2 },
      { key: 'draw-A', value: 0.3 },
      { key: 'draw-a', value: 0.4 },
      { key: 'draw-10', value: 0.1 },
    ];
    const canonicalTerms = [...keyedTerms]
      .sort((left, right) => compareAflTradeCodeUnits(left.key, right.key))
      .map((term) => term.value);

    const first = sumAflTradeFiniteNumbers(canonicalTerms);
    const repeated = sumAflTradeFiniteNumbers(canonicalTerms);
    expect(repeated).toBe(first);
    expect(first).toBe(1);
    expect(keyedTerms.map((term) => term.key)).toEqual(['draw-b', 'draw-A', 'draw-a', 'draw-10']);
  });
});

describe('deterministic AFL trade compensated arithmetic', () => {
  it('retains a cancellation-sensitive term that naive summation loses', () => {
    const terms = [1e16, 1, -1e16];
    const naive = terms.reduce((sum, value) => sum + value, 0);
    const accumulator = createAflTradeCompensatedAccumulator();
    terms.forEach((value) => addAflTradeCompensatedTerm(accumulator, value));

    expect(naive).toBe(0);
    expect(readAflTradeCompensatedValue(accumulator)).toBe(1);
    expect(sumAflTradeFiniteNumbers(terms)).toBe(1);
    expect(terms).toEqual([1e16, 1, -1e16]);
  });

  it('accepts iterables and the empty measure without mutating caller state', () => {
    const terms = [0.1, 0.2, 0.3, 0.4];
    const before = [...terms];
    function* values() {
      yield* terms;
    }

    expect(sumAflTradeFiniteNumbers(values())).toBe(1);
    expect(sumAflTradeFiniteNumbers([])).toBe(0);
    expect(terms).toEqual(before);
  });

  it('canonicalizes negative zero across public result paths', () => {
    const accumulator = createAflTradeCompensatedAccumulator();
    addAflTradeCompensatedTerm(accumulator, -0);

    for (const value of [
      canonicalizeAflTradeZero(-0),
      readAflTradeCompensatedValue(accumulator),
      sumAflTradeFiniteNumbers([-0]),
      normalizeAflTradeProbabilityMass(-0, 1),
    ]) {
      expect(value).toBe(0);
      expect(Object.is(value, -0)).toBe(false);
    }
    expect(canonicalizeAflTradeZero(2)).toBe(2);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite input term %s',
    (value) => {
      expectErrorCode(() => sumAflTradeFiniteNumbers([value]), 'NON_FINITE_TERM');
      expectErrorCode(() => doAflTradeProbabilityMassesReconcile(value, 1), 'NON_FINITE_TERM');
      expectErrorCode(() => normalizeAflTradeProbabilityMass(value, 1), 'NON_FINITE_TERM');
    }
  );

  it('fails closed when finite terms produce non-finite derivations', () => {
    const accumulator = createAflTradeCompensatedAccumulator();
    addAflTradeCompensatedTerm(accumulator, Number.MAX_VALUE);

    expectErrorCode(
      () => addAflTradeCompensatedTerm(accumulator, Number.MAX_VALUE),
      'NON_FINITE_DERIVATION'
    );
    expectErrorCode(
      () =>
        readAflTradeCompensatedValue({
          sum: Number.MAX_VALUE,
          correction: Number.MAX_VALUE,
        }),
      'NON_FINITE_DERIVATION'
    );
    expectErrorCode(
      () => doAflTradeProbabilityMassesReconcile(Number.MAX_VALUE, -Number.MAX_VALUE),
      'NON_FINITE_DERIVATION'
    );
  });
});

describe('deterministic AFL trade probability reconciliation', () => {
  it.each([1 + 0.9e-8, 1 - 0.9e-8])(
    'accepts and preserves an actual total inside the unit-mass tolerance: %d',
    (total) => {
      expect(isAflTradeUnitProbabilityMass(total)).toBe(true);
      expect(requireAflTradeUnitProbabilityMass(total)).toBe(total);
    }
  );

  it.each([1 + 1.1e-8, 1 - 1.1e-8, 0, -1])(
    'rejects a total outside the unit-mass contract: %d',
    (total) => {
      expect(isAflTradeUnitProbabilityMass(total)).toBe(false);
      expectErrorCode(() => requireAflTradeUnitProbabilityMass(total), 'INVALID_TOTAL_MASS');
    }
  );

  it('reconciles nearby masses without accepting a material difference', () => {
    expect(doAflTradeProbabilityMassesReconcile(0.4, 0.4 + 0.9e-8)).toBe(true);
    expect(doAflTradeProbabilityMassesReconcile(0.4, 0.4 + 1.1e-8)).toBe(false);
  });

  it('normalizes by the accepted actual total instead of snapping it to one', () => {
    const total = 1 + 0.9e-8;
    expect(normalizeAflTradeProbabilityMass(0.5, total)).toBe(0.5 / total);
    expect(normalizeAflTradeProbabilityMass(0, total)).toBe(0);
    expect(normalizeAflTradeProbabilityMass(total, total)).toBe(1);
  });

  it('allows only reconciling positive over-allocation to clamp to one', () => {
    expect(normalizeAflTradeProbabilityMass(1 + 0.5e-8, 1)).toBe(1);
    expectErrorCode(
      () => normalizeAflTradeProbabilityMass(1 + 2e-8, 1),
      'INVALID_PROBABILITY_MASS'
    );
  });

  it.each([-Number.MIN_VALUE, -0.5, -1])('rejects every negative sub-mass: %d', (mass) => {
    expectErrorCode(() => normalizeAflTradeProbabilityMass(mass, 1), 'INVALID_PROBABILITY_MASS');
  });

  it('rejects an invalid total before normalization', () => {
    expectErrorCode(() => normalizeAflTradeProbabilityMass(0, 0), 'INVALID_TOTAL_MASS');
    expectErrorCode(() => normalizeAflTradeProbabilityMass(0.5, 1 + 2e-8), 'INVALID_TOTAL_MASS');
  });

  it('is repeatable without mutating its scalar inputs', () => {
    const mass = 0.375;
    const total = 1 - 0.5e-8;
    const outputs = Array.from({ length: 100 }, () =>
      normalizeAflTradeProbabilityMass(mass, total)
    );

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe(mass / total);
    expect(mass).toBe(0.375);
    expect(total).toBe(1 - 0.5e-8);
  });
});
