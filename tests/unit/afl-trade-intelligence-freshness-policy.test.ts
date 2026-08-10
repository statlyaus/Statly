// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { doesAflTradeArtifactRefMatchCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_FRESHNESS_OPERATOR_ACTIONS,
  AFL_TRADE_FRESHNESS_POLICY_ANCHOR,
  AFL_TRADE_FRESHNESS_POLICY_BOUNDARY_DEFINITION,
  AFL_TRADE_FRESHNESS_POLICY_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY,
  AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION,
  AFL_TRADE_FRESHNESS_WARNING_CODES,
  AflTradeFreshnessPolicyError,
  aflTradeFreshnessEvaluationSchema,
  aflTradeFreshnessPolicyResultSchema,
  createAflTradeFreshnessPolicy,
  evaluateAflTradePublicationFreshness,
  isAflTradeFreshnessPolicyError,
  verifyAflTradeFreshnessPolicy,
  verifyAflTradePublicationFreshnessEvaluation,
  type AflTradeFreshnessActivePriorPublication,
  type AflTradeFreshnessFailedCandidate,
  type AflTradeFreshnessPolicyErrorCode,
  type AflTradeFreshnessPolicyResult,
} from '@/server/aflTradeIntelligence/publication/freshnessPolicy';
import { aflTradePublicationRefSchema } from '@/types/aflTradeIntelligence';

const SCOPE_KEY = 'afl-public-trade-values';
const VALUE_UNIT_ID = 'statly-football-value-v1';
const CREATED_AT = '2026-07-31T23:00:00.000Z';
const CALCULATION_AS_OF = '2026-08-01T00:00:00.000Z';
const STALE_AFTER = '2026-08-01T01:00:00.000Z';
const SERVE_UNTIL = '2026-08-01T01:30:00.000Z';
const CURRENT_DURATION_SECONDS = 3_600;
const STALE_DURATION_SECONDS = 1_800;

function publicationId(label: string): `publication:${string}` {
  return createAflTradeContentAddress('publication', {
    fixture: 'freshness-publication',
    label,
  }) as `publication:${string}`;
}

function projectionId(label: string): `projection:${string}` {
  return createAflTradeContentAddress('projection', {
    fixture: 'freshness-projection',
    label,
  }) as `projection:${string}`;
}

function valuationBundleId(label: string): `valuation-bundle:${string}` {
  return createAflTradeContentAddress('valuation-bundle', {
    fixture: 'freshness-valuation-bundle',
    label,
  }) as `valuation-bundle:${string}`;
}

function createPolicy(
  overrides: Partial<{
    scopeKey: string;
    valueUnitId: string;
    currentDurationSeconds: number;
    staleServeDurationSeconds: number;
    createdAt: string;
  }> = {}
): AflTradeFreshnessPolicyResult {
  return createAflTradeFreshnessPolicy({
    scopeKey: overrides.scopeKey ?? SCOPE_KEY,
    valueUnitId: overrides.valueUnitId ?? VALUE_UNIT_ID,
    currentDurationSeconds: overrides.currentDurationSeconds ?? CURRENT_DURATION_SECONDS,
    staleServeDurationSeconds: overrides.staleServeDurationSeconds ?? STALE_DURATION_SECONDS,
    createdAt: overrides.createdAt ?? CREATED_AT,
  });
}

function activePrior(
  overrides: Partial<AflTradeFreshnessActivePriorPublication> = {}
): AflTradeFreshnessActivePriorPublication {
  const publication = aflTradePublicationRefSchema.parse({
    publicationId: publicationId('active-prior'),
    state: 'published',
    valuationBundleId: valuationBundleId('active-prior'),
    valueUnitId: VALUE_UNIT_ID,
    publishedAt: CALCULATION_AS_OF,
  });
  return {
    publication,
    projectionBuildId: projectionId('active-prior'),
    registryRevision: 7,
    scopeKey: SCOPE_KEY,
    calculationAsOf: CALCULATION_AS_OF,
    ...overrides,
  };
}

function failedCandidate(
  overrides: Partial<AflTradeFreshnessFailedCandidate> = {}
): AflTradeFreshnessFailedCandidate {
  return {
    candidatePublicationId: publicationId('failed-candidate'),
    candidateProjectionBuildId: projectionId('failed-candidate'),
    scopeKey: SCOPE_KEY,
    valueUnitId: VALUE_UNIT_ID,
    startedAt: '2026-08-01T00:05:00.000Z',
    failedAt: '2026-08-01T00:10:00.000Z',
    failureCode: 'calculation_failed_retryable',
    ...overrides,
  };
}

function evaluate(
  evaluatedAt: string,
  options: {
    policyBinding?: AflTradeFreshnessPolicyResult;
    activePriorPublication?: AflTradeFreshnessActivePriorPublication | null;
    failedCandidate?: AflTradeFreshnessFailedCandidate | null;
    clock?: () => string;
  } = {}
) {
  return evaluateAflTradePublicationFreshness({
    policyBinding: options.policyBinding ?? createPolicy(),
    activePriorPublication:
      options.activePriorPublication === undefined ? activePrior() : options.activePriorPublication,
    failedCandidate: options.failedCandidate ?? null,
    clock: options.clock ?? (() => evaluatedAt),
  });
}

function expectPolicyError(
  action: () => unknown,
  code: AflTradeFreshnessPolicyErrorCode
): AflTradeFreshnessPolicyError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeFreshnessPolicyError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeFreshnessPolicyError);
    expect((error as AflTradeFreshnessPolicyError).code).toBe(code);
    return error as AflTradeFreshnessPolicyError;
  }
  throw new Error(`Expected freshness-policy error ${code}.`);
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, seen);
}

function collectKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key);
    collectKeys(nested, keys, seen);
  }
  return keys;
}

describe('AFL trade-intelligence publication freshness policy', () => {
  it('creates a deterministic immutable policy and authentic canonical artifact reference', () => {
    const first = createPolicy();
    const second = createPolicy();

    expect(first).toEqual(second);
    expect(aflTradeFreshnessPolicyResultSchema.safeParse(first).success).toBe(true);
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        first.freshnessPolicyArtifactRef,
        first.freshnessPolicy
      )
    ).toBe(true);
    expect(first.freshnessPolicyArtifactRef.createdAt).toBe(CREATED_AT);
    expect(first.freshnessPolicy.content).toMatchObject({
      scopeKey: SCOPE_KEY,
      valueUnitId: VALUE_UNIT_ID,
      freshnessAnchor: AFL_TRADE_FRESHNESS_POLICY_ANCHOR,
      boundaryDefinition: AFL_TRADE_FRESHNESS_POLICY_BOUNDARY_DEFINITION,
      warningCodes: AFL_TRADE_FRESHNESS_WARNING_CODES,
      operatorActions: AFL_TRADE_FRESHNESS_OPERATOR_ACTIONS,
      publicationAuthority: AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY,
      runtimeMutation: AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION,
    });
    expectDeepFrozen(first);
  });

  it('rejects non-exact creator and evaluator envelopes', () => {
    const validCreator = {
      scopeKey: SCOPE_KEY,
      valueUnitId: VALUE_UNIT_ID,
      currentDurationSeconds: CURRENT_DURATION_SECONDS,
      staleServeDurationSeconds: STALE_DURATION_SECONDS,
      createdAt: CREATED_AT,
    };
    expectPolicyError(
      () => createAflTradeFreshnessPolicy({ ...validCreator, extra: true }),
      'INVALID_INPUT_ENVELOPE'
    );
    const { createdAt: _omitted, ...missing } = validCreator;
    expectPolicyError(() => createAflTradeFreshnessPolicy(missing), 'INVALID_INPUT_ENVELOPE');
    const symbolEnvelope = { ...validCreator, [Symbol('unexpected')]: true };
    expectPolicyError(
      () => createAflTradeFreshnessPolicy(symbolEnvelope),
      'INVALID_INPUT_ENVELOPE'
    );
    expectPolicyError(
      () =>
        evaluateAflTradePublicationFreshness({
          policyBinding: createPolicy(),
          activePriorPublication: activePrior(),
          failedCandidate: null,
          clock: () => CALCULATION_AS_OF,
          extra: true,
        }),
      'INVALID_EVALUATION_ENVELOPE'
    );
  });

  it('enforces the one-year duration domain and keeps maximal policies below 16 KiB', () => {
    expect(createPolicy({ currentDurationSeconds: 1, staleServeDurationSeconds: 0 })).toBeDefined();
    expect(
      createPolicy({ currentDurationSeconds: 31_535_999, staleServeDurationSeconds: 1 })
    ).toBeDefined();
    expectPolicyError(
      () => createPolicy({ currentDurationSeconds: 0 }),
      'INVALID_CURRENT_DURATION'
    );
    expectPolicyError(
      () => createPolicy({ currentDurationSeconds: 31_536_001 }),
      'INVALID_CURRENT_DURATION'
    );
    expectPolicyError(
      () => createPolicy({ staleServeDurationSeconds: -1 }),
      'INVALID_STALE_DURATION'
    );
    expectPolicyError(
      () => createPolicy({ staleServeDurationSeconds: 31_536_001 }),
      'INVALID_STALE_DURATION'
    );
    expectPolicyError(
      () => createPolicy({ currentDurationSeconds: 31_536_000, staleServeDurationSeconds: 1 }),
      'DURATION_WINDOW_EXCEEDS_LIMIT'
    );

    const largestIdentifiers = createPolicy({
      scopeKey: `s${'s'.repeat(159)}`,
      valueUnitId: `v${'v'.repeat(159)}`,
      currentDurationSeconds: 31_535_999,
      staleServeDurationSeconds: 1,
    });
    expect(largestIdentifiers.freshnessPolicyArtifactRef.byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it('uses exact current, stale, and expired endpoints', () => {
    const atCalculation = evaluate(CALCULATION_AS_OF);
    const immediatelyBeforeStale = evaluate('2026-08-01T00:59:59.999Z');
    const atStale = evaluate(STALE_AFTER);
    const atServeUntil = evaluate(SERVE_UNTIL);
    const afterServeUntil = evaluate('2026-08-01T01:30:00.001Z');

    expect(atCalculation.freshness).toBe('current');
    expect(immediatelyBeforeStale.freshness).toBe('current');
    expect(atStale).toMatchObject({
      freshness: 'stale',
      servingDecision: 'serve_active_prior',
      nextDeadline: SERVE_UNTIL,
    });
    expect(atServeUntil.freshness).toBe('stale');
    expect(afterServeUntil).toMatchObject({
      freshness: 'expired',
      servingDecision: 'do_not_serve',
      nextDeadline: null,
    });
    expect(atCalculation.staleAfter).toBe(STALE_AFTER);
    expect(atCalculation.serveUntil).toBe(SERVE_UNTIL);
    expect(atCalculation.nextDeadline).toBe(STALE_AFTER);
  });

  it('treats a zero stale duration as one inclusive boundary instant', () => {
    const policyBinding = createPolicy({
      currentDurationSeconds: 60,
      staleServeDurationSeconds: 0,
    });
    const atBoundary = evaluate('2026-08-01T00:01:00.000Z', { policyBinding });
    const afterBoundary = evaluate('2026-08-01T00:01:00.001Z', { policyBinding });

    expect(atBoundary).toMatchObject({
      staleAfter: '2026-08-01T00:01:00.000Z',
      serveUntil: '2026-08-01T00:01:00.000Z',
      freshness: 'stale',
      servingDecision: 'serve_active_prior',
    });
    expect(afterBoundary).toMatchObject({
      freshness: 'expired',
      servingDecision: 'do_not_serve',
    });
  });

  it('fails closed without an explicitly active prior publication', () => {
    const unavailable = evaluate('2026-08-01T00:30:00.000Z', {
      activePriorPublication: null,
    });

    expect(unavailable).toMatchObject({
      freshness: 'unavailable',
      activePublicationId: null,
      servingDecision: 'do_not_serve',
      retentionDecision: 'not_applicable',
      operatorAction: 'stop_serving_and_refresh',
      warnings: [],
    });
  });

  it('retains an explicitly published prior only while it remains current or stale', () => {
    const candidate = failedCandidate();
    const current = evaluate('2026-08-01T00:30:00.000Z', { failedCandidate: candidate });
    const stale = evaluate('2026-08-01T01:15:00.000Z', { failedCandidate: candidate });

    for (const result of [current, stale]) {
      expect(result.servingDecision).toBe('serve_active_prior');
      expect(result.retentionDecision).toBe('retain_active_prior');
      expect(result.failedCandidatePublicationId).toBe(candidate.candidatePublicationId);
      expect(result.warnings.map(({ code }) => code)).toContain(
        'candidate_refresh_failed_prior_publication_retained'
      );
    }
    expect(stale.warnings.map(({ code }) => code)).toContain('active_publication_stale');
  });

  it('denies failed-candidate retention for expired or absent prior publications', () => {
    const candidate = failedCandidate();
    const expired = evaluate('2026-08-01T01:30:00.001Z', { failedCandidate: candidate });
    const absent = evaluate('2026-08-01T00:30:00.000Z', {
      activePriorPublication: null,
      failedCandidate: candidate,
    });

    expect(expired).toMatchObject({
      freshness: 'expired',
      servingDecision: 'do_not_serve',
      retentionDecision: 'retention_denied',
    });
    expect(absent).toMatchObject({
      freshness: 'unavailable',
      servingDecision: 'do_not_serve',
      retentionDecision: 'retention_denied',
      operatorAction: 'investigate_candidate_failure',
    });
    expect(absent.warnings.map(({ code }) => code)).toEqual([
      'candidate_refresh_failed_no_active_prior',
    ]);
  });

  it('rejects cross-scope, cross-unit, and same-publication fallback attempts', () => {
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          activePriorPublication: activePrior({ scopeKey: 'another-scope' }),
        }),
      'POLICY_SCOPE_MISMATCH'
    );
    const crossUnitPublication = aflTradePublicationRefSchema.parse({
      ...activePrior().publication,
      valueUnitId: 'another-value-unit',
    });
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          activePriorPublication: activePrior({ publication: crossUnitPublication }),
        }),
      'POLICY_VALUE_UNIT_MISMATCH'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          failedCandidate: failedCandidate({ scopeKey: 'another-scope' }),
        }),
      'CANDIDATE_SCOPE_MISMATCH'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          failedCandidate: failedCandidate({ valueUnitId: 'another-value-unit' }),
        }),
      'CANDIDATE_VALUE_UNIT_MISMATCH'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          failedCandidate: failedCandidate({
            candidatePublicationId: activePrior().publication.publicationId,
          }),
        }),
      'CANDIDATE_MATCHES_ACTIVE_PUBLICATION'
    );
  });

  it('rejects non-monotonic policy, publication, and candidate chronology', () => {
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          policyBinding: createPolicy({ createdAt: '2026-08-01T00:30:00.001Z' }),
        }),
      'NON_MONOTONIC_CHRONOLOGY'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          activePriorPublication: activePrior({
            calculationAsOf: '2026-08-01T00:00:00.001Z',
          }),
        }),
      'NON_MONOTONIC_CHRONOLOGY'
    );
    const futurePublication = aflTradePublicationRefSchema.parse({
      ...activePrior().publication,
      publishedAt: '2026-08-01T00:30:00.001Z',
    });
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          activePriorPublication: activePrior({ publication: futurePublication }),
        }),
      'NON_MONOTONIC_CHRONOLOGY'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          failedCandidate: failedCandidate({
            startedAt: '2026-08-01T00:10:00.001Z',
            failedAt: '2026-08-01T00:10:00.000Z',
          }),
        }),
      'NON_MONOTONIC_CHRONOLOGY'
    );
    expectPolicyError(
      () =>
        evaluate('2026-08-01T00:30:00.000Z', {
          failedCandidate: failedCandidate({ failedAt: '2026-08-01T00:30:00.001Z' }),
        }),
      'NON_MONOTONIC_CHRONOLOGY'
    );
  });

  it('invokes the injected clock exactly once and rejects invalid clocks', () => {
    let calls = 0;
    const result = evaluate('unused', {
      clock: () => {
        calls += 1;
        return '2026-08-01T00:30:00.000Z';
      },
    });

    expect(calls).toBe(1);
    expect(result.evaluatedAt).toBe('2026-08-01T00:30:00.000Z');
    expectPolicyError(
      () =>
        evaluateAflTradePublicationFreshness({
          policyBinding: createPolicy(),
          activePriorPublication: activePrior(),
          failedCandidate: null,
          clock: () => 'not-a-time',
        }),
      'INVALID_CLOCK'
    );
    expectPolicyError(
      () =>
        evaluateAflTradePublicationFreshness({
          policyBinding: createPolicy(),
          activePriorPublication: activePrior(),
          failedCandidate: null,
          clock: () => {
            throw new Error('hostile clock');
          },
        }),
      'INVALID_CLOCK'
    );
  });

  it('brands only trusted errors and deeply freezes successful evaluations', () => {
    const trusted = expectPolicyError(
      () => createAflTradeFreshnessPolicy(null),
      'INVALID_INPUT_ENVELOPE'
    );
    const counterfeit = {
      name: trusted.name,
      code: trusted.code,
      message: trusted.message,
    };

    expect(isAflTradeFreshnessPolicyError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(isAflTradeFreshnessPolicyError(counterfeit)).toBe(false);
    expect(isAflTradeFreshnessPolicyError(new Error(trusted.message))).toBe(false);

    const result = evaluate('2026-08-01T01:15:00.000Z', {
      failedCandidate: failedCandidate(),
    });
    expectDeepFrozen(result);
  });

  it('contains hostile getters, proxies, revocation, nested traps, and callable traps', () => {
    const throwingGetter = Object.defineProperty({}, 'scopeKey', {
      enumerable: true,
      get() {
        throw new Error('getter must not escape');
      },
    });
    Object.assign(throwingGetter, {
      valueUnitId: VALUE_UNIT_ID,
      currentDurationSeconds: 1,
      staleServeDurationSeconds: 0,
      createdAt: CREATED_AT,
    });
    expectPolicyError(
      () => createAflTradeFreshnessPolicy(throwingGetter),
      'INVALID_INPUT_ENVELOPE'
    );

    const hostileOwnKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy must not escape');
        },
      }
    );
    expectPolicyError(
      () => createAflTradeFreshnessPolicy(hostileOwnKeys),
      'INVALID_INPUT_ENVELOPE'
    );

    const revokedEnvelope = Proxy.revocable({}, {});
    revokedEnvelope.revoke();
    expectPolicyError(
      () => createAflTradeFreshnessPolicy(revokedEnvelope.proxy),
      'INVALID_INPUT_ENVELOPE'
    );

    const hostileActive = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('nested proxy must not escape');
        },
      }
    );
    expectPolicyError(
      () =>
        evaluateAflTradePublicationFreshness({
          policyBinding: createPolicy(),
          activePriorPublication: hostileActive,
          failedCandidate: null,
          clock: () => CALCULATION_AS_OF,
        }),
      'INVALID_ACTIVE_PUBLICATION'
    );

    const revokedClock = Proxy.revocable(() => CALCULATION_AS_OF, {});
    revokedClock.revoke();
    expectPolicyError(
      () =>
        evaluateAflTradePublicationFreshness({
          policyBinding: createPolicy(),
          activePriorPublication: activePrior(),
          failedCandidate: null,
          clock: revokedClock.proxy,
        }),
      'INVALID_CLOCK'
    );
  });

  it('replays policy and evaluation without a clock and rejects tampering', () => {
    const policyBinding = createPolicy();
    expect(
      verifyAflTradeFreshnessPolicy({
        scopeKey: SCOPE_KEY,
        valueUnitId: VALUE_UNIT_ID,
        currentDurationSeconds: CURRENT_DURATION_SECONDS,
        staleServeDurationSeconds: STALE_DURATION_SECONDS,
        createdAt: CREATED_AT,
        result: policyBinding,
      })
    ).toBe(true);
    const tamperedPolicy = structuredClone(policyBinding);
    tamperedPolicy.freshnessPolicy.content.currentDurationSeconds += 1;
    expect(
      verifyAflTradeFreshnessPolicy({
        scopeKey: SCOPE_KEY,
        valueUnitId: VALUE_UNIT_ID,
        currentDurationSeconds: CURRENT_DURATION_SECONDS,
        staleServeDurationSeconds: STALE_DURATION_SECONDS,
        createdAt: CREATED_AT,
        result: tamperedPolicy,
      })
    ).toBe(false);

    const activePriorPublication = activePrior();
    const candidate = failedCandidate();
    const evaluatedAt = '2026-08-01T01:15:00.000Z';
    const output = evaluate(evaluatedAt, {
      policyBinding,
      activePriorPublication,
      failedCandidate: candidate,
    });
    const verification = {
      policyBinding,
      activePriorPublication,
      failedCandidate: candidate,
      evaluatedAt,
      output,
    };
    expect(verifyAflTradePublicationFreshnessEvaluation(verification)).toBe(true);
    const tamperedOutput = structuredClone(output);
    tamperedOutput.servingDecision = 'do_not_serve';
    expect(
      verifyAflTradePublicationFreshnessEvaluation({
        ...verification,
        output: tamperedOutput,
      })
    ).toBe(false);
    expect(verifyAflTradePublicationFreshnessEvaluation({ ...verification, extra: true })).toBe(
      false
    );
    expect(aflTradeFreshnessEvaluationSchema.safeParse(output).success).toBe(true);
  });

  it('stays inside the source-native public AFL asset boundary with no ownership fields', () => {
    const policyBinding = createPolicy();
    const output = evaluate('2026-08-01T00:30:00.000Z', {
      policyBinding,
      failedCandidate: failedCandidate(),
    });
    const allKeys = collectKeys({ policyBinding, output });

    expect(policyBinding.freshnessPolicy.content.publicAssetBoundary).toBe(
      AFL_TRADE_FRESHNESS_POLICY_PUBLIC_ASSET_BOUNDARY
    );
    for (const forbiddenKey of [
      'userId',
      'ownerId',
      'ownership',
      'fantasyLeagueId',
      'leagueId',
      'membershipId',
      'seasonId',
      'rosterId',
    ]) {
      expect(allKeys.has(forbiddenKey)).toBe(false);
    }
  });
});
