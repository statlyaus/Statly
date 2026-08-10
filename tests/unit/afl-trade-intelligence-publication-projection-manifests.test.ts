// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PUBLICATION_PROJECTION_PAIR_ISSUE_CODES,
  aflTradeProjectionManifestContentSchema,
  aflTradeProjectionManifestSchema,
  aflTradeProjectionManifestV1Schema,
  aflTradeProjectionManifestV2ContentSchema,
  aflTradeProjectionManifestV2Schema,
  aflTradeProjectionPresentationPolicyBindingSchema,
  aflTradeProjectionPublicEvidenceIndexBindingSchema,
  aflTradePublicationManifestContentSchema,
  aflTradePublicationManifestSchema,
  aflTradePublicationManifestV2Schema,
  aflTradePublicationManifestV3ContentSchema,
  aflTradePublicationManifestV3Schema,
  aflTradePublicationProjectionManifestPairSchema,
  validateAflTradePublicationProjectionManifestPair,
  type AflTradeProjectionManifestV2,
  type AflTradeProjectionManifestV2Content,
  type AflTradePublicationManifestV3,
  type AflTradePublicationManifestV3Content,
} from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';

const T0 = '2026-08-05T00:00:00.000Z';
const T1 = '2026-08-05T01:00:00.000Z';
const T2 = '2026-08-05T02:00:00.000Z';
const T3 = '2026-08-05T03:00:00.000Z';
const T4 = '2026-08-05T04:00:00.000Z';
const T5 = '2026-08-05T05:00:00.000Z';
const T6 = '2026-08-05T06:00:00.000Z';
const PUBLIC_BOUNDARY = 'source_native_afl_assets_no_user_or_fantasy_ownership' as const;

function ref(label: string, createdAt = T0) {
  return createAflTradeCanonicalJsonArtifactRef({ fixtureArtifact: label }, createdAt);
}

function legacyRef(label: string) {
  return { ...ref(label), mediaType: 'application/vnd.statly.legacy+json' };
}

function addressPublication<T extends object>(content: T) {
  return {
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  };
}

function addressProjection<T extends object>(content: T) {
  return {
    projectionId: createAflTradeContentAddress('projection', content),
    content,
  };
}

function legacyPublication() {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'non_production' as const,
    scopeKey: 'fixture-legacy-publication',
    createdAt: T3,
    valuationBundleId: `valuation-bundle:${'1'.repeat(64)}`,
    gate3DecisionId: `gate-decision:${'2'.repeat(64)}`,
    sourceRegisterIds: ['register:b', 'register:a'],
    supportedViews: ['current', 'at_trade'] as const,
    supportedCohorts: ['cohort:b', 'cohort:a'],
    excludedCohorts: ['cohort:excluded'],
    valueUnitId: 'statly-value-point',
    entryCount: 0,
    publicationBundleArtifact: legacyRef('legacy-publication-bundle'),
    methodologyArtifact: legacyRef('legacy-methodology'),
    validationReportArtifact: legacyRef('legacy-validation'),
    modelCardArtifact: legacyRef('legacy-model-card'),
  };
  return aflTradePublicationManifestV2Schema.parse(addressPublication(content));
}

function legacyProjection() {
  const content = {
    schemaVersion: 'afl-trade-projection/v1' as const,
    environment: 'non_production' as const,
    scopeKey: 'fixture-legacy-publication',
    createdAt: T4,
    publicationId: legacyPublication().publicationId,
    buildJobId: 'fixture-legacy-build',
    responseContractVersion: 'afl-trade-value/v2' as const,
    documentCount: 0,
    projectionArtifact: legacyRef('legacy-projection'),
    schemaArtifact: legacyRef('legacy-schema'),
    parityReportArtifact: legacyRef('legacy-parity'),
  };
  return aflTradeProjectionManifestV1Schema.parse(addressProjection(content));
}

function indexBinding(entryCount = 1, suffix = 'a') {
  return {
    schemaVersion: 'afl-trade-valuation-output-inventory-index/v1' as const,
    valuationOutputInventoryIndexId: `valuation-output-inventory-index:${suffix.repeat(64)}`,
    artifactRef: ref(`inventory-index-${suffix}`, T1),
    entryCount,
    inventorySetSha256: suffix.repeat(64),
  };
}

function freshnessBinding(suffix = 'b') {
  return {
    schemaVersion: 'afl-trade-publication-freshness-policy/v1' as const,
    freshnessPolicyId: `freshness-policy:${suffix.repeat(64)}`,
    artifactRef: ref(`freshness-${suffix}`, T1),
  };
}

function presentationPolicyBinding(suffix = 'e') {
  return aflTradeProjectionPresentationPolicyBindingSchema.parse({
    schemaVersion: 'afl-trade-projection-presentation-policy/v1',
    projectionPresentationPolicyId: `projection-presentation-policy:${suffix.repeat(64)}`,
    artifactRef: ref(`presentation-policy-${suffix}`, T1),
    valueUnitId: 'statly-value-point',
    universalLayer: 'scarcity_adjusted',
    supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
  });
}

function publicEvidenceIndexBinding(publication: AflTradePublicationManifestV3, suffix = 'f') {
  return aflTradeProjectionPublicEvidenceIndexBindingSchema.parse({
    schemaVersion: 'afl-trade-projection-public-evidence-index/v1',
    projectionPublicEvidenceIndexId: `projection-public-evidence-index:${suffix.repeat(64)}`,
    artifactRef: ref(`public-evidence-index-${suffix}`, T4),
    publicationId: publication.publicationId,
    valuationOutputInventoryIndexId:
      publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: publication.content.scopeKey,
    valueUnitId: publication.content.valueUnitId,
    indexedEvidenceSchemaVersion: 'afl-trade-projection-public-evidence/v1',
    entryCount: publication.content.entryCount,
    evidenceBindingSetSha256: suffix.repeat(64),
  });
}

function publicationV3Content(): AflTradePublicationManifestV3Content {
  return {
    schemaVersion: 'afl-trade-publication/v3',
    environment: 'non_production',
    scopeKey: 'fixture-publication-v3',
    createdAt: T3,
    valuationBundleId: `valuation-bundle:${'3'.repeat(64)}`,
    gate3DecisionId: `gate-decision:${'4'.repeat(64)}`,
    sourceRegisterIds: ['register:a'],
    supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
    supportedCohorts: ['cohort:a'],
    excludedCohorts: [],
    valueUnitId: 'statly-value-point',
    entryCount: 1,
    publicationBundleArtifact: ref('publication-bundle', T2),
    methodologyArtifact: ref('methodology', T0),
    validationReportArtifact: ref('validation', T2),
    modelCardArtifact: ref('model-card', T2),
    publicAssetBoundary: PUBLIC_BOUNDARY,
    valuationOutputInventoryIndex: indexBinding(),
    freshnessPolicy: freshnessBinding(),
    projectionPresentationPolicy: presentationPolicyBinding(),
  };
}

function publicationV3(): AflTradePublicationManifestV3 {
  return aflTradePublicationManifestV3Schema.parse(addressPublication(publicationV3Content()));
}

function projectionV2Content(publication = publicationV3()): AflTradeProjectionManifestV2Content {
  const projectionPublicEvidenceIndex = publicEvidenceIndexBinding(publication);
  const projectionSchemaBundle = {
    schemaVersion: 'afl-trade-projection-schema-bundle/v1' as const,
    projectionSchemaBundleId: `projection-schema-bundle:${'6'.repeat(64)}`,
    artifactRef: ref('projection-schema-bundle', T1),
    responseContractVersion: 'afl-trade-value/v2' as const,
    valuationExportContractVersion: 'afl-trade-valuation-csv/v1' as const,
  };
  const projectionMaterialization = {
    schemaVersion: 'afl-trade-projection-materialization/v1' as const,
    projectionMaterializationId: `projection-materialization:${'8'.repeat(64)}`,
    artifactRef: ref('projection-materialization', T4),
    publicationId: publication.publicationId,
    valuationOutputInventoryIndexId:
      publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    projectionPublicEvidenceIndexId: projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
    projectionPresentationPolicyId:
      publication.content.projectionPresentationPolicy.projectionPresentationPolicyId,
    projectionSchemaBundleId: projectionSchemaBundle.projectionSchemaBundleId,
    scopeKey: publication.content.scopeKey,
    valueUnitId: publication.content.valueUnitId,
    calculationAsOf: T3,
    knowledgeCutoffAt: T2,
    tradeCount: publication.content.entryCount,
    documentCount: 9,
    evidenceTradeSetSha256: '9'.repeat(64),
    entrySetSha256: 'a'.repeat(64),
    shardSetSha256: 'b'.repeat(64),
  };
  const documentCount = projectionMaterialization.documentCount + 1;

  return {
    schemaVersion: 'afl-trade-projection/v2',
    environment: publication.content.environment,
    scopeKey: publication.content.scopeKey,
    createdAt: T5,
    publicationId: publication.publicationId,
    buildJobId: 'fixture-projection-v2-build',
    publicAssetBoundary: PUBLIC_BOUNDARY,
    responseContractVersion: 'afl-trade-value/v2',
    valuationExportContractVersion: 'afl-trade-valuation-csv/v1',
    valueUnitId: publication.content.valueUnitId,
    supportedViews: [...publication.content.supportedViews],
    documentCount,
    valuationOutputInventoryIndex: structuredClone(
      publication.content.valuationOutputInventoryIndex
    ),
    freshnessPolicy: structuredClone(publication.content.freshnessPolicy),
    projectionPresentationPolicy: structuredClone(publication.content.projectionPresentationPolicy),
    projectionPublicEvidenceIndex,
    projectionMaterialization,
    projectionDocumentSet: {
      schemaVersion: 'afl-trade-projection-document-set/v1',
      projectionDocumentSetId: `projection-document-set:${'5'.repeat(64)}`,
      artifactRef: ref('projection-document-set', T4),
      tradeCount: publication.content.entryCount,
      documentCount,
    },
    projectionSchemaBundle,
    parityReport: {
      schemaVersion: 'afl-trade-projection-parity-report/v1',
      projectionParityReportId: `projection-parity-report:${'7'.repeat(64)}`,
      artifactRef: ref('projection-parity-report', T5),
      status: 'passed',
      checkCount: 12,
      failureCount: 0,
      checkedDocumentCount: documentCount,
    },
  };
}

function projectionV2(publication = publicationV3()): AflTradeProjectionManifestV2 {
  return aflTradeProjectionManifestV2Schema.parse(
    addressProjection(projectionV2Content(publication))
  );
}

function invalidPairIssue(input: unknown, code: string) {
  const result = validateAflTradePublicationProjectionManifestPair(input);
  expect(result.valid).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toEqual([code]);
  return result;
}

function readdressProjection(
  content: AflTradeProjectionManifestV2Content
): AflTradeProjectionManifestV2 {
  return aflTradeProjectionManifestV2Schema.parse(addressProjection(content));
}

describe('AFL trade publication and projection manifests', () => {
  it('preserves the exact legacy publication v2 literals, bytes, and address', () => {
    const publication = legacyPublication();
    expect(publication.publicationId).toBe(
      'publication:ab0a4e561099845c40aa0cb945203481e8bcb35cf6542c949a18826ae8f05252'
    );
    expect(publication.content.schemaVersion).toBe('afl-trade-publication/v2');
    expect(publication.content.entryCount).toBe(0);
    expect(publication.content.supportedViews).toEqual(['current', 'at_trade']);
    expect(publication.content.publicationBundleArtifact.mediaType).toBe(
      'application/vnd.statly.legacy+json'
    );
    expect(aflTradePublicationManifestSchema.parse(publication)).toEqual(publication);
    expect(aflTradePublicationManifestContentSchema.parse(publication.content)).toEqual(
      publication.content
    );
    expect(
      aflTradePublicationManifestV2Schema.safeParse({
        ...publication,
        content: { ...publication.content, publicAssetBoundary: PUBLIC_BOUNDARY },
      }).success
    ).toBe(false);
  });

  it('preserves the exact legacy projection v1 literals, bytes, and address', () => {
    const projection = legacyProjection();
    expect(projection.projectionId).toBe(
      'projection:867f6dd42c3699ab007e358a9c306e47e922746b05a52b372665eb0e8a0796c3'
    );
    expect(projection.content).toMatchObject({
      schemaVersion: 'afl-trade-projection/v1',
      responseContractVersion: 'afl-trade-value/v2',
      documentCount: 0,
    });
    expect(projection.content.projectionArtifact.mediaType).toBe(
      'application/vnd.statly.legacy+json'
    );
    expect(aflTradeProjectionManifestSchema.parse(projection)).toEqual(projection);
    expect(aflTradeProjectionManifestContentSchema.parse(projection.content)).toEqual(
      projection.content
    );
    expect(
      aflTradeProjectionManifestV1Schema.safeParse({
        ...projection,
        content: { ...projection.content, publicAssetBoundary: PUBLIC_BOUNDARY },
      }).success
    ).toBe(false);
  });

  it('keeps the additive generations isolated and rejects unsupported serving pairs', () => {
    const legacyPublicationValue = legacyPublication();
    const legacyProjectionValue = legacyProjection();
    const publication = publicationV3();
    const projection = projectionV2(publication);

    expect(aflTradePublicationManifestSchema.safeParse(publication).success).toBe(true);
    expect(aflTradeProjectionManifestSchema.safeParse(projection).success).toBe(true);
    expect(aflTradePublicationManifestV2Schema.safeParse(publication).success).toBe(false);
    expect(aflTradePublicationManifestV3Schema.safeParse(legacyPublicationValue).success).toBe(
      false
    );
    expect(aflTradeProjectionManifestV1Schema.safeParse(projection).success).toBe(false);
    expect(aflTradeProjectionManifestV2Schema.safeParse(legacyProjectionValue).success).toBe(false);

    for (const pair of [
      {
        publicationManifest: legacyPublicationValue,
        projectionManifest: legacyProjectionValue,
      },
      { publicationManifest: legacyPublicationValue, projectionManifest: projection },
      { publicationManifest: publication, projectionManifest: legacyProjectionValue },
    ]) {
      const result = invalidPairIssue(pair, 'UNSUPPORTED_VERSION_PAIR');
      expect(result.issues[0].message).toBe(
        'Serving requires publication v4 with projection v3, or the retained publication v3 with projection v2 pair.'
      );
    }
  });

  it('accepts a complete canonical publication v3 manifest through specific and generic schemas', () => {
    const publication = publicationV3();
    expect(publication.content).toMatchObject({
      schemaVersion: 'afl-trade-publication/v3',
      publicAssetBoundary: PUBLIC_BOUNDARY,
      entryCount: 1,
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      valuationOutputInventoryIndex: {
        schemaVersion: 'afl-trade-valuation-output-inventory-index/v1',
        entryCount: 1,
      },
      freshnessPolicy: {
        schemaVersion: 'afl-trade-publication-freshness-policy/v1',
      },
      projectionPresentationPolicy: {
        schemaVersion: 'afl-trade-projection-presentation-policy/v1',
        valueUnitId: 'statly-value-point',
        universalLayer: 'scarcity_adjusted',
        supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      },
    });
    expect(aflTradePublicationManifestV3Schema.safeParse(publication).success).toBe(true);
    expect(aflTradePublicationManifestSchema.parse(publication)).toEqual(publication);
  });

  it('accepts a complete canonical projection v2 with passed whole-document parity', () => {
    const publication = publicationV3();
    const projection = projectionV2(publication);
    expect(projection.content).toMatchObject({
      schemaVersion: 'afl-trade-projection/v2',
      publicAssetBoundary: PUBLIC_BOUNDARY,
      responseContractVersion: 'afl-trade-value/v2',
      valuationExportContractVersion: 'afl-trade-valuation-csv/v1',
      documentCount: 10,
      projectionPresentationPolicy: {
        schemaVersion: 'afl-trade-projection-presentation-policy/v1',
      },
      projectionPublicEvidenceIndex: {
        schemaVersion: 'afl-trade-projection-public-evidence-index/v1',
        publicationId: publication.publicationId,
        entryCount: 1,
      },
      projectionMaterialization: {
        schemaVersion: 'afl-trade-projection-materialization/v1',
        publicationId: publication.publicationId,
        valuationOutputInventoryIndexId:
          publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
        projectionPublicEvidenceIndexId:
          projection.content.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
        projectionPresentationPolicyId:
          publication.content.projectionPresentationPolicy.projectionPresentationPolicyId,
        projectionSchemaBundleId:
          projection.content.projectionSchemaBundle.projectionSchemaBundleId,
        scopeKey: publication.content.scopeKey,
        valueUnitId: publication.content.valueUnitId,
        tradeCount: 1,
        documentCount: 9,
        evidenceTradeSetSha256: '9'.repeat(64),
        entrySetSha256: 'a'.repeat(64),
        shardSetSha256: 'b'.repeat(64),
      },
      projectionDocumentSet: { tradeCount: 1, documentCount: 10 },
      parityReport: {
        status: 'passed',
        failureCount: 0,
        checkedDocumentCount: 10,
      },
    });
    expect(projection.content.projectionMaterialization).toEqual({
      schemaVersion: 'afl-trade-projection-materialization/v1',
      projectionMaterializationId: `projection-materialization:${'8'.repeat(64)}`,
      artifactRef: ref('projection-materialization', T4),
      publicationId: publication.publicationId,
      valuationOutputInventoryIndexId:
        publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      projectionPublicEvidenceIndexId:
        projection.content.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
      projectionPresentationPolicyId:
        publication.content.projectionPresentationPolicy.projectionPresentationPolicyId,
      projectionSchemaBundleId: projection.content.projectionSchemaBundle.projectionSchemaBundleId,
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      calculationAsOf: T3,
      knowledgeCutoffAt: T2,
      tradeCount: 1,
      documentCount: 9,
      evidenceTradeSetSha256: '9'.repeat(64),
      entrySetSha256: 'a'.repeat(64),
      shardSetSha256: 'b'.repeat(64),
    });
    expect(projection.content.documentCount).toBe(
      projection.content.projectionMaterialization.documentCount + 1
    );
    expect(
      [
        projection.content.projectionMaterialization.knowledgeCutoffAt,
        projection.content.projectionMaterialization.calculationAsOf,
        projection.content.projectionMaterialization.artifactRef.createdAt,
        projection.content.projectionDocumentSet.artifactRef.createdAt,
        projection.content.parityReport.artifactRef.createdAt,
        projection.content.createdAt,
      ].map(Date.parse)
    ).toEqual([T2, T3, T4, T4, T5, T5].map(Date.parse));
    expect(projection.content.valuationOutputInventoryIndex).toEqual(
      publication.content.valuationOutputInventoryIndex
    );
    expect(projection.content.freshnessPolicy).toEqual(publication.content.freshnessPolicy);
    expect(projection.content.projectionPresentationPolicy).toEqual(
      publication.content.projectionPresentationPolicy
    );
    expect(aflTradeProjectionManifestV2Schema.safeParse(projection).success).toBe(true);
    expect(aflTradeProjectionManifestSchema.parse(projection)).toEqual(projection);
  });

  it('rejects readdressed publication v3 binding, count, and canonical-view violations', () => {
    const mutations: Array<(content: AflTradePublicationManifestV3Content) => void> = [
      (content) => {
        content.valuationOutputInventoryIndex.schemaVersion = 'wrong-index/v1' as never;
      },
      (content) => {
        content.freshnessPolicy.schemaVersion = 'wrong-freshness/v1' as never;
      },
      (content) => {
        content.projectionPresentationPolicy.schemaVersion = 'wrong-policy/v1' as never;
      },
      (content) => {
        content.valuationOutputInventoryIndex.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.freshnessPolicy.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.projectionPresentationPolicy.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.entryCount = 0;
      },
      (content) => {
        content.entryCount = 10_001;
        content.valuationOutputInventoryIndex.entryCount = 10_001;
      },
      (content) => {
        content.valuationOutputInventoryIndex.entryCount = 2;
      },
      (content) => {
        content.supportedViews = ['current', 'at_trade'];
      },
      (content) => {
        content.supportedViews = ['at_trade', 'at_trade'];
      },
      (content) => {
        content.projectionPresentationPolicy.valueUnitId = 'other-value-unit';
      },
      (content) => {
        content.projectionPresentationPolicy.supportedViews = [
          'at_trade',
          'realized',
          'remaining',
          'remaining',
        ] as never;
      },
    ];
    for (const mutate of mutations) {
      const content = structuredClone(publicationV3Content());
      mutate(content);
      expect(
        aflTradePublicationManifestV3Schema.safeParse(addressPublication(content)).success
      ).toBe(false);
    }
  });

  it('rejects readdressed projection v2 binding, count, parity, contract, and view violations', () => {
    const mutations: Array<(content: AflTradeProjectionManifestV2Content) => void> = [
      (content) => {
        content.valuationOutputInventoryIndex.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.freshnessPolicy.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.projectionPresentationPolicy.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.projectionPublicEvidenceIndex.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.projectionDocumentSet.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.projectionSchemaBundle.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.parityReport.artifactRef.mediaType = 'application/octet-stream';
      },
      (content) => {
        content.documentCount = 4;
      },
      (content) => {
        content.projectionDocumentSet.tradeCount = 2;
      },
      (content) => {
        content.projectionPublicEvidenceIndex.entryCount = 2;
      },
      (content) => {
        content.projectionPresentationPolicy.valueUnitId = 'other-value-unit';
      },
      (content) => {
        content.projectionPublicEvidenceIndex.publicationId = `publication:${'8'.repeat(64)}`;
      },
      (content) => {
        content.projectionPublicEvidenceIndex.valuationOutputInventoryIndexId = `valuation-output-inventory-index:${'9'.repeat(64)}`;
      },
      (content) => {
        content.projectionPublicEvidenceIndex.scopeKey = 'other-scope';
      },
      (content) => {
        content.projectionPublicEvidenceIndex.valueUnitId = 'other-value-unit';
      },
      (content) => {
        content.projectionPublicEvidenceIndex.indexedEvidenceSchemaVersion =
          'afl-trade-projection-public-evidence/v2' as never;
      },
      (content) => {
        content.projectionMaterialization.publicationId = `publication:${'0'.repeat(64)}`;
      },
      (content) => {
        content.projectionMaterialization.valuationOutputInventoryIndexId = `valuation-output-inventory-index:${'0'.repeat(64)}`;
      },
      (content) => {
        content.projectionMaterialization.projectionPublicEvidenceIndexId = `projection-public-evidence-index:${'0'.repeat(64)}`;
      },
      (content) => {
        content.projectionMaterialization.projectionPresentationPolicyId = `projection-presentation-policy:${'0'.repeat(64)}`;
      },
      (content) => {
        content.projectionMaterialization.projectionSchemaBundleId = `projection-schema-bundle:${'0'.repeat(64)}`;
      },
      (content) => {
        content.projectionMaterialization.scopeKey = 'other-scope';
      },
      (content) => {
        content.projectionMaterialization.valueUnitId = 'other-value-unit';
      },
      (content) => {
        content.projectionMaterialization.tradeCount = 2;
      },
      (content) => {
        content.projectionMaterialization.documentCount = 10;
      },
      (content) => {
        content.projectionMaterialization.evidenceTradeSetSha256 = 'not-a-sha256';
      },
      (content) => {
        content.projectionMaterialization.knowledgeCutoffAt = T4;
      },
      (content) => {
        content.projectionMaterialization.calculationAsOf = T5;
      },
      (content) => {
        content.parityReport.checkedDocumentCount = 2;
      },
      (content) => {
        content.parityReport.status = 'failed' as never;
      },
      (content) => {
        content.parityReport.failureCount = 1 as never;
      },
      (content) => {
        content.parityReport.checkCount = 0;
      },
      (content) => {
        content.projectionSchemaBundle.responseContractVersion = 'afl-trade-value/v3' as never;
      },
      (content) => {
        content.projectionSchemaBundle.valuationExportContractVersion =
          'afl-trade-valuation-csv/v2' as never;
      },
      (content) => {
        content.supportedViews = ['current', 'at_trade'];
      },
      (content) => {
        content.supportedViews = ['at_trade', 'at_trade'];
      },
    ];
    for (const mutate of mutations) {
      const content = structuredClone(projectionV2Content());
      mutate(content);
      expect(aflTradeProjectionManifestV2Schema.safeParse(addressProjection(content)).success).toBe(
        false
      );
    }
  });

  it('enforces publication, projection, and cross-pair chronology independently', () => {
    const publicationMutations: Array<(content: AflTradePublicationManifestV3Content) => void> = [
      (content) => {
        content.publicationBundleArtifact = ref('future-publication-bundle', T4);
      },
      (content) => {
        content.methodologyArtifact = ref('future-methodology', T4);
      },
      (content) => {
        content.validationReportArtifact = ref('future-validation', T4);
      },
      (content) => {
        content.modelCardArtifact = ref('future-model-card', T4);
      },
      (content) => {
        content.valuationOutputInventoryIndex.artifactRef = ref('future-index', T4);
      },
      (content) => {
        content.freshnessPolicy.artifactRef = ref('future-freshness', T4);
      },
      (content) => {
        content.projectionPresentationPolicy.artifactRef = ref('future-policy', T4);
      },
      (content) => {
        content.publicationBundleArtifact = ref('publication-before-index', T0);
      },
    ];
    for (const mutate of publicationMutations) {
      const content = structuredClone(publicationV3Content());
      mutate(content);
      expect(aflTradePublicationManifestV3ContentSchema.safeParse(content).success).toBe(false);
    }

    const synchronizedProjection = projectionV2Content();
    expect(synchronizedProjection.createdAt).toBe(
      synchronizedProjection.parityReport.artifactRef.createdAt
    );
    expect(
      aflTradeProjectionManifestV2ContentSchema.safeParse(synchronizedProjection).success
    ).toBe(true);

    for (const createdAt of [T4, T6]) {
      const content = structuredClone(synchronizedProjection);
      content.createdAt = createdAt;
      const result = aflTradeProjectionManifestV2ContentSchema.safeParse(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['createdAt'],
              message:
                'Projection v2 creation time must exactly equal its passing parity artifact time.',
            }),
          ])
        );
      }
    }

    const projectionMutations: Array<(content: AflTradeProjectionManifestV2Content) => void> = [
      (content) => {
        content.valuationOutputInventoryIndex.artifactRef = ref('index-after-documents', T5);
      },
      (content) => {
        content.projectionSchemaBundle.artifactRef = ref('schema-after-documents', T5);
      },
      (content) => {
        content.projectionPresentationPolicy.artifactRef = ref('policy-after-documents', T5);
      },
      (content) => {
        content.projectionPublicEvidenceIndex.artifactRef = ref(
          'evidence-index-after-documents',
          T5
        );
      },
      (content) => {
        content.projectionMaterialization.artifactRef = ref('materialization-after-documents', T5);
      },
      (content) => {
        content.projectionDocumentSet.artifactRef = ref('documents-after-parity', T6);
      },
      (content) => {
        content.parityReport.artifactRef = ref(
          'parity-after-projection',
          '2026-08-05T06:00:00.001Z'
        );
      },
      (content) => {
        content.freshnessPolicy.artifactRef = ref(
          'freshness-after-projection',
          '2026-08-05T06:00:00.001Z'
        );
      },
      (content) => {
        content.projectionPresentationPolicy.artifactRef = ref(
          'policy-after-projection',
          '2026-08-05T06:00:00.001Z'
        );
      },
      (content) => {
        content.projectionPublicEvidenceIndex.artifactRef = ref(
          'evidence-index-after-projection',
          '2026-08-05T06:00:00.001Z'
        );
      },
      (content) => {
        content.projectionMaterialization.artifactRef = ref(
          'materialization-after-projection',
          '2026-08-05T06:00:00.001Z'
        );
      },
    ];
    for (const mutate of projectionMutations) {
      const content = structuredClone(projectionV2Content());
      mutate(content);
      expect(aflTradeProjectionManifestV2ContentSchema.safeParse(content).success).toBe(false);
    }

    const publication = publicationV3();
    const earlyContent = projectionV2Content(publication);
    earlyContent.projectionDocumentSet.artifactRef = ref('documents-before-publication', T2);
    earlyContent.projectionPublicEvidenceIndex.artifactRef = ref(
      'evidence-index-before-publication',
      T2
    );
    earlyContent.projectionMaterialization.knowledgeCutoffAt = T0;
    earlyContent.projectionMaterialization.calculationAsOf = T1;
    earlyContent.projectionMaterialization.artifactRef = ref(
      'materialization-before-publication',
      T2
    );
    const earlyProjection = readdressProjection(earlyContent);
    const result = invalidPairIssue(
      { publicationManifest: publication, projectionManifest: earlyProjection },
      'CHRONOLOGY_INVALID'
    );
    expect(result.issues[0].message).toBe('The projection manifest predates its publication.');
  });

  it('rejects stale addresses, malformed identities, unknown fields, and generation mixing', () => {
    const publication = publicationV3();
    const projection = projectionV2(publication);
    expect(
      aflTradePublicationManifestV3Schema.safeParse({
        ...publication,
        publicationId: `publication:${'0'.repeat(64)}`,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionManifestV2Schema.safeParse({
        ...projection,
        projectionId: `projection:${'0'.repeat(64)}`,
      }).success
    ).toBe(false);
    expect(
      aflTradePublicationManifestV3Schema.safeParse({
        ...publication,
        unknownField: true,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionManifestV2Schema.safeParse({
        ...projection,
        content: { ...projection.content, projectionArtifact: ref('legacy-field') },
      }).success
    ).toBe(false);
    expect(
      aflTradePublicationManifestV3ContentSchema.safeParse({
        ...publication.content,
        valuationOutputInventoryIndex: {
          ...publication.content.valuationOutputInventoryIndex,
          valuationOutputInventoryIndexId: `valuation-output-inventory-index:${'x'.repeat(64)}`,
        },
      }).success
    ).toBe(false);

    const changed = structuredClone(publication.content);
    changed.scopeKey = 'fixture-readdressed-publication';
    const readdressed = aflTradePublicationManifestV3Schema.parse(addressPublication(changed));
    expect(readdressed.publicationId).not.toBe(publication.publicationId);
  });

  it('rejects user and fantasy ownership fields at manifest and nested binding boundaries', () => {
    const publication = publicationV3();
    const projection = projectionV2(publication);
    expect(publication.content.publicAssetBoundary).toBe(PUBLIC_BOUNDARY);
    expect(projection.content.publicAssetBoundary).toBe(PUBLIC_BOUNDARY);

    const ownershipCandidates = [
      {
        schema: aflTradePublicationManifestV3ContentSchema,
        value: { ...publication.content, userId: 'user:fixture' },
      },
      {
        schema: aflTradePublicationManifestV3ContentSchema,
        value: {
          ...publication.content,
          projectionPresentationPolicy: {
            ...publication.content.projectionPresentationPolicy,
            userId: 'user:fixture',
          },
        },
      },
      {
        schema: aflTradePublicationManifestV3ContentSchema,
        value: {
          ...publication.content,
          valuationOutputInventoryIndex: {
            ...publication.content.valuationOutputInventoryIndex,
            fantasyTeamId: 'fantasy-team:fixture',
          },
        },
      },
      {
        schema: aflTradeProjectionManifestV2ContentSchema,
        value: { ...projection.content, ownerId: 'owner:fixture' },
      },
      {
        schema: aflTradeProjectionManifestV2ContentSchema,
        value: {
          ...projection.content,
          projectionPublicEvidenceIndex: {
            ...projection.content.projectionPublicEvidenceIndex,
            fantasyTeamId: 'fantasy-team:fixture',
          },
        },
      },
      {
        schema: aflTradeProjectionManifestV2ContentSchema,
        value: {
          ...projection.content,
          projectionDocumentSet: {
            ...projection.content.projectionDocumentSet,
            ownership: ['user:fixture'],
          },
        },
      },
      {
        schema: aflTradeProjectionManifestV2ContentSchema,
        value: {
          ...projection.content,
          publicAssetBoundary: 'source_native_afl_assets_with_fantasy_ownership',
        },
      },
    ];
    for (const candidate of ownershipCandidates) {
      expect(candidate.schema.safeParse(candidate.value).success).toBe(false);
    }
  });

  it('validates the exact canonical pair and returns deeply frozen deterministic results', () => {
    const publication = publicationV3();
    const projection = projectionV2(publication);
    const pair = { publicationManifest: publication, projectionManifest: projection };
    const result = validateAflTradePublicationProjectionManifestPair(pair);
    expect(aflTradePublicationProjectionManifestPairSchema.safeParse(pair).success).toBe(true);
    expect(result).toEqual({ valid: true, issues: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(validateAflTradePublicationProjectionManifestPair(pair)).toEqual(result);

    pair.publicationManifest = legacyPublication() as never;
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('reports exact materialization mismatch codes for a substituted publication pair', () => {
    const publication = publicationV3();
    const substitutedPublicationContent = structuredClone(publication.content);
    substitutedPublicationContent.modelCardArtifact = ref('substituted-model-card', T2);
    const substitutedPublication = aflTradePublicationManifestV3Schema.parse(
      addressPublication(substitutedPublicationContent)
    );
    const substitutedProjection = projectionV2(substitutedPublication);

    const result = validateAflTradePublicationProjectionManifestPair({
      publicationManifest: publication,
      projectionManifest: substitutedProjection,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        code: 'PUBLICATION_MISMATCH',
        message: 'The projection does not bind the selected publication.',
      },
      {
        code: 'PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH',
        message: 'The public-evidence index does not bind the selected publication.',
      },
      {
        code: 'MATERIALIZATION_MISMATCH',
        message:
          'The projection materialization does not bind the selected publication and its exact analytical parents.',
      },
    ]);
  });

  it('accumulates every reachable cross-manifest mismatch once in stable code order', () => {
    const publication = publicationV3();
    const content = projectionV2Content(publication);
    content.publicationId = `publication:${'8'.repeat(64)}`;
    content.environment = 'production';
    content.scopeKey = 'fixture-other-scope';
    content.valueUnitId = 'other-value-unit';
    content.valuationOutputInventoryIndex = indexBinding(2, 'c');
    content.projectionDocumentSet.tradeCount = 2;
    content.freshnessPolicy = freshnessBinding('d');
    content.projectionPresentationPolicy = presentationPolicyBinding('a');
    content.projectionPresentationPolicy.valueUnitId = content.valueUnitId;
    content.projectionPublicEvidenceIndex.publicationId = content.publicationId;
    content.projectionPublicEvidenceIndex.valuationOutputInventoryIndexId =
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId;
    content.projectionPublicEvidenceIndex.scopeKey = content.scopeKey;
    content.projectionPublicEvidenceIndex.valueUnitId = content.valueUnitId;
    content.projectionPublicEvidenceIndex.entryCount = 2;
    content.projectionPublicEvidenceIndex.artifactRef = ref(
      'evidence-index-before-publication',
      T2
    );
    content.projectionDocumentSet.artifactRef = ref('documents-before-publication', T2);
    content.documentCount = 19;
    content.projectionDocumentSet.documentCount = 19;
    content.parityReport.checkedDocumentCount = 19;
    content.projectionMaterialization.publicationId = content.publicationId;
    content.projectionMaterialization.valuationOutputInventoryIndexId =
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId;
    content.projectionMaterialization.projectionPresentationPolicyId =
      content.projectionPresentationPolicy.projectionPresentationPolicyId;
    content.projectionMaterialization.scopeKey = content.scopeKey;
    content.projectionMaterialization.valueUnitId = content.valueUnitId;
    content.projectionMaterialization.tradeCount = 2;
    content.projectionMaterialization.documentCount = 18;
    content.projectionMaterialization.knowledgeCutoffAt = T0;
    content.projectionMaterialization.calculationAsOf = T1;
    content.projectionMaterialization.artifactRef = ref('materialization-before-publication', T2);
    const projection = readdressProjection(content);
    const result = validateAflTradePublicationProjectionManifestPair({
      publicationManifest: publication,
      projectionManifest: projection,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'PUBLICATION_MISMATCH',
      'ENVIRONMENT_MISMATCH',
      'SCOPE_MISMATCH',
      'VALUE_UNIT_MISMATCH',
      'INVENTORY_INDEX_MISMATCH',
      'FRESHNESS_POLICY_MISMATCH',
      'PRESENTATION_POLICY_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_INVENTORY_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_SCOPE_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_VALUE_UNIT_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_COUNT_MISMATCH',
      'MATERIALIZATION_MISMATCH',
      'ENTRY_COUNT_MISMATCH',
      'CHRONOLOGY_INVALID',
    ]);
    expect(new Set(result.issues.map((issue) => issue.code)).size).toBe(result.issues.length);
    expect(result.issues.every((issue) => Object.isFrozen(issue))).toBe(true);
  });

  it('pins pair-code completeness and invalid-input precedence over defensive pair analysis', () => {
    expect(AFL_TRADE_PUBLICATION_PROJECTION_PAIR_ISSUE_CODES).toEqual([
      'INVALID_INPUT',
      'UNSUPPORTED_VERSION_PAIR',
      'PUBLICATION_MISMATCH',
      'ENVIRONMENT_MISMATCH',
      'SCOPE_MISMATCH',
      'PUBLIC_ASSET_BOUNDARY_MISMATCH',
      'VALUE_UNIT_MISMATCH',
      'SUPPORTED_VIEW_MISMATCH',
      'INVENTORY_INDEX_MISMATCH',
      'CUSTODY_INDEX_MISMATCH',
      'FRESHNESS_POLICY_MISMATCH',
      'PRESENTATION_POLICY_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_INVENTORY_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_SCOPE_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_VALUE_UNIT_MISMATCH',
      'PUBLIC_EVIDENCE_INDEX_COUNT_MISMATCH',
      'MATERIALIZATION_MISMATCH',
      'ENTRY_COUNT_MISMATCH',
      'DOCUMENT_COUNT_MISMATCH',
      'RESPONSE_CONTRACT_MISMATCH',
      'EXPORT_CONTRACT_MISMATCH',
      'CHRONOLOGY_INVALID',
    ]);
    const publication = publicationV3();
    const invalidContents: AflTradeProjectionManifestV2Content[] = [];
    const boundary = structuredClone(projectionV2Content(publication));
    boundary.publicAssetBoundary = 'fantasy-owned-assets' as never;
    invalidContents.push(boundary);
    const documentCount = structuredClone(projectionV2Content(publication));
    documentCount.documentCount = 4;
    invalidContents.push(documentCount);
    const response = structuredClone(projectionV2Content(publication));
    response.projectionSchemaBundle.responseContractVersion = 'afl-trade-value/v3' as never;
    invalidContents.push(response);
    const exportContract = structuredClone(projectionV2Content(publication));
    exportContract.projectionSchemaBundle.valuationExportContractVersion =
      'afl-trade-valuation-csv/v2' as never;
    invalidContents.push(exportContract);
    const policyCoordinates = structuredClone(projectionV2Content(publication));
    policyCoordinates.projectionPresentationPolicy.valueUnitId = 'other-value-unit';
    invalidContents.push(policyCoordinates);
    const evidenceCoordinates = structuredClone(projectionV2Content(publication));
    evidenceCoordinates.projectionPublicEvidenceIndex.scopeKey = 'other-scope';
    invalidContents.push(evidenceCoordinates);

    for (const content of invalidContents) {
      const malformedProjection = addressProjection(content);
      const result = invalidPairIssue(
        { publicationManifest: publication, projectionManifest: malformedProjection },
        'INVALID_INPUT'
      );
      expect(result.issues[0].message).toBe('The publication-projection pair input is invalid.');
    }
  });

  it('contains hostile exact-envelope inputs and snapshots each property exactly once', () => {
    const publication = publicationV3();
    const projection = projectionV2(publication);
    const pair = { publicationManifest: publication, projectionManifest: projection };
    const missing = { publicationManifest: publication };
    const extra = { ...pair, unexpected: true };
    const symbol = { ...pair } as Record<PropertyKey, unknown>;
    symbol[Symbol('hostile')] = true;
    const throwingGetter = Object.defineProperty({ ...pair }, 'publicationManifest', {
      enumerable: true,
      get() {
        throw new Error('private hostile getter detail');
      },
    });
    const throwingProxy = new Proxy(pair, {
      ownKeys() {
        throw new Error('private hostile proxy detail');
      },
    });
    const revoked = Proxy.revocable(pair, {});
    revoked.revoke();
    for (const hostile of [
      null,
      [],
      missing,
      extra,
      symbol,
      throwingGetter,
      throwingProxy,
      revoked.proxy,
    ]) {
      invalidPairIssue(hostile, 'INVALID_INPUT');
    }

    let publicationGetterCalls = 0;
    let projectionGetterCalls = 0;
    const accessorEnvelope = {
      get publicationManifest() {
        publicationGetterCalls += 1;
        return publication;
      },
      get projectionManifest() {
        projectionGetterCalls += 1;
        return projection;
      },
    };
    expect(validateAflTradePublicationProjectionManifestPair(accessorEnvelope)).toEqual({
      valid: false,
      issues: [
        {
          code: 'INVALID_INPUT',
          message: 'The publication-projection pair input is invalid.',
        },
      ],
    });
    expect(publicationGetterCalls).toBe(0);
    expect(projectionGetterCalls).toBe(0);
  });
});
