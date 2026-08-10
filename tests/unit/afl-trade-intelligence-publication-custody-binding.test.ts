// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeProjectionManifestFixture } from '../fixtures/aflTradeProjectionManifestFixture';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeProjectionManifestV3Schema,
  aflTradePublicationManifestV4Schema,
  validateAflTradePublicationProjectionManifestPair,
} from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import { createAflTradeProjectionSchemaBundleV2 } from '@/server/aflTradeIntelligence/publication/projectionSchemaBundle';

const CUSTODY_AT = '2026-08-05T04:55:00.000Z';

function exactCustodyPair() {
  const fixture = createAflTradeProjectionManifestFixture();
  const legacyPair = createAflTradeProjectionManifestMaterialization({
    buildJobId: 'projection-manifest-build:custody-binding',
    freshnessPolicyResult: fixture.freshnessPolicyResult,
    projectionParityVerification: fixture.projectionParityVerification,
  });
  const legacyPublication = fixture.projectionDocumentSetVerification.publicationManifest;
  const schemaBundle = createAflTradeProjectionSchemaBundleV2({
    createdAt: legacyPublication.content.createdAt,
  });
  const inventory = legacyPublication.content.valuationOutputInventoryIndex;
  const custodyIndex = {
    schemaVersion: 'afl-trade-valuation-output-custody-index/v1' as const,
    valuationOutputCustodyIndexId: `valuation-output-custody-index:${'c'.repeat(64)}`,
    artifactRef: createAflTradeCanonicalJsonArtifactRef(
      { fixtureArtifact: 'valuation-output-custody-index' },
      CUSTODY_AT
    ),
    environment: legacyPublication.content.environment,
    valuationBundleId: legacyPublication.content.valuationBundleId,
    valuationOutputInventoryIndexId: inventory.valuationOutputInventoryIndexId,
    inventorySetSha256: inventory.inventorySetSha256,
    scopeKey: legacyPublication.content.scopeKey,
    valueUnitId: legacyPublication.content.valueUnitId,
    entryCount: inventory.entryCount,
    custodyReceiptSetSha256: 'd'.repeat(64),
  };
  const publicationContent = {
    ...structuredClone(legacyPublication.content),
    schemaVersion: 'afl-trade-publication/v4' as const,
    valuationOutputCustodyIndex: custodyIndex,
  };
  const publicationManifest = aflTradePublicationManifestV4Schema.parse({
    publicationId: createAflTradeContentAddress('publication', publicationContent),
    content: publicationContent,
  });
  const projectionContent = {
    ...structuredClone(legacyPair.projectionManifest.content),
    schemaVersion: 'afl-trade-projection/v3' as const,
    publicationId: publicationManifest.publicationId,
    valuationOutputCustodyIndex: custodyIndex,
    projectionPublicEvidenceIndex: {
      ...structuredClone(legacyPair.projectionManifest.content.projectionPublicEvidenceIndex),
      publicationId: publicationManifest.publicationId,
    },
    projectionMaterialization: {
      ...structuredClone(legacyPair.projectionManifest.content.projectionMaterialization),
      publicationId: publicationManifest.publicationId,
      projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
    },
    projectionSchemaBundle: {
      schemaVersion: schemaBundle.projectionSchemaBundle.content.schemaVersion,
      projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
      artifactRef: schemaBundle.projectionSchemaBundleArtifactRef,
      responseContractVersion: schemaBundle.projectionSchemaBundle.content.responseContractVersion,
      valuationExportContractVersion:
        schemaBundle.projectionSchemaBundle.content.valuationExportContractVersion,
      publicationManifestSchemaVersion:
        schemaBundle.projectionSchemaBundle.content.publicationManifestSchemaVersion,
      projectionManifestSchemaVersion:
        schemaBundle.projectionSchemaBundle.content.projectionManifestSchemaVersion,
    },
  };
  const projectionManifest = aflTradeProjectionManifestV3Schema.parse({
    projectionId: createAflTradeContentAddress('projection', projectionContent),
    content: projectionContent,
  });
  return { publicationManifest, projectionManifest };
}

describe('publication custody binding', () => {
  it('accepts the exact v4/v3 publication and projection pair', () => {
    const pair = exactCustodyPair();

    expect(validateAflTradePublicationProjectionManifestPair(pair)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('rejects a same-count projection bound to another custody receipt set', () => {
    const pair = exactCustodyPair();
    const tampered = structuredClone(pair.projectionManifest);
    tampered.content.valuationOutputCustodyIndex.custodyReceiptSetSha256 = 'e'.repeat(64);
    tampered.projectionId = createAflTradeContentAddress('projection', tampered.content);

    expect(
      validateAflTradePublicationProjectionManifestPair({
        publicationManifest: pair.publicationManifest,
        projectionManifest: tampered,
      })
    ).toMatchObject({
      valid: false,
      issues: [{ code: 'CUSTODY_INDEX_MISMATCH' }],
    });
  });

  it('rejects a custody-backed projection that is downgraded to the legacy schema bundle', () => {
    const pair = exactCustodyPair();
    const legacyBundle = createAflTradeProjectionManifestFixture().projectionSchemaBundle;
    const tampered = structuredClone(pair.projectionManifest);
    tampered.content.projectionSchemaBundle = {
      schemaVersion: legacyBundle.projectionSchemaBundle.content.schemaVersion,
      projectionSchemaBundleId: legacyBundle.projectionSchemaBundle.projectionSchemaBundleId,
      artifactRef: legacyBundle.projectionSchemaBundleArtifactRef,
      responseContractVersion: legacyBundle.projectionSchemaBundle.content.responseContractVersion,
      valuationExportContractVersion:
        legacyBundle.projectionSchemaBundle.content.valuationExportContractVersion,
    } as never;
    tampered.projectionId = createAflTradeContentAddress('projection', tampered.content);

    expect(aflTradeProjectionManifestV3Schema.safeParse(tampered).success).toBe(false);
  });
});
