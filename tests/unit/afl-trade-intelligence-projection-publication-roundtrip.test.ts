// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeProjectionArtifactReadRepository } from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
import {
  createAflTradeCustodiedProjectionManifestMaterialization,
  createAflTradeProjectionManifestMaterialization,
} from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import { createAflTradeProjectionReleaseArtifact } from '@/server/aflTradeIntelligence/publication/projectionReleaseArtifact';

import {
  CHECKED_AT,
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

describe('AFL trade projection publication-to-reader round trip', () => {
  it('mounts the exact separately addressed verification envelope, not manifest-only bytes', async () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const verification = { ...input, output };
    const releaseArtifact = createAflTradeProjectionReleaseArtifact({
      verification,
      createdAt: CHECKED_AT,
    });

    expect(releaseArtifact.artifactRef.artifactId).not.toBe(
      output.projectionManifestArtifactRef.artifactId
    );
    expect(new TextDecoder().decode(releaseArtifact.bytes)).toBe(
      canonicalizeAflTradeJson(verification)
    );

    const repository = await createAflTradeProjectionArtifactReadRepository({
      projectionId: output.projectionManifest.projectionId,
      releaseSource: {
        loadRelease: async () => releaseArtifact.bytes,
      },
      clock: () => new Date(Date.parse(CHECKED_AT) + 1).toISOString(),
    });

    await expect(
      repository.read({
        publication: {
          publicationId:
            fixture.projectionDocumentSetVerification.publicationManifest.publicationId,
          state: 'published',
          valuationBundleId:
            fixture.projectionDocumentSetVerification.publicationManifest.content.valuationBundleId,
          valueUnitId:
            fixture.projectionDocumentSetVerification.publicationManifest.content.valueUnitId,
          publishedAt: CHECKED_AT,
        },
        projectionBuildId: output.projectionManifest.projectionId,
        registryRevision: 1,
        scopeKey: fixture.projectionDocumentSetVerification.publicationManifest.content.scopeKey,
        supportedViews: [
          ...fixture.projectionDocumentSetVerification.publicationManifest.content.supportedViews,
        ],
        supportedCohorts: [
          ...fixture.projectionDocumentSetVerification.publicationManifest.content.supportedCohorts,
        ],
        excludedCohorts: [
          ...fixture.projectionDocumentSetVerification.publicationManifest.content.excludedCohorts,
        ],
      })
    ).resolves.toMatchObject({
      metadata: {
        publicationId: fixture.projectionDocumentSetVerification.publicationManifest.publicationId,
        projectionBuildId: output.projectionManifest.projectionId,
      },
    });
  }, 30_000);

  it('mounts the production custody-backed verification envelope', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const fixture = createAflTradeCustodiedProjectionManifestFixture(custodyIndexVerification);
    const input = {
      ...createAflTradeProjectionManifestMaterializationInput(fixture),
      custodyIndexVerification,
    };
    const output = createAflTradeCustodiedProjectionManifestMaterialization(input);
    const publicationManifest = fixture.projectionDocumentSetVerification.publicationManifest;
    const releaseArtifact = createAflTradeProjectionReleaseArtifact({
      verification: { ...input, output },
      createdAt: CHECKED_AT,
    });

    const repository = await createAflTradeProjectionArtifactReadRepository({
      projectionId: output.projectionManifest.projectionId,
      releaseSource: {
        loadRelease: async () => releaseArtifact.bytes,
      },
      clock: () => new Date(Date.parse(CHECKED_AT) + 1).toISOString(),
    });

    await expect(
      repository.read({
        publication: {
          publicationId: fixture.identity.publicationId,
          state: 'published',
          valuationBundleId: fixture.identity.valuationBundleId,
          valueUnitId: fixture.identity.valueUnitId,
          publishedAt: CHECKED_AT,
        },
        projectionBuildId: output.projectionManifest.projectionId,
        registryRevision: 1,
        scopeKey: publicationManifest.content.scopeKey,
        supportedViews: [...publicationManifest.content.supportedViews],
        supportedCohorts: [...publicationManifest.content.supportedCohorts],
        excludedCohorts: [...publicationManifest.content.excludedCohorts],
      })
    ).resolves.toMatchObject({
      metadata: {
        publicationId: fixture.identity.publicationId,
        projectionBuildId: output.projectionManifest.projectionId,
      },
    });
  }, 30_000);
});
