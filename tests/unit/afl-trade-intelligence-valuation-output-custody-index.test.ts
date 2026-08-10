// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestFixture,
  createAflTradeValuationOutputInventoryVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';
import { createAflTradeCompleteAssessmentVerificationFixture } from '../fixtures/aflTradeCompleteAssessmentFixture';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradePublicationManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeValuationOutputInventoryIndex } from '@/server/aflTradeIntelligence/artifacts/valuationOutputInventoryIndex';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  createAflTradeCustodiedPublicationManifest,
  createAflTradeValuationOutputCustodyIndex,
  verifyAflTradeCustodiedPublicationManifest,
  verifyAflTradeValuationOutputCustodyIndex,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputCustodyIndex';
import { persistAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';

const CUSTODY_AT = '2026-08-05T05:10:00.000Z';
const INDEX_AT = '2026-08-05T05:15:00.000Z';

function durableRepository() {
  const delegate = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  return {
    ...delegate,
    assurance: 'durable_object_storage' as const,
    custodyProfile: createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: 'valuation-output-custody-index-test',
      environment: 'non_production',
      artifactClass: 'derived_private',
      maximumObjectBytes: 128 * 1024 * 1024,
      keyDerivation: 'profile_sha256_two_level_fanout_v1',
      conditionalCreate: 'if_none_match_star_required',
      encryption: {
        inTransit: 'tls_required',
        atRest: { mode: 'customer_managed', keyReferenceSha256: 'a'.repeat(64) },
      },
      retention: {
        deletion: {
          kind: 'no_scheduled_deletion',
          maximumDays: null,
          enforcement: 'not_applicable',
        },
        deleteOnWithdrawal: false,
        worm: { mode: 'compliance', minimumDays: 365 },
      },
      residency: {
        allowedJurisdictions: ['Australia'],
        crossJurisdictionTransfer: 'prohibited',
      },
      infrastructureEvidenceIds: [`storage-policy:${'b'.repeat(64)}`],
    }),
  };
}

function operationAuthority() {
  return {
    async acquire(scope: Record<string, unknown>) {
      const content = {
        schemaVersion: 'afl-trade-valuation-output-custody-operation/v1' as const,
        ...scope,
        verifiedAt: CUSTODY_AT,
      };
      return {
        operationId: createAflTradeContentAddress('valuation-output-custody-operation', content),
        content,
      };
    },
    async complete() {},
  };
}

async function evidence(fixtureKind: 'two_party_player_swap' | 'three_party_exchange') {
  const verification = createAflTradeValuationOutputInventoryVerificationFixture(fixtureKind);
  const assessmentVerification = createAflTradeCompleteAssessmentVerificationFixture(
    verification,
    fixtureKind
  );
  const inventoryInput = {
    valuationOutputInventory: verification.output.valuationOutputInventory,
    artifactRef: verification.output.valuationOutputInventoryArtifactRef,
  };
  const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
    valuationBundleManifest: verification.valuationBundle.valuationBundleManifest,
    valuationBundleArtifactRef: verification.valuationBundle.artifactRef,
    valuationOutputInventories: [inventoryInput],
    createdAt: '2026-08-05T10:30:00.000Z',
  });
  const custody = await persistAflTradeValuationOutputInventory(
    { verification, assessmentVerification },
    { repository: durableRepository(), operationAuthority: operationAuthority() }
  );
  return {
    inventoryIndexVerification: {
      valuationBundleManifest: verification.valuationBundle.valuationBundleManifest,
      valuationBundleArtifactRef: verification.valuationBundle.artifactRef,
      valuationOutputInventories: [inventoryInput],
      output: inventoryIndex,
    },
    custody,
  };
}

describe('valuation-output custody index', () => {
  it('content-addresses the exact complete inventory-to-custody set deterministically', async () => {
    const input = await evidence('two_party_player_swap');
    const request = {
      inventoryIndexVerification: input.inventoryIndexVerification,
      custodyReceipts: [input.custody],
      createdAt: INDEX_AT,
    };

    const first = createAflTradeValuationOutputCustodyIndex(request);
    const replay = createAflTradeValuationOutputCustodyIndex(request);

    expect(first).toEqual(replay);
    expect(first.valuationOutputCustodyIndex.content).toMatchObject({
      schemaVersion: 'afl-trade-valuation-output-custody-index/v1',
      environment: 'non_production',
      entryCount: 1,
      publicationEligible: false,
    });
    expect(verifyAflTradeValuationOutputCustodyIndex({ ...request, output: first })).toBe(true);
  });

  it('rejects omitted and substituted custody receipts', async () => {
    const expected = await evidence('two_party_player_swap');
    const unrelated = await evidence('three_party_exchange');

    expect(() =>
      createAflTradeValuationOutputCustodyIndex({
        inventoryIndexVerification: expected.inventoryIndexVerification,
        custodyReceipts: [],
        createdAt: INDEX_AT,
      })
    ).toThrow();
    expect(() =>
      createAflTradeValuationOutputCustodyIndex({
        inventoryIndexVerification: expected.inventoryIndexVerification,
        custodyReceipts: [unrelated.custody],
        createdAt: INDEX_AT,
      })
    ).toThrow();
  });

  it('fails verification after custody-entry substitution', async () => {
    const input = await evidence('two_party_player_swap');
    const request = {
      inventoryIndexVerification: input.inventoryIndexVerification,
      custodyReceipts: [input.custody],
      createdAt: INDEX_AT,
    };
    const output = createAflTradeValuationOutputCustodyIndex(request);
    const tampered = structuredClone(output);
    tampered.valuationOutputCustodyIndex.content.entries[0].tradeId = 'trade:substituted';

    expect(verifyAflTradeValuationOutputCustodyIndex({ ...request, output: tampered })).toBe(false);
  });

  it('promotes an exact v3 candidate to a custody-bound publication v4', async () => {
    const input = await evidence('two_party_player_swap');
    const custodyRequest = {
      inventoryIndexVerification: input.inventoryIndexVerification,
      custodyReceipts: [input.custody],
      createdAt: INDEX_AT,
    };
    const custodyOutput = createAflTradeValuationOutputCustodyIndex(custodyRequest);
    const fixture = createAflTradeProjectionManifestFixture();
    const original = fixture.projectionDocumentSetVerification.publicationManifest;
    const inventoryIndex = input.inventoryIndexVerification.output.valuationOutputInventoryIndex;
    const candidateContent = {
      ...structuredClone(original.content),
      createdAt: '2026-08-05T11:03:00.000Z',
      publicationBundleArtifact: createAflTradeCanonicalJsonArtifactRef(
        { fixtureArtifact: 'custodied-publication-bundle' },
        '2026-08-05T11:02:00.000Z'
      ),
      valuationOutputInventoryIndex: {
        schemaVersion: inventoryIndex.content.schemaVersion,
        valuationOutputInventoryIndexId: inventoryIndex.valuationOutputInventoryIndexId,
        artifactRef:
          input.inventoryIndexVerification.output.valuationOutputInventoryIndexArtifactRef,
        entryCount: inventoryIndex.content.entryCount,
        inventorySetSha256: inventoryIndex.content.inventorySetSha256,
      },
    };
    const publicationCandidate = aflTradePublicationManifestV3Schema.parse({
      publicationId: createAflTradeContentAddress('publication', candidateContent),
      content: candidateContent,
    });
    const request = {
      publicationCandidate,
      custodyIndexVerification: { ...custodyRequest, output: custodyOutput },
    };

    const promoted = createAflTradeCustodiedPublicationManifest(request);

    expect(promoted.publicationManifest.content).toMatchObject({
      schemaVersion: 'afl-trade-publication/v4',
      valuationOutputCustodyIndex: {
        valuationOutputCustodyIndexId:
          custodyOutput.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      },
    });
    expect(verifyAflTradeCustodiedPublicationManifest({ ...request, output: promoted })).toBe(true);
  });

  it('materializes custody-bound public summaries from complete received-minus-surrendered value', async () => {
    const input = await evidence('two_party_player_swap');
    const request = {
      inventoryIndexVerification: input.inventoryIndexVerification,
      custodyReceipts: [input.custody],
      createdAt: INDEX_AT,
    };
    const custodyIndexVerification = {
      ...request,
      output: createAflTradeValuationOutputCustodyIndex(request),
    };

    const projection = createAflTradeCustodiedProjectionManifestFixture(
      custodyIndexVerification
    );
    const currentSummary = projection.documents.find(({ projectionDocument }) => {
      const content = projectionDocument.content;
      return content.kind === 'trade_summary' && content.view === 'current';
    })?.projectionDocument.content;
    if (!currentSummary || currentSummary.kind !== 'trade_summary') {
      throw new Error('Expected a current custody-bound trade summary.');
    }
    expect(currentSummary.valuation).toMatchObject({
      availability: 'available',
      comparisonBasis: 'complete_trade',
      clubValues: [
        {
          packageValue: {
            received: { median: expect.any(Number) },
            givenUp: { median: expect.any(Number) },
            net: { median: expect.any(Number) },
          },
        },
        {
          packageValue: {
            received: { median: expect.any(Number) },
            givenUp: { median: expect.any(Number) },
            net: { median: expect.any(Number) },
          },
        },
      ],
    });
  });
});
