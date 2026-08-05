import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
  aflTradePublicationRefSchema,
} from '../../../types/aflTradeIntelligence/shared';

export const AFL_TRADE_FRESHNESS_POLICY_SCHEMA_VERSION =
  'afl-trade-publication-freshness-policy/v1' as const;
export const AFL_TRADE_FRESHNESS_POLICY_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_FRESHNESS_POLICY_DURATION_UNIT = 'seconds' as const;
export const AFL_TRADE_FRESHNESS_POLICY_ANCHOR =
  'projection_calculation_as_of_never_publication_activation' as const;
export const AFL_TRADE_FRESHNESS_POLICY_BOUNDARY_DEFINITION =
  'current_from_as_of_inclusive_to_stale_after_exclusive_stale_to_serve_until_inclusive_expired_after_serve_until_v1' as const;
export const AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY =
  'publication_registry_is_sole_activation_and_serving_authority' as const;
export const AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION = 'forbidden' as const;
export const AFL_TRADE_FRESHNESS_POLICY_LIMITATION =
  'Freshness classifies an explicitly active source-native AFL publication from its projection calculation time. It does not establish publication authority, reactivate superseded output, infer user ownership, or authorize fantasy state.' as const;

export const AFL_TRADE_FRESHNESS_WARNING_CODES = [
  'active_publication_stale',
  'active_publication_expired',
  'candidate_refresh_failed_prior_publication_retained',
  'candidate_refresh_failed_no_active_prior',
] as const;

export const AFL_TRADE_FRESHNESS_OPERATOR_ACTIONS = [
  'none',
  'refresh_active_publication',
  'stop_serving_and_refresh',
  'investigate_candidate_failure',
] as const;

const MAX_DURATION_SECONDS = 31_536_000;
const MAX_POLICY_BYTES = 16 * 1024;

const freshnessWarningCodeSchema = z.enum(AFL_TRADE_FRESHNESS_WARNING_CODES);
const freshnessOperatorActionSchema = z.enum(AFL_TRADE_FRESHNESS_OPERATOR_ACTIONS);
const publicationIdSchema = z.string().regex(/^publication:[a-f0-9]{64}$/);
const projectionIdSchema = aflTradeContentAddressedIdSchema('projection');

const failedCandidateRetentionSchema = z
  .object({
    eligiblePriorState: z.literal('published'),
    eligibleFreshness: z.tuple([z.literal('current'), z.literal('stale')]),
    requiresExplicitActivePrior: z.literal(true),
    requiresSameScope: z.literal(true),
    requiresSameValueUnit: z.literal(true),
    requiresDistinctCandidatePublication: z.literal(true),
    expiredTreatment: z.literal('do_not_retain'),
    unavailableTreatment: z.literal('do_not_retain'),
  })
  .strict();

export const aflTradeFreshnessPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FRESHNESS_POLICY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_FRESHNESS_POLICY_PUBLIC_ASSET_BOUNDARY),
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    durationUnit: z.literal(AFL_TRADE_FRESHNESS_POLICY_DURATION_UNIT),
    currentDurationSeconds: z.number().int().min(1).max(MAX_DURATION_SECONDS),
    staleServeDurationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS),
    freshnessAnchor: z.literal(AFL_TRADE_FRESHNESS_POLICY_ANCHOR),
    boundaryDefinition: z.literal(AFL_TRADE_FRESHNESS_POLICY_BOUNDARY_DEFINITION),
    warningCodes: z.tuple([
      z.literal('active_publication_stale'),
      z.literal('active_publication_expired'),
      z.literal('candidate_refresh_failed_prior_publication_retained'),
      z.literal('candidate_refresh_failed_no_active_prior'),
    ]),
    operatorActions: z.tuple([
      z.literal('none'),
      z.literal('refresh_active_publication'),
      z.literal('stop_serving_and_refresh'),
      z.literal('investigate_candidate_failure'),
    ]),
    failedCandidateRetention: failedCandidateRetentionSchema,
    publicationAuthority: z.literal(AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY),
    runtimeMutation: z.literal(AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION),
    createdAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_FRESHNESS_POLICY_LIMITATION),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentDurationSeconds + value.staleServeDurationSeconds > MAX_DURATION_SECONDS) {
      context.addIssue({
        code: 'custom',
        path: ['staleServeDurationSeconds'],
        message: 'The complete current and stale serving window cannot exceed one year.',
      });
    }
  });

export const aflTradeFreshnessPolicySchema = z
  .object({
    freshnessPolicyId: aflTradeContentAddressedIdSchema('freshness-policy'),
    content: aflTradeFreshnessPolicyContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    try {
      if (
        value.freshnessPolicyId !== createAflTradeContentAddress('freshness-policy', value.content)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['freshnessPolicyId'],
          message: 'The freshness-policy identifier must match its canonical content address.',
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Freshness-policy content must be canonical JSON.',
      });
    }
  });

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (value) => value.mediaType === 'application/json',
  'Freshness policy artifacts must reference canonical JSON.'
);

const aflTradeFreshnessPolicyBindingStructuralSchema = z
  .object({
    freshnessPolicy: aflTradeFreshnessPolicySchema,
    freshnessPolicyArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeFreshnessPolicyResultSchema =
  aflTradeFreshnessPolicyBindingStructuralSchema.superRefine((value, context) => {
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(
        value.freshnessPolicyArtifactRef,
        value.freshnessPolicy
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['freshnessPolicyArtifactRef'],
        message: 'The artifact reference must authenticate the freshness policy.',
      });
    }
    if (value.freshnessPolicyArtifactRef.createdAt !== value.freshnessPolicy.content.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['freshnessPolicyArtifactRef', 'createdAt'],
        message: 'Artifact materialization must equal policy creation time.',
      });
    }
  });

const publishedPublicationRefSchema = aflTradePublicationRefSchema.refine(
  (value) => value.state === 'published',
  'An active prior publication must remain explicitly published.'
);

export const aflTradeFreshnessActivePriorPublicationSchema = z
  .object({
    publication: publishedPublicationRefSchema,
    projectionBuildId: projectionIdSchema,
    registryRevision: z.number().int().positive(),
    scopeKey: aflTradePublicIdSchema,
    calculationAsOf: aflTradeIsoDateTimeSchema,
  })
  .strict();

export const aflTradeFreshnessFailedCandidateSchema = z
  .object({
    candidatePublicationId: publicationIdSchema,
    candidateProjectionBuildId: projectionIdSchema.nullable(),
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    startedAt: aflTradeIsoDateTimeSchema,
    failedAt: aflTradeIsoDateTimeSchema,
    failureCode: aflTradePublicIdSchema,
  })
  .strict();

const freshnessWarningSchema = z
  .object({
    code: freshnessWarningCodeSchema,
    severity: z.enum(['warning', 'critical']),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

export const aflTradeFreshnessEvaluationSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication-freshness-evaluation/v1'),
    freshnessPolicyId: aflTradeContentAddressedIdSchema('freshness-policy'),
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    evaluatedAt: aflTradeIsoDateTimeSchema,
    activePublicationId: publicationIdSchema.nullable(),
    projectionBuildId: projectionIdSchema.nullable(),
    registryRevision: z.number().int().positive().nullable(),
    calculationAsOf: aflTradeIsoDateTimeSchema.nullable(),
    staleAfter: aflTradeIsoDateTimeSchema.nullable(),
    serveUntil: aflTradeIsoDateTimeSchema.nullable(),
    freshness: z.enum(['current', 'stale', 'expired', 'unavailable']),
    servingDecision: z.enum(['serve_active_prior', 'do_not_serve']),
    retentionDecision: z.enum(['not_applicable', 'retain_active_prior', 'retention_denied']),
    failedCandidatePublicationId: publicationIdSchema.nullable(),
    warnings: z.array(freshnessWarningSchema).max(2),
    operatorAction: freshnessOperatorActionSchema,
    nextDeadline: aflTradeIsoDateTimeSchema.nullable(),
    publicationAuthority: z.literal(AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY),
    runtimeMutation: z.literal(AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION),
  })
  .strict()
  .superRefine((value, context) => {
    const hasPrior = value.activePublicationId !== null;
    const priorFields = [
      value.projectionBuildId,
      value.registryRevision,
      value.calculationAsOf,
      value.staleAfter,
      value.serveUntil,
    ];
    if (priorFields.some((field) => (hasPrior ? field === null : field !== null))) {
      context.addIssue({
        code: 'custom',
        path: ['activePublicationId'],
        message: 'Active-publication evaluation fields must be present or absent together.',
      });
    }
    if (value.freshness === 'unavailable' && hasPrior) {
      context.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'Unavailable freshness cannot identify an active prior publication.',
      });
    }
    if (value.freshness !== 'unavailable' && !hasPrior) {
      context.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'A classified freshness state requires an active prior publication.',
      });
    }
    const shouldServe = value.freshness === 'current' || value.freshness === 'stale';
    if ((value.servingDecision === 'serve_active_prior') !== shouldServe) {
      context.addIssue({
        code: 'custom',
        path: ['servingDecision'],
        message: 'Only current or stale active publications may be served.',
      });
    }
    if (
      value.retentionDecision === 'retain_active_prior' &&
      (!shouldServe || value.failedCandidatePublicationId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retentionDecision'],
        message: 'Retention requires a failed candidate and a servable active prior publication.',
      });
    }
  });

export type AflTradeFreshnessPolicy = z.infer<typeof aflTradeFreshnessPolicySchema>;
export type AflTradeFreshnessPolicyResult = z.infer<typeof aflTradeFreshnessPolicyResultSchema>;
export type AflTradeFreshnessActivePriorPublication = z.infer<
  typeof aflTradeFreshnessActivePriorPublicationSchema
>;
export type AflTradeFreshnessFailedCandidate = z.infer<
  typeof aflTradeFreshnessFailedCandidateSchema
>;
export type AflTradeFreshnessEvaluation = z.infer<typeof aflTradeFreshnessEvaluationSchema>;

export type AflTradeFreshnessPolicyErrorCode =
  | 'INVALID_INPUT_ENVELOPE'
  | 'INVALID_SCOPE_KEY'
  | 'INVALID_VALUE_UNIT_ID'
  | 'INVALID_CURRENT_DURATION'
  | 'INVALID_STALE_DURATION'
  | 'DURATION_WINDOW_EXCEEDS_LIMIT'
  | 'INVALID_CREATED_AT'
  | 'POLICY_SIZE_LIMIT_EXCEEDED'
  | 'INVALID_EVALUATION_ENVELOPE'
  | 'INVALID_POLICY_BINDING'
  | 'POLICY_ARTIFACT_REFERENCE_MISMATCH'
  | 'INVALID_CLOCK'
  | 'INVALID_ACTIVE_PUBLICATION'
  | 'INVALID_FAILED_CANDIDATE'
  | 'POLICY_SCOPE_MISMATCH'
  | 'POLICY_VALUE_UNIT_MISMATCH'
  | 'CANDIDATE_SCOPE_MISMATCH'
  | 'CANDIDATE_VALUE_UNIT_MISMATCH'
  | 'CANDIDATE_MATCHES_ACTIVE_PUBLICATION'
  | 'NON_MONOTONIC_CHRONOLOGY'
  | 'TIME_ARITHMETIC_OVERFLOW'
  | 'INTERNAL_ARTIFACT_CONTRACT_VIOLATION';

const ERROR_MESSAGES: Readonly<Record<AflTradeFreshnessPolicyErrorCode, string>> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The freshness-policy input envelope is invalid.',
  INVALID_SCOPE_KEY: 'The freshness-policy scope key is invalid.',
  INVALID_VALUE_UNIT_ID: 'The freshness-policy value-unit identifier is invalid.',
  INVALID_CURRENT_DURATION: 'The current-duration setting is invalid.',
  INVALID_STALE_DURATION: 'The stale-serving-duration setting is invalid.',
  DURATION_WINDOW_EXCEEDS_LIMIT: 'The complete freshness window exceeds one year.',
  INVALID_CREATED_AT: 'The freshness-policy creation time is invalid.',
  POLICY_SIZE_LIMIT_EXCEEDED: 'The canonical freshness-policy artifact exceeds its byte limit.',
  INVALID_EVALUATION_ENVELOPE: 'The freshness-evaluation input envelope is invalid.',
  INVALID_POLICY_BINDING: 'The freshness-policy binding is invalid.',
  POLICY_ARTIFACT_REFERENCE_MISMATCH:
    'The freshness-policy artifact reference does not authenticate its policy.',
  INVALID_CLOCK: 'The freshness evaluator clock did not provide one valid timestamp.',
  INVALID_ACTIVE_PUBLICATION: 'The active prior publication is invalid.',
  INVALID_FAILED_CANDIDATE: 'The failed candidate is invalid.',
  POLICY_SCOPE_MISMATCH: 'The active publication is outside the policy scope.',
  POLICY_VALUE_UNIT_MISMATCH: 'The active publication uses a different value unit.',
  CANDIDATE_SCOPE_MISMATCH: 'The failed candidate is outside the policy scope.',
  CANDIDATE_VALUE_UNIT_MISMATCH: 'The failed candidate uses a different value unit.',
  CANDIDATE_MATCHES_ACTIVE_PUBLICATION:
    'A failed candidate cannot be the explicitly active prior publication.',
  NON_MONOTONIC_CHRONOLOGY: 'Freshness inputs are not chronologically monotonic.',
  TIME_ARITHMETIC_OVERFLOW: 'Freshness deadline arithmetic exceeded the timestamp domain.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The freshness policy or evaluation failed its internal contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeFreshnessPolicyError extends Error {
  readonly code: AflTradeFreshnessPolicyErrorCode;

  constructor(code: AflTradeFreshnessPolicyErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeFreshnessPolicyError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeFreshnessPolicyError';
    code: AflTradeFreshnessPolicyErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeFreshnessPolicyError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeFreshnessPolicyError(
  value: unknown
): value is AflTradeFreshnessPolicyError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function policyError(code: AflTradeFreshnessPolicyErrorCode): AflTradeFreshnessPolicyError {
  return new AflTradeFreshnessPolicyError(code);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function safeParse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  try {
    const result = schema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function snapshotExactEnvelope<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys
): Record<Keys[number], unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const actualKeys = Reflect.ownKeys(value);
    const keySet = new Set<string>(keys);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keySet.has(key))
    ) {
      return null;
    }
    const snapshot = {} as Record<Keys[number], unknown>;
    for (const key of keys) snapshot[key as Keys[number]] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

export interface CreateAflTradeFreshnessPolicyInput {
  scopeKey: unknown;
  valueUnitId: unknown;
  currentDurationSeconds: unknown;
  staleServeDurationSeconds: unknown;
  createdAt: unknown;
}

const CREATE_KEYS = [
  'scopeKey',
  'valueUnitId',
  'currentDurationSeconds',
  'staleServeDurationSeconds',
  'createdAt',
] as const;

export function createAflTradeFreshnessPolicy(
  unparsedInput: unknown
): AflTradeFreshnessPolicyResult {
  try {
    const input = snapshotExactEnvelope(unparsedInput, CREATE_KEYS);
    if (input === null) throw policyError('INVALID_INPUT_ENVELOPE');
    const scopeKey = safeParse(aflTradePublicIdSchema, input.scopeKey);
    if (scopeKey === null) throw policyError('INVALID_SCOPE_KEY');
    const valueUnitId = safeParse(aflTradePublicIdSchema, input.valueUnitId);
    if (valueUnitId === null) throw policyError('INVALID_VALUE_UNIT_ID');
    const currentDurationSeconds = safeParse(
      z.number().int().min(1).max(MAX_DURATION_SECONDS),
      input.currentDurationSeconds
    );
    if (currentDurationSeconds === null) throw policyError('INVALID_CURRENT_DURATION');
    const staleServeDurationSeconds = safeParse(
      z.number().int().min(0).max(MAX_DURATION_SECONDS),
      input.staleServeDurationSeconds
    );
    if (staleServeDurationSeconds === null) throw policyError('INVALID_STALE_DURATION');
    if (currentDurationSeconds + staleServeDurationSeconds > MAX_DURATION_SECONDS) {
      throw policyError('DURATION_WINDOW_EXCEEDS_LIMIT');
    }
    const createdAt = safeParse(aflTradeIsoDateTimeSchema, input.createdAt);
    if (createdAt === null) throw policyError('INVALID_CREATED_AT');

    const content = aflTradeFreshnessPolicyContentSchema.parse({
      schemaVersion: AFL_TRADE_FRESHNESS_POLICY_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_FRESHNESS_POLICY_PUBLIC_ASSET_BOUNDARY,
      scopeKey,
      valueUnitId,
      durationUnit: AFL_TRADE_FRESHNESS_POLICY_DURATION_UNIT,
      currentDurationSeconds,
      staleServeDurationSeconds,
      freshnessAnchor: AFL_TRADE_FRESHNESS_POLICY_ANCHOR,
      boundaryDefinition: AFL_TRADE_FRESHNESS_POLICY_BOUNDARY_DEFINITION,
      warningCodes: AFL_TRADE_FRESHNESS_WARNING_CODES,
      operatorActions: AFL_TRADE_FRESHNESS_OPERATOR_ACTIONS,
      failedCandidateRetention: {
        eligiblePriorState: 'published',
        eligibleFreshness: ['current', 'stale'],
        requiresExplicitActivePrior: true,
        requiresSameScope: true,
        requiresSameValueUnit: true,
        requiresDistinctCandidatePublication: true,
        expiredTreatment: 'do_not_retain',
        unavailableTreatment: 'do_not_retain',
      },
      publicationAuthority: AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY,
      runtimeMutation: AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION,
      createdAt,
      limitation: AFL_TRADE_FRESHNESS_POLICY_LIMITATION,
    });
    const freshnessPolicy = aflTradeFreshnessPolicySchema.parse({
      freshnessPolicyId: createAflTradeContentAddress('freshness-policy', content),
      content,
    });
    const freshnessPolicyArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      freshnessPolicy,
      createdAt
    );
    if (freshnessPolicyArtifactRef.byteLength > MAX_POLICY_BYTES) {
      throw policyError('POLICY_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeFreshnessPolicyResultSchema.safeParse({
      freshnessPolicy,
      freshnessPolicyArtifactRef,
    });
    if (!result.success) throw policyError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeFreshnessPolicyError(error)) throw error;
    throw policyError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_POLICY_KEYS = [...CREATE_KEYS, 'result'] as const;

export function verifyAflTradeFreshnessPolicy(value: unknown): boolean {
  const input = snapshotExactEnvelope(value, VERIFY_POLICY_KEYS);
  if (input === null) return false;
  const supplied = safeParse(aflTradeFreshnessPolicyResultSchema, input.result);
  if (supplied === null) return false;
  try {
    const expected = createAflTradeFreshnessPolicy({
      scopeKey: input.scopeKey,
      valueUnitId: input.valueUnitId,
      currentDurationSeconds: input.currentDurationSeconds,
      staleServeDurationSeconds: input.staleServeDurationSeconds,
      createdAt: input.createdAt,
    });
    return canonicalizeAflTradeJson(supplied) === canonicalizeAflTradeJson(expected);
  } catch {
    return false;
  }
}

export type AflTradeFreshnessClock = () => string;

const EVALUATE_KEYS = [
  'policyBinding',
  'activePriorPublication',
  'failedCandidate',
  'clock',
] as const;

const WARNING_DEFINITIONS: Readonly<
  Record<
    (typeof AFL_TRADE_FRESHNESS_WARNING_CODES)[number],
    Readonly<{ severity: 'warning' | 'critical'; message: string }>
  >
> = Object.freeze({
  active_publication_stale: Object.freeze({
    severity: 'warning',
    message: 'The active publication is within its bounded stale-serving window.',
  }),
  active_publication_expired: Object.freeze({
    severity: 'critical',
    message: 'The active publication is beyond its stale-serving deadline and must not be served.',
  }),
  candidate_refresh_failed_prior_publication_retained: Object.freeze({
    severity: 'warning',
    message: 'A failed refresh candidate left the eligible active prior publication in service.',
  }),
  candidate_refresh_failed_no_active_prior: Object.freeze({
    severity: 'critical',
    message: 'A refresh candidate failed and no active prior publication is available to serve.',
  }),
});

function warning(code: (typeof AFL_TRADE_FRESHNESS_WARNING_CODES)[number]) {
  return { code, ...WARNING_DEFINITIONS[code] };
}

function addSeconds(timestamp: number, seconds: number): number {
  const result = timestamp + seconds * 1000;
  if (!Number.isSafeInteger(result) || !Number.isFinite(result)) {
    throw policyError('TIME_ARITHMETIC_OVERFLOW');
  }
  return result;
}

function asIso(timestamp: number): string {
  try {
    return new Date(timestamp).toISOString();
  } catch {
    throw policyError('TIME_ARITHMETIC_OVERFLOW');
  }
}

function assertBindingReference(binding: AflTradeFreshnessPolicyResult): void {
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(
      binding.freshnessPolicyArtifactRef,
      binding.freshnessPolicy
    ) ||
    binding.freshnessPolicyArtifactRef.createdAt !== binding.freshnessPolicy.content.createdAt
  ) {
    throw policyError('POLICY_ARTIFACT_REFERENCE_MISMATCH');
  }
}

function evaluateAt(input: {
  policyBinding: AflTradeFreshnessPolicyResult;
  activePriorPublication: AflTradeFreshnessActivePriorPublication | null;
  failedCandidate: AflTradeFreshnessFailedCandidate | null;
  evaluatedAt: string;
}): AflTradeFreshnessEvaluation {
  const policy = input.policyBinding.freshnessPolicy;
  const policyContent = policy.content;
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  const createdAtMs = Date.parse(policyContent.createdAt);
  if (createdAtMs > evaluatedAtMs) throw policyError('NON_MONOTONIC_CHRONOLOGY');

  const active = input.activePriorPublication;
  const failed = input.failedCandidate;
  if (active) {
    if (active.scopeKey !== policyContent.scopeKey) throw policyError('POLICY_SCOPE_MISMATCH');
    if (active.publication.valueUnitId !== policyContent.valueUnitId) {
      throw policyError('POLICY_VALUE_UNIT_MISMATCH');
    }
    const calculationAsOfMs = Date.parse(active.calculationAsOf);
    const publishedAtMs = Date.parse(active.publication.publishedAt);
    if (calculationAsOfMs > publishedAtMs || publishedAtMs > evaluatedAtMs) {
      throw policyError('NON_MONOTONIC_CHRONOLOGY');
    }
  }
  if (failed) {
    if (failed.scopeKey !== policyContent.scopeKey) throw policyError('CANDIDATE_SCOPE_MISMATCH');
    if (failed.valueUnitId !== policyContent.valueUnitId) {
      throw policyError('CANDIDATE_VALUE_UNIT_MISMATCH');
    }
    if (active && failed.candidatePublicationId === active.publication.publicationId) {
      throw policyError('CANDIDATE_MATCHES_ACTIVE_PUBLICATION');
    }
    const startedAtMs = Date.parse(failed.startedAt);
    const failedAtMs = Date.parse(failed.failedAt);
    if (startedAtMs > failedAtMs || failedAtMs > evaluatedAtMs) {
      throw policyError('NON_MONOTONIC_CHRONOLOGY');
    }
  }

  if (!active) {
    const output = aflTradeFreshnessEvaluationSchema.safeParse({
      schemaVersion: 'afl-trade-publication-freshness-evaluation/v1',
      freshnessPolicyId: policy.freshnessPolicyId,
      scopeKey: policyContent.scopeKey,
      valueUnitId: policyContent.valueUnitId,
      evaluatedAt: input.evaluatedAt,
      activePublicationId: null,
      projectionBuildId: null,
      registryRevision: null,
      calculationAsOf: null,
      staleAfter: null,
      serveUntil: null,
      freshness: 'unavailable',
      servingDecision: 'do_not_serve',
      retentionDecision: failed ? 'retention_denied' : 'not_applicable',
      failedCandidatePublicationId: failed?.candidatePublicationId ?? null,
      warnings: failed ? [warning('candidate_refresh_failed_no_active_prior')] : [],
      operatorAction: failed ? 'investigate_candidate_failure' : 'stop_serving_and_refresh',
      nextDeadline: null,
      publicationAuthority: AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY,
      runtimeMutation: AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION,
    });
    if (!output.success) throw policyError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(output.data);
  }

  const calculationAsOfMs = Date.parse(active.calculationAsOf);
  const staleAfterMs = addSeconds(calculationAsOfMs, policyContent.currentDurationSeconds);
  const serveUntilMs = addSeconds(staleAfterMs, policyContent.staleServeDurationSeconds);
  const freshness =
    evaluatedAtMs < staleAfterMs ? 'current' : evaluatedAtMs <= serveUntilMs ? 'stale' : 'expired';
  const servable = freshness === 'current' || freshness === 'stale';
  const warnings = [] as Array<ReturnType<typeof warning>>;
  if (freshness === 'stale') warnings.push(warning('active_publication_stale'));
  if (freshness === 'expired') warnings.push(warning('active_publication_expired'));
  if (failed && servable) {
    warnings.push(warning('candidate_refresh_failed_prior_publication_retained'));
  }
  const operatorAction = failed
    ? servable
      ? 'investigate_candidate_failure'
      : 'stop_serving_and_refresh'
    : freshness === 'current'
      ? 'none'
      : freshness === 'stale'
        ? 'refresh_active_publication'
        : 'stop_serving_and_refresh';
  const output = aflTradeFreshnessEvaluationSchema.safeParse({
    schemaVersion: 'afl-trade-publication-freshness-evaluation/v1',
    freshnessPolicyId: policy.freshnessPolicyId,
    scopeKey: policyContent.scopeKey,
    valueUnitId: policyContent.valueUnitId,
    evaluatedAt: input.evaluatedAt,
    activePublicationId: active.publication.publicationId,
    projectionBuildId: active.projectionBuildId,
    registryRevision: active.registryRevision,
    calculationAsOf: active.calculationAsOf,
    staleAfter: asIso(staleAfterMs),
    serveUntil: asIso(serveUntilMs),
    freshness,
    servingDecision: servable ? 'serve_active_prior' : 'do_not_serve',
    retentionDecision: failed
      ? servable
        ? 'retain_active_prior'
        : 'retention_denied'
      : 'not_applicable',
    failedCandidatePublicationId: failed?.candidatePublicationId ?? null,
    warnings,
    operatorAction,
    nextDeadline:
      freshness === 'current'
        ? asIso(staleAfterMs)
        : freshness === 'stale'
          ? asIso(serveUntilMs)
          : null,
    publicationAuthority: AFL_TRADE_FRESHNESS_POLICY_PUBLICATION_AUTHORITY,
    runtimeMutation: AFL_TRADE_FRESHNESS_POLICY_RUNTIME_MUTATION,
  });
  if (!output.success) throw policyError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  return deepFreeze(output.data);
}

export function evaluateAflTradePublicationFreshness(
  unparsedInput: unknown
): AflTradeFreshnessEvaluation {
  try {
    const input = snapshotExactEnvelope(unparsedInput, EVALUATE_KEYS);
    if (input === null) throw policyError('INVALID_EVALUATION_ENVELOPE');
    const policyBinding = safeParse(
      aflTradeFreshnessPolicyBindingStructuralSchema,
      input.policyBinding
    );
    if (policyBinding === null) throw policyError('INVALID_POLICY_BINDING');
    assertBindingReference(policyBinding);
    const activePriorPublication =
      input.activePriorPublication === null
        ? null
        : safeParse(aflTradeFreshnessActivePriorPublicationSchema, input.activePriorPublication);
    if (input.activePriorPublication !== null && activePriorPublication === null) {
      throw policyError('INVALID_ACTIVE_PUBLICATION');
    }
    const failedCandidate =
      input.failedCandidate === null
        ? null
        : safeParse(aflTradeFreshnessFailedCandidateSchema, input.failedCandidate);
    if (input.failedCandidate !== null && failedCandidate === null) {
      throw policyError('INVALID_FAILED_CANDIDATE');
    }
    if (typeof input.clock !== 'function') throw policyError('INVALID_CLOCK');
    let clockValue: unknown;
    try {
      clockValue = Reflect.apply(input.clock, undefined, []);
    } catch {
      throw policyError('INVALID_CLOCK');
    }
    const evaluatedAt = safeParse(aflTradeIsoDateTimeSchema, clockValue);
    if (evaluatedAt === null) throw policyError('INVALID_CLOCK');
    return evaluateAt({ policyBinding, activePriorPublication, failedCandidate, evaluatedAt });
  } catch (error) {
    if (isAflTradeFreshnessPolicyError(error)) throw error;
    throw policyError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_EVALUATION_KEYS = [
  'policyBinding',
  'activePriorPublication',
  'failedCandidate',
  'evaluatedAt',
  'output',
] as const;

export function verifyAflTradePublicationFreshnessEvaluation(value: unknown): boolean {
  const input = snapshotExactEnvelope(value, VERIFY_EVALUATION_KEYS);
  if (input === null) return false;
  const policyBinding = safeParse(
    aflTradeFreshnessPolicyBindingStructuralSchema,
    input.policyBinding
  );
  const activePriorPublication =
    input.activePriorPublication === null
      ? null
      : safeParse(aflTradeFreshnessActivePriorPublicationSchema, input.activePriorPublication);
  const failedCandidate =
    input.failedCandidate === null
      ? null
      : safeParse(aflTradeFreshnessFailedCandidateSchema, input.failedCandidate);
  const evaluatedAt = safeParse(aflTradeIsoDateTimeSchema, input.evaluatedAt);
  const supplied = safeParse(aflTradeFreshnessEvaluationSchema, input.output);
  if (
    policyBinding === null ||
    (input.activePriorPublication !== null && activePriorPublication === null) ||
    (input.failedCandidate !== null && failedCandidate === null) ||
    evaluatedAt === null ||
    supplied === null
  ) {
    return false;
  }
  try {
    assertBindingReference(policyBinding);
    const expected = evaluateAt({
      policyBinding,
      activePriorPublication,
      failedCandidate,
      evaluatedAt,
    });
    return canonicalizeAflTradeJson(supplied) === canonicalizeAflTradeJson(expected);
  } catch {
    return false;
  }
}

export type AflTradeFreshnessPolicyArtifactRef = AflTradeArtifactRef;
