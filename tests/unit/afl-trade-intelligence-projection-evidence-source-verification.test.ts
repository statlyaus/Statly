// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_DEPTH,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_TOTAL_SOURCE_BYTES,
  AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION,
  AflTradeProjectionEvidenceSourceVerificationConstructionError,
  aflTradeProjectionEvidenceSourceArtifactSchema,
  aflTradeProjectionEvidenceSourceVerificationContentSchema,
  createAflTradeProjectionEvidenceSourceVerification,
  isAflTradeProjectionEvidenceSourceVerificationConstructionError,
  verifyAflTradeProjectionEvidenceSourceVerification,
  type AflTradeProjectionEvidenceSourceArtifact,
  type AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode,
} from '@/server/aflTradeIntelligence/publication/projectionEvidenceSourceVerification';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  createAflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceContent,
  type AflTradeProjectionPublicEvidenceResult,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradeTemporalContext,
} from '@/types/aflTradeIntelligence';

const MATERIALIZED_AT = '2026-08-06T00:00:00.000Z';
const SOURCE_ARTIFACT_AT = '2026-08-05T00:00:00.000Z';
const VERIFIED_AT = '2026-08-07T00:00:00.000Z';
const HISTORICAL_EFFECTIVE_AT = '2020-11-10T00:00:00.000Z';
const HISTORICAL_KNOWN_AT = '2020-11-11T00:00:00.000Z';

const SOURCE_ROLES = [
  'confidence',
  'coverage',
  'asset_identity',
  'lineage_frontier',
  'factor',
] as const;
type SourceRole = (typeof SOURCE_ROLES)[number];

const TEMPORAL_CONTEXTS: Readonly<Record<string, AflTradeTemporalContext>> = {
  at_trade: {
    effectiveAt: '2020-11-12T00:00:00.000Z',
    knowledgeCutoffAt: '2020-11-11T23:59:59.000Z',
    valuationAsOf: '2020-11-12T00:00:00.000Z',
  },
  realized: {
    effectiveAt: SOURCE_ARTIFACT_AT,
    knowledgeCutoffAt: SOURCE_ARTIFACT_AT,
    valuationAsOf: SOURCE_ARTIFACT_AT,
  },
  remaining: {
    effectiveAt: SOURCE_ARTIFACT_AT,
    knowledgeCutoffAt: SOURCE_ARTIFACT_AT,
    valuationAsOf: SOURCE_ARTIFACT_AT,
  },
  current: {
    effectiveAt: SOURCE_ARTIFACT_AT,
    knowledgeCutoffAt: SOURCE_ARTIFACT_AT,
    valuationAsOf: SOURCE_ARTIFACT_AT,
  },
};

const CLAIM_COUNTS: Readonly<Record<SourceRole, number>> = {
  confidence: AFL_TRADE_VALUATION_VIEWS.length * AFL_TRADE_CONFIDENCE_DIMENSIONS.length,
  coverage: AFL_TRADE_VALUATION_VIEWS.length,
  asset_identity: 1,
  lineage_frontier: 1,
  factor: AFL_TRADE_VALUATION_VIEWS.length,
};

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function claim(role: SourceRole, index: number) {
  const locator = `record:${role}:${index}`;
  if (role === 'factor') {
    const value = { role, index, escaped: true };
    return {
      locator,
      fieldPath: '/claims/a~1b/~0value/0',
      value,
      record: {
        locator,
        claims: { 'a/b': { '~value': [value] } },
      },
    };
  }
  const value = { role, index };
  return {
    locator,
    fieldPath: '/claims/value',
    value,
    record: { locator, claims: { value } },
  };
}

function sourceFor(
  role: SourceRole,
  suffix: string = role
): AflTradeProjectionEvidenceSourceArtifact {
  const semanticArtifactId = semanticId('source-fixture', suffix);
  const sourceArtifact = {
    sourceArtifactId: semanticArtifactId,
    content: {
      schemaVersion: 'afl-trade-source-fixture/v1',
      records: Array.from({ length: CLAIM_COUNTS[role] }, (_, index) => claim(role, index).record),
    },
  };
  return aflTradeProjectionEvidenceSourceArtifactSchema.parse({
    sourceSchemaVersion: 'afl-trade-source-fixture/v1',
    semanticArtifactId,
    sourceArtifact,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(sourceArtifact, SOURCE_ARTIFACT_AT),
  });
}

function sourcesForAllRoles(): AflTradeProjectionEvidenceSourceArtifact[] {
  return SOURCE_ROLES.map((role) => sourceFor(role));
}

function sourceByRole(
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[],
  role: SourceRole
) {
  const source = sources[SOURCE_ROLES.indexOf(role)];
  if (source === undefined) throw new Error(`Missing fixture source for ${role}.`);
  return source;
}

function sourceBinding<Role extends SourceRole>(
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[],
  sourceRole: Role,
  index: number
) {
  const source = sourceByRole(sources, sourceRole);
  const selectedClaim = claim(sourceRole, index);
  return {
    sourceRole,
    sourceSchemaVersion: source.sourceSchemaVersion,
    semanticArtifactId: source.semanticArtifactId,
    artifactRef: source.artifactRef,
    recordLocator: selectedClaim.locator,
    fieldPath: selectedClaim.fieldPath,
    claimedValueSha256: sha256AflTradeCanonicalJson(selectedClaim.value),
    sourceEffectiveAt: HISTORICAL_EFFECTIVE_AT,
    sourceKnownAt: HISTORICAL_KNOWN_AT,
  };
}

function evidenceContent(
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[]
): AflTradeProjectionPublicEvidenceContent {
  const viewContexts = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
  }));
  return {
    schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
    publicationId: semanticId('publication', 'fixture-publication'),
    valuationBundleId: semanticId('valuation-bundle', 'fixture-bundle'),
    valuationOutputInventoryIndexId: semanticId(
      'valuation-output-inventory-index',
      'fixture-index'
    ),
    valuationOutputInventoryId: semanticId('valuation-output-inventory', 'fixture-inventory'),
    valuationCaseId: semanticId('valuation-case', 'fixture-case'),
    valuationCalculationId: semanticId('valuation-calculation', 'fixture-calculation'),
    tradeId: 'trade:fixture-source-verification',
    scopeKey: 'scope:source-verification',
    valueUnitId: 'football-value:v1',
    materializedAt: MATERIALIZED_AT,
    viewContexts,
    confidenceByView: AFL_TRADE_VALUATION_VIEWS.map((view, viewIndex) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      overallLevel: 'moderate' as const,
      dimensions: AFL_TRADE_CONFIDENCE_DIMENSIONS.map((dimension, dimensionIndex) => ({
        dimension,
        level: dimensionIndex === 0 ? ('moderate' as const) : ('high' as const),
        reasonCode: `supported:${dimension}`,
        explanation: `The ${dimension} dimension has a directly bound source claim.`,
        sourceBindings: [
          sourceBinding(
            sources,
            'confidence',
            viewIndex * AFL_TRADE_CONFIDENCE_DIMENSIONS.length + dimensionIndex
          ),
        ],
      })),
    })),
    coverageByView: AFL_TRADE_VALUATION_VIEWS.map((view, index) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      status: 'complete' as const,
      totalAssetCount: 1,
      valuedAssetCount: 1,
      excludedAssetCount: 0 as const,
      excludedRoots: [],
      sourceBindings: [sourceBinding(sources, 'coverage', index)],
    })),
    assets: [
      {
        assetId: 'asset:player',
        assetKind: 'player',
        label: 'AFL player',
        receivedByAflClubId: 'afl-club:alpha',
        identitySourceBindings: [sourceBinding(sources, 'asset_identity', 0)],
        lineage: {
          status: 'resolved',
          rootAssetId: 'asset:player',
          creditedAssetIds: ['asset:player'],
          summary: 'The source-native player identity is resolved.',
          edgeCount: 0,
          maximumDepth: 0,
          sourceBindings: [sourceBinding(sources, 'lineage_frontier', 0)],
        },
      },
    ],
    factorsByView: AFL_TRADE_VALUATION_VIEWS.map((view, index) => ({
      view,
      temporalContext: TEMPORAL_CONTEXTS[view],
      factors: [
        {
          kind: 'positive' as const,
          code: 'verified-upside',
          label: 'Verified upside',
          explanation: 'A direct public source claim supports football-value upside.',
          sourceBindings: [sourceBinding(sources, 'factor', index)],
        },
      ],
    })),
    predecessorPolicy: {
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
    },
    limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  };
}

function evidenceResult(
  sources: readonly AflTradeProjectionEvidenceSourceArtifact[]
): AflTradeProjectionPublicEvidenceResult {
  return createAflTradeProjectionPublicEvidence({
    content: evidenceContent(sources),
    materializedAt: MATERIALIZED_AT,
  });
}

function fixture() {
  const sourceArtifacts = sourcesForAllRoles();
  return {
    projectionPublicEvidenceResult: evidenceResult(sourceArtifacts),
    sourceArtifacts,
    verifiedAt: VERIFIED_AT,
  };
}

function evidenceWithMutation(
  input: ReturnType<typeof fixture>,
  mutate: (content: AflTradeProjectionPublicEvidenceContent) => void
) {
  const content = structuredClone(
    input.projectionPublicEvidenceResult.projectionPublicEvidence.content
  );
  mutate(content);
  return createAflTradeProjectionPublicEvidence({ content, materializedAt: MATERIALIZED_AT });
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeProjectionEvidenceSourceVerificationConstructionError(error)).toBe(true);
    if (isAflTradeProjectionEvidenceSourceVerificationConstructionError(error)) {
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('private');
      expect(error.toJSON()).toEqual({ name: error.name, code, message: error.message });
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(error.toJSON())).toBe(true);
    }
  }
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((entry) => isDeeplyFrozen(entry, seen))
  );
}

describe('AFL trade projection evidence source verification', () => {
  it('passes exact authenticated sources for all five roles and resolves escaped RFC 6901 paths', () => {
    const input = fixture();
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const content = result.projectionEvidenceSourceVerification.content;

    expect(content.status).toBe('passed');
    expect(content.observedFailureCount).toBe(0);
    expect(content.reportedFailureCount).toBe(0);
    expect(content.failures).toEqual([]);
    expect(content.failuresTruncated).toBe(false);
    expect(content.sourceArtifactCount).toBe(5);
    expect(content.totalSourceArtifactByteLength).toBe(
      input.sourceArtifacts.reduce((sum, source) => sum + source.artifactRef.byteLength, 0)
    );
    expect(content.sourceArtifactSetDigestDefinition).toBe(
      AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION
    );
    expect(content.sourceArtifactSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(content.bindingCount).toBe(30);
    expect(content.roleBindingCounts).toEqual({
      confidence: 20,
      coverage: 4,
      asset_identity: 1,
      lineage_frontier: 1,
      factor: 4,
    });
    expect(content.checkCount).toBeGreaterThan(content.bindingCount);
    expect(verifyAflTradeProjectionEvidenceSourceVerification({ ...input, output: result })).toBe(
      true
    );
  });

  it('fails when a record locator is globally absent or ambiguous', () => {
    const absent = fixture();
    const absentResult = createAflTradeProjectionEvidenceSourceVerification({
      ...absent,
      projectionPublicEvidenceResult: evidenceWithMutation(absent, (content) => {
        content.coverageByView[0].sourceBindings[0].recordLocator = 'record:missing';
      }),
    });
    expect(absentResult.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({ code: 'RECORD_LOCATOR_NOT_UNIQUE', sourceRole: 'coverage' })
    );

    const ambiguous = fixture();
    const coverage = ambiguous.sourceArtifacts[1];
    const sourceArtifact = coverage.sourceArtifact as {
      content: { records: unknown[] };
    };
    sourceArtifact.content.records.push({
      locator: 'record:coverage:0',
      claims: { value: { role: 'coverage', index: 0 } },
    });
    const ambiguousResult = createAflTradeProjectionEvidenceSourceVerification(ambiguous);
    expect(ambiguousResult.projectionEvidenceSourceVerification.content.status).toBe('failed');
    expect(ambiguousResult.projectionEvidenceSourceVerification.content.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_ARTIFACT_REFERENCE_MISMATCH' }),
        expect.objectContaining({ code: 'RECORD_LOCATOR_NOT_UNIQUE' }),
      ])
    );
  });

  it('fails closed for missing sources and supplied sources outside the evidence identity set', () => {
    const input = fixture();
    input.sourceArtifacts.splice(1, 1);
    input.sourceArtifacts.push(sourceFor('coverage', 'unused-coverage-source'));
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const failures = result.projectionEvidenceSourceVerification.content.failures;

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_MISSING', sourceRole: 'coverage' }),
        expect.objectContaining({ code: 'SOURCE_UNUSED', sourceRole: null }),
      ])
    );
  });

  it('distinguishes an unresolved RFC 6901 pointer from a selected-value digest mismatch', () => {
    const pointerInput = fixture();
    const pointerResult = createAflTradeProjectionEvidenceSourceVerification({
      ...pointerInput,
      projectionPublicEvidenceResult: evidenceWithMutation(pointerInput, (content) => {
        content.factorsByView[0].factors[0].sourceBindings[0].fieldPath =
          '/claims/a~1b/~0missing/0';
      }),
    });
    expect(pointerResult.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({ code: 'FIELD_PATH_UNRESOLVED', sourceRole: 'factor' })
    );

    const digestInput = fixture();
    const digestResult = createAflTradeProjectionEvidenceSourceVerification({
      ...digestInput,
      projectionPublicEvidenceResult: evidenceWithMutation(digestInput, (content) => {
        content.assets[0].identitySourceBindings[0].claimedValueSha256 = '0'.repeat(64);
      }),
    });
    expect(digestResult.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({
        code: 'CLAIMED_VALUE_DIGEST_MISMATCH',
        sourceRole: 'asset_identity',
      })
    );
  });

  it('checks declared and owning schema versions plus exactly one top-level semantic identity', () => {
    const input = fixture();
    input.sourceArtifacts[0].sourceSchemaVersion = 'afl-trade-source-fixture/v2';
    const sourceArtifact = input.sourceArtifacts[2].sourceArtifact as Record<string, unknown>;
    sourceArtifact.sourceArtifactId = 'source-fixture:'.concat('0'.repeat(64));
    const result = createAflTradeProjectionEvidenceSourceVerification(input);

    expect(result.projectionEvidenceSourceVerification.content.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_SCHEMA_VERSION_MISMATCH' }),
        expect.objectContaining({ code: 'SOURCE_SEMANTIC_IDENTITY_MISMATCH' }),
      ])
    );
  });

  it('rejects duplicate source semantic identities and duplicate artifact-reference identities', () => {
    const identityInput = fixture();
    const duplicateIdentity = structuredClone(identityInput.sourceArtifacts[0]);
    duplicateIdentity.sourceArtifact = {
      ...duplicateIdentity.sourceArtifact,
      duplicateOrdinal: 1,
    };
    duplicateIdentity.artifactRef = createAflTradeCanonicalJsonArtifactRef(
      duplicateIdentity.sourceArtifact,
      SOURCE_ARTIFACT_AT
    );
    identityInput.sourceArtifacts.push(duplicateIdentity);
    const identityResult = createAflTradeProjectionEvidenceSourceVerification(identityInput);
    expect(identityResult.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_SOURCE_IDENTITY' })
    );

    const referenceInput = fixture();
    const duplicateReference = structuredClone(referenceInput.sourceArtifacts[1]);
    duplicateReference.semanticArtifactId = semanticId('source-fixture', 'other-identity');
    duplicateReference.artifactRef = referenceInput.sourceArtifacts[0].artifactRef;
    referenceInput.sourceArtifacts.push(duplicateReference);
    const referenceResult = createAflTradeProjectionEvidenceSourceVerification(referenceInput);
    expect(referenceResult.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_SOURCE_ARTIFACT_REFERENCE' })
    );
  });

  it('fails chronology when evidence or a supplied source artifact postdates verification', () => {
    const input = fixture();
    input.verifiedAt = '2026-08-04T00:00:00.000Z';
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const codes = result.projectionEvidenceSourceVerification.content.failures.map(
      ({ code }) => code
    );

    expect(codes[0]).toBe('EVIDENCE_AFTER_VERIFICATION');
    expect(codes).toContain('SOURCE_ARTIFACT_AFTER_VERIFICATION');
  });

  it('returns deterministic stable failed reports and preserves issue order across source order', () => {
    const input = fixture();
    input.sourceArtifacts.splice(1, 1);
    input.sourceArtifacts.push(sourceFor('coverage', 'unused-stable-source'));
    const first = createAflTradeProjectionEvidenceSourceVerification(input);
    const second = createAflTradeProjectionEvidenceSourceVerification({
      ...input,
      sourceArtifacts: [...input.sourceArtifacts].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.projectionEvidenceSourceVerification.content.status).toBe('failed');
    expect(first.projectionEvidenceSourceVerification.content.reportedFailureCount).toBe(
      first.projectionEvidenceSourceVerification.content.failures.length
    );
    expect(first.projectionEvidenceSourceVerification.content.observedFailureCount).toBe(
      first.projectionEvidenceSourceVerification.content.reportedFailureCount
    );
  });

  it('uses a total commitment order when duplicate legacy sort keys tie', () => {
    const input = fixture();
    const tied = structuredClone(input.sourceArtifacts[0]);
    tied.sourceSchemaVersion = 'afl-trade-source-fixture/v2';
    tied.sourceArtifact = { ...tied.sourceArtifact, tiedBody: 'different-observed-bytes' };
    input.sourceArtifacts.push(tied);

    const forward = createAflTradeProjectionEvidenceSourceVerification(input);
    const reversed = createAflTradeProjectionEvidenceSourceVerification({
      ...input,
      sourceArtifacts: [...input.sourceArtifacts].reverse(),
    });

    expect(reversed).toEqual(forward);
    expect(forward.projectionEvidenceSourceVerification.content.status).toBe('failed');
    expect(forward.projectionEvidenceSourceVerification.content.failures).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_SCHEMA_VERSION_MISMATCH' })
    );
  });

  it('caps the first thousand failures and declares truncation without losing failed status', () => {
    const input = fixture();
    const source = input.sourceArtifacts[0];
    input.sourceArtifacts = Array.from({ length: 1_001 }, (_, index) => {
      const duplicate = structuredClone(source);
      duplicate.sourceArtifact = { ...duplicate.sourceArtifact, duplicateOrdinal: index };
      duplicate.artifactRef = createAflTradeCanonicalJsonArtifactRef(
        duplicate.sourceArtifact,
        SOURCE_ARTIFACT_AT
      );
      return duplicate;
    });
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const content = result.projectionEvidenceSourceVerification.content;

    expect(content.status).toBe('failed');
    expect(content.observedFailureCount).toBe(2_032);
    expect(content.reportedFailureCount).toBe(
      AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES
    );
    expect(content.failures).toHaveLength(
      AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES
    );
    expect(content.failuresTruncated).toBe(true);
    expect(new Set(content.failures.map(({ code }) => code))).toEqual(
      new Set(['DUPLICATE_SOURCE_IDENTITY'])
    );
  });

  it('content-addresses and authenticates a bounded deeply frozen report and exact evidence binding', () => {
    const input = fixture();
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const report = result.projectionEvidenceSourceVerification;

    expect(report.projectionEvidenceSourceVerificationId).toBe(
      createAflTradeContentAddress('projection-evidence-source-verification', report.content)
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        result.projectionEvidenceSourceVerificationArtifactRef,
        report
      )
    ).toBe(true);
    expect(result.projectionEvidenceSourceVerificationArtifactRef.createdAt).toBe(VERIFIED_AT);
    expect(result.projectionEvidenceSourceVerificationArtifactRef.byteLength).toBeLessThanOrEqual(
      1024 * 1024
    );
    expect(report.content.projectionPublicEvidence).toEqual({
      schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
      projectionPublicEvidenceId:
        input.projectionPublicEvidenceResult.projectionPublicEvidence.projectionPublicEvidenceId,
      artifactRef: input.projectionPublicEvidenceResult.projectionPublicEvidenceArtifactRef,
    });
    expect(isDeeplyFrozen(result)).toBe(true);
  });

  it('uses branded construction errors for exact invalid envelopes and rejects forged errors', () => {
    const input = fixture();
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(null),
      'INVALID_INPUT_ENVELOPE'
    );
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification({ ...input, extra: true }),
      'INVALID_INPUT_ENVELOPE'
    );
    expectConstructionError(
      () =>
        createAflTradeProjectionEvidenceSourceVerification({
          ...input,
          projectionPublicEvidenceResult: {},
        }),
      'INVALID_EVIDENCE_RESULT'
    );
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification({ ...input, sourceArtifacts: null }),
      'INVALID_SOURCE_ARTIFACTS'
    );
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification({ ...input, verifiedAt: 'latest' }),
      'INVALID_VERIFIED_AT'
    );
    expect(
      isAflTradeProjectionEvidenceSourceVerificationConstructionError({
        name: 'AflTradeProjectionEvidenceSourceVerificationConstructionError',
        code: 'INVALID_INPUT_ENVELOPE',
      })
    ).toBe(false);
    expect(
      new AflTradeProjectionEvidenceSourceVerificationConstructionError('INVALID_INPUT_ENVELOPE')
        .message
    ).toBe('The evidence-source-verification input envelope is invalid.');
  });

  it('classifies per-source size, aggregate size, depth, and node limit breaches exactly', () => {
    const oversized = fixture();
    oversized.sourceArtifacts[0].sourceArtifact = {
      sourceArtifactId: oversized.sourceArtifacts[0].semanticArtifactId,
      content: {
        schemaVersion: 'afl-trade-source-fixture/v1',
        payload: 'x'.repeat(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES),
      },
    };
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(oversized),
      'SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED'
    );

    const tooDeep = fixture();
    let nested: Record<string, unknown> = { terminal: true };
    for (
      let depth = 0;
      depth <= AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_DEPTH;
      depth += 1
    ) {
      nested = { nested };
    }
    tooDeep.sourceArtifacts[0].sourceArtifact = {
      sourceArtifactId: tooDeep.sourceArtifacts[0].semanticArtifactId,
      content: { schemaVersion: 'afl-trade-source-fixture/v1', nested },
    };
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(tooDeep),
      'SOURCE_ARTIFACT_DEPTH_LIMIT_EXCEEDED'
    );

    const tooManyNodes = fixture();
    tooManyNodes.sourceArtifacts[0].sourceArtifact = {
      nodes: Array.from(
        { length: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES - 1 },
        () => null
      ),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectConstructionError(
        () => createAflTradeProjectionEvidenceSourceVerification(tooManyNodes),
        'SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED'
      );
    }

    const aggregate = fixture();
    const sharedPayload = 'x'.repeat(
      AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES - 1_024
    );
    aggregate.sourceArtifacts = Array.from({ length: 9 }, (_, index) => {
      const source = structuredClone(aggregate.sourceArtifacts[0]);
      source.semanticArtifactId = semanticId('source-fixture', `aggregate:${index}`);
      source.sourceArtifact = {
        sourceArtifactId: source.semanticArtifactId,
        content: {
          schemaVersion: 'afl-trade-source-fixture/v1',
          payload: sharedPayload,
        },
      };
      return source;
    });
    expect(
      aggregate.sourceArtifacts.length *
        (AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES - 1_024)
    ).toBeGreaterThan(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_TOTAL_SOURCE_BYTES);
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(aggregate),
      'TOTAL_SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED'
    );
  }, 60_000);

  it('observes nested descriptors once without invoking getters and rejects non-JSON arrays', () => {
    const hostile = fixture();
    const source = hostile.sourceArtifacts[0];
    const originalBody = source.sourceArtifact as Record<string, unknown>;
    let descriptorReads = 0;
    let valueGetterReads = 0;
    const statefulTarget = { claim: 'descriptor-snapshot' };
    const statefulProxy = new Proxy(statefulTarget, {
      getOwnPropertyDescriptor(target, property) {
        descriptorReads += 1;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (descriptor === undefined || property !== 'claim') return descriptor;
        return {
          ...descriptor,
          value: descriptorReads === 1 ? 'descriptor-snapshot' : 'changed-descriptor',
        };
      },
      get(target, property, receiver) {
        valueGetterReads += 1;
        if (property === 'claim') return 'getter-value';
        return Reflect.get(target, property, receiver);
      },
    });
    const expectedBody = { ...originalBody, observationProbe: { claim: 'descriptor-snapshot' } };
    source.sourceArtifact = { ...originalBody, observationProbe: statefulProxy };
    source.artifactRef = createAflTradeCanonicalJsonArtifactRef(expectedBody, SOURCE_ARTIFACT_AT);

    const expected = fixture();
    expected.sourceArtifacts[0].sourceArtifact = expectedBody;
    expected.sourceArtifacts[0].artifactRef = source.artifactRef;
    expect(createAflTradeProjectionEvidenceSourceVerification(hostile)).toEqual(
      createAflTradeProjectionEvidenceSourceVerification(expected)
    );
    expect(descriptorReads).toBe(1);
    expect(valueGetterReads).toBe(0);

    const changingLength = fixture();
    const lengthSource = changingLength.sourceArtifacts[0];
    const lengthTarget = ['canonical-element'];
    let arrayGetterReads = 0;
    const arrayProxy = new Proxy(lengthTarget, {
      get(target, property, receiver) {
        arrayGetterReads += 1;
        if (property === 'length') return arrayGetterReads % 2 === 0 ? 0 : 1_000_000;
        if (property === '0') return 'getter-element';
        return Reflect.get(target, property, receiver);
      },
    });
    const expectedLengthBody = {
      ...(lengthSource.sourceArtifact as Record<string, unknown>),
      observationProbe: ['canonical-element'],
    };
    lengthSource.sourceArtifact = {
      ...(lengthSource.sourceArtifact as Record<string, unknown>),
      observationProbe: arrayProxy,
    };
    lengthSource.artifactRef = createAflTradeCanonicalJsonArtifactRef(
      expectedLengthBody,
      SOURCE_ARTIFACT_AT
    );
    const expectedLength = fixture();
    expectedLength.sourceArtifacts[0].sourceArtifact = expectedLengthBody;
    expectedLength.sourceArtifacts[0].artifactRef = lengthSource.artifactRef;
    const lengthResult = createAflTradeProjectionEvidenceSourceVerification(changingLength);
    expect(lengthResult).toEqual(
      createAflTradeProjectionEvidenceSourceVerification(expectedLength)
    );
    expect(arrayGetterReads).toBe(0);

    const accessor = fixture();
    let accessorReads = 0;
    const accessorProbe = Object.defineProperty({}, 'claim', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'accessor-value';
      },
    });
    accessor.sourceArtifacts[0].sourceArtifact = {
      ...accessor.sourceArtifacts[0].sourceArtifact,
      observationProbe: accessorProbe,
    };
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(accessor),
      'INVALID_SOURCE_ARTIFACTS'
    );
    expect(accessorReads).toBe(0);

    const customPrototype = fixture();
    const customArray = ['canonical-element'];
    Object.setPrototypeOf(customArray, {
      map() {
        throw new Error('attacker array method must not run');
      },
    });
    customPrototype.sourceArtifacts[0].sourceArtifact = {
      ...customPrototype.sourceArtifacts[0].sourceArtifact,
      observationProbe: customArray,
    };
    expectConstructionError(
      () => createAflTradeProjectionEvidenceSourceVerification(customPrototype),
      'INVALID_SOURCE_ARTIFACTS'
    );
  });

  it('contains hostile inputs and snapshots creator and replay properties exactly once', () => {
    const input = fixture();
    const throwingGetter = Object.defineProperty({ ...input }, 'sourceArtifacts', {
      enumerable: true,
      get() {
        throw new Error('private source detail');
      },
    });
    const throwingProxy = new Proxy(input, {
      ownKeys() {
        throw new Error('private proxy detail');
      },
    });
    const revoked = Proxy.revocable(input, {});
    revoked.revoke();
    for (const hostile of [throwingGetter, throwingProxy, revoked.proxy]) {
      expectConstructionError(
        () => createAflTradeProjectionEvidenceSourceVerification(hostile),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    let evidenceReads = 0;
    let sourceReads = 0;
    let verifiedAtReads = 0;
    const singleRead = {
      get projectionPublicEvidenceResult() {
        evidenceReads += 1;
        return input.projectionPublicEvidenceResult;
      },
      get sourceArtifacts() {
        sourceReads += 1;
        return input.sourceArtifacts;
      },
      get verifiedAt() {
        verifiedAtReads += 1;
        return input.verifiedAt;
      },
    };
    const output = createAflTradeProjectionEvidenceSourceVerification(singleRead);
    expect([evidenceReads, sourceReads, verifiedAtReads]).toEqual([1, 1, 1]);

    let outputReads = 0;
    const verifyInput = {
      ...input,
      get output() {
        outputReads += 1;
        return output;
      },
    };
    expect(verifyAflTradeProjectionEvidenceSourceVerification(verifyInput)).toBe(true);
    expect(outputReads).toBe(1);
  });

  it('rejects tampered report bytes and replay inputs', () => {
    const input = fixture();
    const output = createAflTradeProjectionEvidenceSourceVerification(input);
    const tampered = structuredClone(output);
    tampered.projectionEvidenceSourceVerification.content.checkCount += 1;

    expect(verifyAflTradeProjectionEvidenceSourceVerification({ ...input, output: tampered })).toBe(
      false
    );
    expect(
      verifyAflTradeProjectionEvidenceSourceVerification({
        ...input,
        verifiedAt: '2026-08-07T00:00:00.001Z',
        output,
      })
    ).toBe(false);
  });

  it('binds failed reports to distinct observed source bodies and rejects cross-input replay', () => {
    const firstInput = fixture();
    firstInput.sourceArtifacts[0].sourceArtifact = {
      ...firstInput.sourceArtifacts[0].sourceArtifact,
      observedMarker: 'a',
    };
    const secondInput = fixture();
    secondInput.sourceArtifacts[0].sourceArtifact = {
      ...secondInput.sourceArtifacts[0].sourceArtifact,
      observedMarker: 'b',
    };

    const first = createAflTradeProjectionEvidenceSourceVerification(firstInput);
    const second = createAflTradeProjectionEvidenceSourceVerification(secondInput);
    expect(first.projectionEvidenceSourceVerification.content.failures).toEqual(
      second.projectionEvidenceSourceVerification.content.failures
    );
    expect(first.projectionEvidenceSourceVerification.content.totalSourceArtifactByteLength).toBe(
      second.projectionEvidenceSourceVerification.content.totalSourceArtifactByteLength
    );
    expect(first.projectionEvidenceSourceVerification.content.sourceArtifactSetSha256).not.toBe(
      second.projectionEvidenceSourceVerification.content.sourceArtifactSetSha256
    );
    expect(
      verifyAflTradeProjectionEvidenceSourceVerification({
        ...secondInput,
        output: first,
      })
    ).toBe(false);
  });

  it('keeps report schemas ownership-free and states the non-owning, non-schema-validation limit', () => {
    const input = fixture();
    const result = createAflTradeProjectionEvidenceSourceVerification(input);
    const content = result.projectionEvidenceSourceVerification.content;

    expect(
      aflTradeProjectionEvidenceSourceVerificationContentSchema.safeParse({
        ...content,
        userId: 'user:fixture',
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionEvidenceSourceArtifactSchema.safeParse({
        ...input.sourceArtifacts[0],
        fantasyTeamId: 'fantasy-team:fixture',
      }).success
    ).toBe(false);
    expect(canonicalizeAflTradeJson(result)).not.toContain('userId');
    expect(canonicalizeAflTradeJson(result)).not.toContain('fantasyTeamId');
    expect(content.limitation).toBe(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION);
    expect(content.limitation).toContain('does not validate each source against its owning schema');
    expect(content.limitation).toContain('establish source rights or claim truth');
    expect(content.limitation).toContain('approve a model or publication');
    expect(content.limitation).toContain('authorize serving');
    expect(content.limitation).toContain('user or fantasy ownership');
  });
});
