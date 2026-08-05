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
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  AflTradeProjectionPublicEvidenceConstructionError,
  aflTradeProjectionPublicEvidenceContentSchema,
  createAflTradeProjectionPublicEvidence,
  isAflTradeProjectionPublicEvidenceConstructionError,
  type AflTradeProjectionPublicEvidenceConstructionErrorCode,
  type AflTradeProjectionPublicEvidenceContent,
  verifyAflTradeProjectionPublicEvidenceDerivation,
} from '@/server/aflTradeIntelligence/publication/projectionPublicEvidence';
import {
  AFL_TRADE_CONFIDENCE_DIMENSIONS,
  AFL_TRADE_VALUATION_VIEWS,
  type AflTradeTemporalContext,
} from '@/types/aflTradeIntelligence';

const AT_TRADE_EFFECTIVE_AT = '2020-11-12T00:00:00.000Z';
const AT_TRADE_KNOWLEDGE_CUTOFF_AT = '2020-11-11T23:59:59.000Z';
const HISTORICAL_SOURCE_EFFECTIVE_AT = '2020-11-10T00:00:00.000Z';
const HISTORICAL_SOURCE_KNOWN_AT = '2020-11-11T00:00:00.000Z';
const CURRENT_AS_OF = '2026-08-05T00:00:00.000Z';
const MATERIALIZED_AT = '2026-08-06T00:00:00.000Z';

type SourceRole = 'confidence' | 'coverage' | 'asset_identity' | 'lineage_frontier' | 'factor';

const TEMPORAL_CONTEXTS: Readonly<Record<string, AflTradeTemporalContext>> = {
  at_trade: {
    effectiveAt: AT_TRADE_EFFECTIVE_AT,
    knowledgeCutoffAt: AT_TRADE_KNOWLEDGE_CUTOFF_AT,
    valuationAsOf: AT_TRADE_EFFECTIVE_AT,
  },
  realized: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
  remaining: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
  current: {
    effectiveAt: CURRENT_AS_OF,
    knowledgeCutoffAt: CURRENT_AS_OF,
    valuationAsOf: CURRENT_AS_OF,
  },
};

function semanticId(prefix: string, label: string): string {
  return `${prefix}:${sha256AflTradeCanonicalJson({ fixtureIdentity: label })}`;
}

function sourceBinding<Role extends SourceRole>(
  sourceRole: Role,
  label: string,
  overrides: Partial<{
    sourceSchemaVersion: string;
    semanticArtifactId: string;
    artifactRef: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
    recordLocator: string;
    fieldPath: string;
    claimedValueSha256: string;
    sourceEffectiveAt: string;
    sourceKnownAt: string;
  }> = {}
) {
  return {
    sourceRole,
    sourceSchemaVersion: 'afl-trade-source-fixture/v1',
    semanticArtifactId: semanticId('source-fixture', label),
    artifactRef: createAflTradeCanonicalJsonArtifactRef({ fixtureSource: label }, MATERIALIZED_AT),
    recordLocator: `records:${label}`,
    fieldPath: `/claims/${label}`,
    claimedValueSha256: sha256AflTradeCanonicalJson({ claimedValue: label }),
    sourceEffectiveAt: HISTORICAL_SOURCE_EFFECTIVE_AT,
    sourceKnownAt: HISTORICAL_SOURCE_KNOWN_AT,
    ...overrides,
  };
}

function contentFor(): AflTradeProjectionPublicEvidenceContent {
  const viewContexts = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
  }));
  const confidenceByView = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
    overallLevel: 'moderate' as const,
    dimensions: AFL_TRADE_CONFIDENCE_DIMENSIONS.map((dimension, index) => ({
      dimension,
      level: index === 0 ? ('moderate' as const) : ('high' as const),
      reasonCode: `supported:${dimension}`,
      explanation: `The ${dimension} dimension is supported by a bound source claim.`,
      sourceBindings: [sourceBinding('confidence', `${view}:${dimension}`)],
    })),
  }));
  const coverageByView = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
    status: 'complete' as const,
    totalAssetCount: 2,
    valuedAssetCount: 2,
    excludedAssetCount: 0 as const,
    excludedRoots: [],
    sourceBindings: [sourceBinding('coverage', `${view}:coverage`)],
  }));
  const factorsByView = AFL_TRADE_VALUATION_VIEWS.map((view) => ({
    view,
    temporalContext: TEMPORAL_CONTEXTS[view],
    factors: [
      {
        kind: 'positive' as const,
        code: 'future-upside',
        label: 'Future upside',
        explanation: 'The public evidence identifies future football-value upside.',
        sourceBindings: [sourceBinding('factor', `${view}:positive`)],
      },
      {
        kind: 'negative' as const,
        code: 'realized-cost',
        label: 'Realized cost',
        explanation: 'The public evidence identifies realized football-value cost.',
        sourceBindings: [sourceBinding('factor', `${view}:negative`)],
      },
      {
        kind: 'uncertainty' as const,
        code: 'outcome-range',
        label: 'Outcome range',
        explanation: 'The public evidence identifies uncertainty in future outcomes.',
        sourceBindings: [sourceBinding('factor', `${view}:uncertainty`)],
      },
    ],
  }));

  return aflTradeProjectionPublicEvidenceContentSchema.parse({
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
    tradeId: 'trade:fixture-public-evidence',
    scopeKey: 'scope:public-evidence',
    valueUnitId: 'football-value:v1',
    materializedAt: MATERIALIZED_AT,
    viewContexts,
    confidenceByView,
    coverageByView,
    assets: [
      {
        assetId: 'asset:future-pick',
        assetKind: 'future_pick_entitlement',
        label: 'Future first-round selection entitlement',
        receivedByAflClubId: 'afl-club:alpha',
        identitySourceBindings: [sourceBinding('asset_identity', 'asset:future-pick')],
        lineage: {
          status: 'partial',
          rootAssetId: 'asset:future-pick',
          creditedAssetIds: ['asset:future-pick', 'asset:selected-player'],
          summary: 'The entitlement and selected player are credited exactly once.',
          edgeCount: 1,
          maximumDepth: 1,
          sourceBindings: [sourceBinding('lineage_frontier', 'asset:future-pick')],
        },
      },
      {
        assetId: 'asset:player',
        assetKind: 'player',
        label: 'AFL player',
        receivedByAflClubId: 'afl-club:beta',
        identitySourceBindings: [sourceBinding('asset_identity', 'asset:player')],
        lineage: {
          status: 'resolved',
          rootAssetId: 'asset:player',
          creditedAssetIds: ['asset:player'],
          summary: 'The player identity and receiving club are resolved.',
          edgeCount: 0,
          maximumDepth: 0,
          sourceBindings: [sourceBinding('lineage_frontier', 'asset:player')],
        },
      },
    ],
    factorsByView,
    predecessorPolicy: {
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_RUNTIME_FALLBACK,
    },
    limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_LIMITATION,
  });
}

function createInput(content = contentFor()) {
  return { content, materializedAt: MATERIALIZED_AT };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeProjectionPublicEvidenceConstructionErrorCode
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isAflTradeProjectionPublicEvidenceConstructionError(error)).toBe(true);
    if (isAflTradeProjectionPublicEvidenceConstructionError(error)) {
      expect(error.code).toBe(code);
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

describe('AFL trade projection public evidence', () => {
  it('constructs and replays exact four-view public evidence with late artifacts and historical source claims', () => {
    const input = createInput();
    const output = createAflTradeProjectionPublicEvidence(input);

    expect(output.projectionPublicEvidence.content.viewContexts.map(({ view }) => view)).toEqual(
      AFL_TRADE_VALUATION_VIEWS
    );
    expect(
      output.projectionPublicEvidence.content.confidenceByView.every(
        ({ dimensions }) =>
          dimensions.map(({ dimension }) => dimension).join('|') ===
          AFL_TRADE_CONFIDENCE_DIMENSIONS.join('|')
      )
    ).toBe(true);
    const atTradeBinding =
      output.projectionPublicEvidence.content.confidenceByView[0].dimensions[0].sourceBindings[0];
    expect(Date.parse(atTradeBinding.artifactRef.createdAt)).toBeGreaterThan(
      Date.parse(AT_TRADE_EFFECTIVE_AT)
    );
    expect(Date.parse(atTradeBinding.sourceKnownAt)).toBeLessThanOrEqual(
      Date.parse(AT_TRADE_KNOWLEDGE_CUTOFF_AT)
    );
    expect(verifyAflTradeProjectionPublicEvidenceDerivation({ ...input, output })).toBe(true);
  });

  it('content-addresses the complete evidence and authenticates its bounded canonical artifact', () => {
    const input = createInput();
    const output = createAflTradeProjectionPublicEvidence(input);
    const evidence = output.projectionPublicEvidence;

    expect(evidence.projectionPublicEvidenceId).toBe(
      createAflTradeContentAddress('projection-public-evidence', evidence.content)
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        output.projectionPublicEvidenceArtifactRef,
        evidence
      )
    ).toBe(true);
    expect(output.projectionPublicEvidenceArtifactRef.createdAt).toBe(MATERIALIZED_AT);
    expect(output.projectionPublicEvidenceArtifactRef.byteLength).toBeGreaterThan(0);
    expect(output.projectionPublicEvidenceArtifactRef.byteLength).toBeLessThanOrEqual(
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES
    );
  });

  it('keeps publication identity while declaring the public no-user-or-fantasy boundary', () => {
    const content = contentFor();

    expect(content.publicationId).toMatch(/^publication:[a-f0-9]{64}$/);
    expect(content.publicAssetBoundary).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(content.limitation).toContain('does not prove upstream derivation');
    expect(content.limitation).toContain('user ownership');
  });

  it('rejects incomplete, misordered, or mismatched canonical view contexts', () => {
    const missing = contentFor();
    missing.viewContexts.pop();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(missing)),
      'INVALID_CONTENT'
    );

    const reversed = contentFor();
    reversed.viewContexts.reverse();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(reversed)),
      'INVALID_CONTENT'
    );

    const mismatched = contentFor();
    mismatched.confidenceByView[0].temporalContext = TEMPORAL_CONTEXTS.current;
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(mismatched)),
      'INVALID_CONTENT'
    );
  });

  it('requires all five confidence dimensions in order and derives overall confidence from the weakest', () => {
    const missing = contentFor();
    missing.confidenceByView[0].dimensions.pop();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(missing)),
      'INVALID_CONTENT'
    );

    const misordered = contentFor();
    misordered.confidenceByView[0].dimensions.reverse();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(misordered)),
      'INVALID_CONTENT'
    );

    const overstated = contentFor();
    overstated.confidenceByView[0].overallLevel = 'high';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(overstated)),
      'INVALID_CONTENT'
    );
  });

  it('accepts honest partial and unavailable coverage with exact excluded roots', () => {
    const partial = contentFor();
    partial.coverageByView[0] = {
      ...partial.coverageByView[0],
      status: 'partial',
      valuedAssetCount: 1,
      excludedAssetCount: 1,
      excludedRoots: [
        {
          rootAssetId: 'asset:player',
          reasonCode: 'source-insufficient',
          message: 'The player cannot be valued from admissible evidence.',
          sourceBindings: [sourceBinding('coverage', 'at_trade:excluded:player')],
        },
      ],
    };
    expect(() => createAflTradeProjectionPublicEvidence(createInput(partial))).not.toThrow();

    const unavailable = contentFor();
    unavailable.coverageByView[0] = {
      ...unavailable.coverageByView[0],
      status: 'unavailable',
      valuedAssetCount: 0,
      excludedAssetCount: 2,
      excludedRoots: ['asset:future-pick', 'asset:player'].map((rootAssetId) => ({
        rootAssetId,
        reasonCode: 'view-unavailable',
        message: 'This traded root is unavailable in the at-trade view.',
        sourceBindings: [sourceBinding('coverage', `at_trade:excluded:${rootAssetId}`)],
      })),
    };
    expect(() => createAflTradeProjectionPublicEvidence(createInput(unavailable))).not.toThrow();
  });

  it('rejects dishonest coverage counts, incomplete exclusions, and noncanonical roots', () => {
    const badCount = contentFor();
    badCount.coverageByView[0].valuedAssetCount = 1;
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(badCount)),
      'INVALID_CONTENT'
    );

    const incomplete = contentFor();
    incomplete.coverageByView[0] = {
      ...incomplete.coverageByView[0],
      status: 'unavailable',
      valuedAssetCount: 0,
      excludedAssetCount: 2,
      excludedRoots: [
        {
          rootAssetId: 'asset:player',
          reasonCode: 'missing',
          message: 'Only one root was disclosed.',
          sourceBindings: [sourceBinding('coverage', 'incomplete')],
        },
      ],
    };
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(incomplete)),
      'INVALID_CONTENT'
    );

    const outsider = contentFor();
    outsider.coverageByView[0] = {
      ...outsider.coverageByView[0],
      status: 'partial',
      valuedAssetCount: 1,
      excludedAssetCount: 1,
      excludedRoots: [
        {
          rootAssetId: 'asset:not-traded',
          reasonCode: 'outsider',
          message: 'This root is not part of the trade.',
          sourceBindings: [sourceBinding('coverage', 'outsider')],
        },
      ],
    };
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(outsider)),
      'INVALID_CONTENT'
    );
  });

  it('requires role-appropriate source bindings with immutable semantic claim coordinates', () => {
    const mutations: Array<(content: AflTradeProjectionPublicEvidenceContent) => void> = [
      (content) => {
        Object.assign(content.confidenceByView[0].dimensions[0].sourceBindings[0], {
          sourceRole: 'factor',
        });
      },
      (content) => {
        content.coverageByView[0].sourceBindings[0].semanticArtifactId = 'mutable-source';
      },
      (content) => {
        content.assets[0].identitySourceBindings[0].fieldPath = 'not-a-json-pointer';
      },
      (content) => {
        content.assets[0].lineage.sourceBindings[0].sourceSchemaVersion = 'latest';
      },
      (content) => {
        content.factorsByView[0].factors[0].sourceBindings[0].claimedValueSha256 = 'bad';
      },
    ];

    for (const mutate of mutations) {
      const content = contentFor();
      mutate(content);
      expectConstructionError(
        () => createAflTradeProjectionPublicEvidence(createInput(content)),
        'INVALID_CONTENT'
      );
    }
  });

  it('requires distinct asset identity and lineage-frontier evidence', () => {
    const noIdentity = contentFor();
    noIdentity.assets[0].identitySourceBindings = [];
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(noIdentity)),
      'INVALID_CONTENT'
    );

    const noLineage = contentFor();
    noLineage.assets[0].lineage.sourceBindings = [];
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(noLineage)),
      'INVALID_CONTENT'
    );

    const wrongLineageRole = contentFor();
    Object.assign(wrongLineageRole.assets[0].lineage.sourceBindings[0], {
      sourceRole: 'asset_identity',
    });
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(wrongLineageRole)),
      'INVALID_CONTENT'
    );
  });

  it('rejects asset root drift, duplicate credited identity, noncanonical roots, and incoherent topology', () => {
    const rootDrift = contentFor();
    rootDrift.assets[0].lineage.rootAssetId = 'asset:player';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(rootDrift)),
      'INVALID_CONTENT'
    );

    const duplicateCredit = contentFor();
    duplicateCredit.assets[1].lineage.creditedAssetIds = ['asset:selected-player'];
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(duplicateCredit)),
      'INVALID_CONTENT'
    );

    const reversedAssets = contentFor();
    reversedAssets.assets.reverse();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(reversedAssets)),
      'INVALID_CONTENT'
    );

    const topology = contentFor();
    topology.assets[1].lineage.maximumDepth = 1;
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(topology)),
      'INVALID_CONTENT'
    );
  });

  it('enforces factor uniqueness by kind plus code and deterministic kind-first ordering', () => {
    const duplicate = contentFor();
    duplicate.factorsByView[0].factors.splice(1, 0, {
      ...duplicate.factorsByView[0].factors[0],
      label: 'Different label cannot hide a duplicate',
      explanation: 'Different prose cannot create a second semantic factor key.',
      sourceBindings: [sourceBinding('factor', 'duplicate-factor')],
    });
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(duplicate)),
      'INVALID_CONTENT'
    );

    const wrongOrder = contentFor();
    wrongOrder.factorsByView[0].factors.reverse();
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(wrongOrder)),
      'INVALID_CONTENT'
    );

    const wrongRole = contentFor();
    Object.assign(wrongRole.factorsByView[0].factors[0].sourceBindings[0], {
      sourceRole: 'confidence',
    });
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(wrongRole)),
      'INVALID_CONTENT'
    );
  });

  it('allows late artifact creation but rejects source-known and source-effective leakage', () => {
    const lateArtifact = contentFor();
    expect(
      Date.parse(
        lateArtifact.confidenceByView[0].dimensions[0].sourceBindings[0].artifactRef.createdAt
      )
    ).toBeGreaterThan(Date.parse(AT_TRADE_EFFECTIVE_AT));
    expect(() => createAflTradeProjectionPublicEvidence(createInput(lateArtifact))).not.toThrow();

    const knownLeak = contentFor();
    knownLeak.confidenceByView[0].dimensions[0].sourceBindings[0].sourceKnownAt =
      '2020-11-12T00:00:00.000Z';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(knownLeak)),
      'INVALID_CONTENT'
    );

    const effectiveLeak = contentFor();
    effectiveLeak.coverageByView[0].sourceBindings[0].sourceEffectiveAt =
      '2020-11-12T00:00:00.001Z';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(effectiveLeak)),
      'INVALID_CONTENT'
    );
  });

  it('applies every view cutoff to shared asset identity and lineage claims', () => {
    const identityLeak = contentFor();
    identityLeak.assets[0].identitySourceBindings[0].sourceKnownAt = '2020-11-12T00:00:00.000Z';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(identityLeak)),
      'INVALID_CONTENT'
    );

    const lineageLeak = contentFor();
    lineageLeak.assets[0].lineage.sourceBindings[0].sourceEffectiveAt = '2020-11-12T00:00:00.001Z';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(lineageLeak)),
      'INVALID_CONTENT'
    );
  });

  it('rejects empty or post-materialization source artifact references', () => {
    const empty = contentFor();
    empty.coverageByView[0].sourceBindings[0].artifactRef.byteLength = 0;
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(empty)),
      'INVALID_CONTENT'
    );

    const future = contentFor();
    future.factorsByView[0].factors[0].sourceBindings[0].artifactRef.createdAt =
      '2026-08-06T00:00:00.001Z';
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(future)),
      'INVALID_CONTENT'
    );
  });

  it('rejects content materialization mismatch and a view that postdates materialization', () => {
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidence({
          content: contentFor(),
          materializedAt: '2026-08-06T00:00:00.001Z',
        }),
      'MATERIALIZED_AT_MISMATCH'
    );

    const futureView = contentFor();
    const futureContext = {
      effectiveAt: '2026-08-07T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-07T00:00:00.000Z',
      valuationAsOf: '2026-08-07T00:00:00.000Z',
    };
    futureView.viewContexts[3].temporalContext = futureContext;
    futureView.confidenceByView[3].temporalContext = futureContext;
    futureView.coverageByView[3].temporalContext = futureContext;
    futureView.factorsByView[3].temporalContext = futureContext;
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(futureView)),
      'INVALID_CONTENT'
    );
  });

  it('rejects evidence whose canonical artifact exceeds one MiB', () => {
    const content = contentFor();
    const largeBindings = <Role extends 'asset_identity' | 'lineage_frontier'>(
      role: Role,
      assetId: string
    ) =>
      Array.from({ length: 8 }, (_, index) =>
        sourceBinding(role, `${assetId}:${index}`, {
          recordLocator: `r${String(index).padStart(3, '0')}${'x'.repeat(496)}`,
          fieldPath: `/${'y'.repeat(499)}`,
        })
      ).sort((left, right) => left.semanticArtifactId.localeCompare(right.semanticArtifactId));
    content.assets = Array.from({ length: 100 }, (_, index) => {
      const assetId = `asset:${String(index).padStart(3, '0')}`;
      return {
        assetId,
        assetKind: 'player' as const,
        label: 'L'.repeat(200),
        receivedByAflClubId: `afl-club:${String(index).padStart(3, '0')}`,
        identitySourceBindings: largeBindings('asset_identity', assetId),
        lineage: {
          status: 'resolved' as const,
          rootAssetId: assetId,
          creditedAssetIds: [assetId],
          summary: 'S'.repeat(1_000),
          edgeCount: 0,
          maximumDepth: 0,
          sourceBindings: largeBindings('lineage_frontier', assetId),
        },
      };
    });
    for (const coverage of content.coverageByView) {
      coverage.totalAssetCount = 100;
      coverage.valuedAssetCount = 100;
    }

    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(createInput(content)),
      'ARTIFACT_SIZE_LIMIT_EXCEEDED'
    );
  });

  it('deep-freezes cloned output without aliasing mutable caller content', () => {
    const input = createInput();
    const output = createAflTradeProjectionPublicEvidence(input);
    const snapshot = canonicalizeAflTradeJson(output);

    input.content.assets[0].label = 'Caller mutation';
    input.content.viewContexts.reverse();

    expect(isDeeplyFrozen(output)).toBe(true);
    expect(canonicalizeAflTradeJson(output)).toBe(snapshot);
    expect(output.projectionPublicEvidence.content.assets[0].label).not.toBe('Caller mutation');
  });

  it('rejects user and fantasy ownership fields at exact envelope and nested content boundaries', () => {
    expectConstructionError(
      () =>
        createAflTradeProjectionPublicEvidence({
          ...createInput(),
          userId: 'user:forbidden',
        }),
      'INVALID_INPUT_ENVELOPE'
    );

    for (const mutate of [
      (content: AflTradeProjectionPublicEvidenceContent) =>
        Object.assign(content, { fantasyTeamId: 'fantasy-team:forbidden' }),
      (content: AflTradeProjectionPublicEvidenceContent) =>
        Object.assign(content.assets[0], { ownerId: 'owner:forbidden' }),
      (content: AflTradeProjectionPublicEvidenceContent) =>
        Object.assign(content.assets[0].identitySourceBindings[0], {
          userId: 'user:forbidden',
        }),
    ]) {
      const content = contentFor();
      mutate(content);
      expectConstructionError(
        () => createAflTradeProjectionPublicEvidence(createInput(content)),
        'INVALID_CONTENT'
      );
    }
  });

  it('contains hostile envelopes, reads exact constructor fields once, and trusts only branded errors', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile-own-keys');
        },
      }
    );
    expectConstructionError(
      () => createAflTradeProjectionPublicEvidence(hostile),
      'INVALID_INPUT_ENVELOPE'
    );

    const input = createInput();
    const reads = new Map<string, number>();
    const exact = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          {
            enumerable: true,
            get() {
              reads.set(key, (reads.get(key) ?? 0) + 1);
              return value;
            },
          },
        ])
      )
    );
    createAflTradeProjectionPublicEvidence(exact);
    expect(reads).toEqual(
      new Map([
        ['content', 1],
        ['materializedAt', 1],
      ])
    );

    const trusted = new AflTradeProjectionPublicEvidenceConstructionError('INVALID_CONTENT');
    expect(isAflTradeProjectionPublicEvidenceConstructionError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(
      isAflTradeProjectionPublicEvidenceConstructionError({
        name: trusted.name,
        code: trusted.code,
        message: trusted.message,
      })
    ).toBe(false);
  });

  it('makes verification total and fail closed for tampering, extra fields, and hostile inputs', () => {
    const input = createInput();
    const output = createAflTradeProjectionPublicEvidence(input);
    const tampered = structuredClone(output);
    tampered.projectionPublicEvidence.content.tradeId = 'trade:tampered';

    expect(verifyAflTradeProjectionPublicEvidenceDerivation({ ...input, output: tampered })).toBe(
      false
    );
    expect(
      verifyAflTradeProjectionPublicEvidenceDerivation({ ...input, output, extra: true })
    ).toBe(false);
    expect(verifyAflTradeProjectionPublicEvidenceDerivation(null)).toBe(false);
    expect(
      verifyAflTradeProjectionPublicEvidenceDerivation(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('hostile-verifier');
            },
          }
        )
      )
    ).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(verifyAflTradeProjectionPublicEvidenceDerivation(revoked.proxy)).toBe(false);
  });
});
