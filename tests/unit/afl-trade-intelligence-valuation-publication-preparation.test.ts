// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradePublicationManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeCustodiedPublicationManifest } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustodyIndex';
import { createAflTradeValuationPublicationPreparationService } from '@/server/aflTradeIntelligence/publication/valuationPublicationPreparationService';

import { createAflTradeCompleteAssessmentVerificationFixture } from '../fixtures/aflTradeCompleteAssessmentFixture';
import {
  createAflTradeProjectionManifestFixture,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
  createAflTradeValuationOutputInventoryVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

function candidateAt(createdAt: string) {
  const fixture =
    createAflTradeProjectionManifestFixture().projectionDocumentSetVerification.publicationManifest;
  const content = {
    ...fixture.content,
    createdAt,
    publicationBundleArtifact: { ...fixture.content.publicationBundleArtifact, createdAt },
    methodologyArtifact: { ...fixture.content.methodologyArtifact, createdAt },
    validationReportArtifact: { ...fixture.content.validationReportArtifact, createdAt },
    modelCardArtifact: { ...fixture.content.modelCardArtifact, createdAt },
  };
  return aflTradePublicationManifestV3Schema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

function passThroughCandidatePin() {
  return vi.fn(async ({ publicationCandidate }) => publicationCandidate);
}

describe('AFL trade valuation publication preparation', () => {
  it('custodies the exact complete assessment set before registering one v4 candidate', async () => {
    const inventoryVerification =
      createAflTradeValuationOutputInventoryVerificationFixture('two_party_player_swap');
    const assessmentVerification = createAflTradeCompleteAssessmentVerificationFixture(
      inventoryVerification,
      'two_party_player_swap'
    );
    const custodyFixture =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture('two_party_player_swap');
    const publicationCandidate = candidateAt(custodyFixture.createdAt);
    const callOrder: string[] = [];
    const persistInventory = vi.fn(async () => {
      callOrder.push('custody');
      return custodyFixture.custodyReceipts[0];
    });
    const trustedIndexTime = vi.fn(async () => {
      callOrder.push('trusted-time');
      return custodyFixture.createdAt;
    });
    const register = vi.fn(async (input) => {
      callOrder.push('register');
      return {
        publication: createAflTradeCustodiedPublicationManifest({
          publicationCandidate: input.publicationCandidate,
          custodyIndexVerification: input.custodyIndexVerification,
        }),
        mutation: {
          registry: { revision: 4, publications: {}, activeByScope: {} },
          idempotentReplay: true,
        },
      };
    });
    const service = createAflTradeValuationPublicationPreparationService({
      environment: 'non_production',
      persistInventory,
      trustedIndexTime,
      persistCustodyIndex: vi.fn(async () => {
        callOrder.push('persist-index');
      }),
      preparePublicationCandidate: vi.fn(async () => {
        callOrder.push('prepare-candidate');
        return publicationCandidate;
      }),
      pinPublicationCandidate: vi.fn(async ({ publicationCandidate }) => {
        callOrder.push('pin-candidate');
        return publicationCandidate;
      }),
      publicationCommand: { register },
    });

    const result = await service.prepare({
      inventoryIndexVerification: custodyFixture.inventoryIndexVerification,
      inventoryCustodyInputs: [{ verification: inventoryVerification, assessmentVerification }],
      preparationKey: 'fixture-publication-preparation:two-party-player-swap',
      universalLayer: 'scarcity_adjusted',
      actor: 'fixture-valuation-publication-worker',
    });

    expect(callOrder).toEqual([
      'custody',
      'trusted-time',
      'persist-index',
      'prepare-candidate',
      'pin-candidate',
      'register',
    ]);
    expect(persistInventory).toHaveBeenCalledWith({
      verification: inventoryVerification,
      assessmentVerification,
    });
    expect(result).toMatchObject({
      status: 'candidate_registered',
      publicationEligible: false,
      custodyIndexVerification: custodyFixture,
      mutation: { idempotentReplay: true },
    });
    expect(result.publication.publicationManifest.content).toMatchObject({
      schemaVersion: 'afl-trade-publication/v4',
      valuationOutputCustodyIndex: {
        valuationOutputCustodyIndexId:
          custodyFixture.output.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      },
    });
  });

  it('rejects a valid but substituted inventory before custody or registration', async () => {
    const expected =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture('two_party_player_swap');
    const substituted =
      createAflTradeValuationOutputInventoryVerificationFixture('three_party_exchange');
    const persistInventory = vi.fn();
    const trustedIndexTime = vi.fn();
    const register = vi.fn();
    const service = createAflTradeValuationPublicationPreparationService({
      environment: 'non_production',
      persistInventory,
      trustedIndexTime,
      persistCustodyIndex: vi.fn(),
      preparePublicationCandidate: vi.fn(),
      pinPublicationCandidate: passThroughCandidatePin(),
      publicationCommand: { register },
    });

    await expect(
      service.prepare({
        inventoryIndexVerification: expected.inventoryIndexVerification,
        inventoryCustodyInputs: [
          {
            verification: substituted,
            assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(
              substituted,
              'three_party_exchange'
            ),
          },
        ],
        preparationKey: 'fixture-publication-preparation:substituted-inventory',
        universalLayer: 'scarcity_adjusted',
        actor: 'fixture-valuation-publication-worker',
      })
    ).rejects.toMatchObject({ code: 'INCOMPLETE_SET' });
    expect(persistInventory).not.toHaveBeenCalled();
    expect(trustedIndexTime).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects the wrong configured environment before creating custody side effects', async () => {
    const expected =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture('two_party_player_swap');
    const inventory =
      createAflTradeValuationOutputInventoryVerificationFixture('two_party_player_swap');
    const persistInventory = vi.fn();
    const trustedIndexTime = vi.fn();
    const register = vi.fn();
    const service = createAflTradeValuationPublicationPreparationService({
      environment: 'production',
      persistInventory,
      trustedIndexTime,
      persistCustodyIndex: vi.fn(),
      preparePublicationCandidate: vi.fn(),
      pinPublicationCandidate: passThroughCandidatePin(),
      publicationCommand: { register },
    });

    await expect(
      service.prepare({
        inventoryIndexVerification: expected.inventoryIndexVerification,
        inventoryCustodyInputs: [
          {
            verification: inventory,
            assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(
              inventory,
              'two_party_player_swap'
            ),
          },
        ],
        preparationKey: 'fixture-publication-preparation:wrong-environment',
        universalLayer: 'scarcity_adjusted',
        actor: 'fixture-valuation-publication-worker',
      })
    ).rejects.toMatchObject({ code: 'PARENT_MISMATCH' });
    expect(persistInventory).not.toHaveBeenCalled();
    expect(trustedIndexTime).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects a different assessment and publication layer before custody', async () => {
    const expected =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture('two_party_player_swap');
    const inventory =
      createAflTradeValuationOutputInventoryVerificationFixture('two_party_player_swap');
    const persistInventory = vi.fn();
    const trustedIndexTime = vi.fn();
    const preparePublicationCandidate = vi.fn();
    const register = vi.fn();
    const service = createAflTradeValuationPublicationPreparationService({
      environment: 'non_production',
      persistInventory,
      trustedIndexTime,
      persistCustodyIndex: vi.fn(),
      preparePublicationCandidate,
      pinPublicationCandidate: passThroughCandidatePin(),
      publicationCommand: { register },
    });

    await expect(
      service.prepare({
        inventoryIndexVerification: expected.inventoryIndexVerification,
        inventoryCustodyInputs: [
          {
            verification: inventory,
            assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(
              inventory,
              'two_party_player_swap'
            ),
          },
        ],
        preparationKey: 'fixture-publication-preparation:wrong-layer',
        universalLayer: 'gross',
        actor: 'fixture-valuation-publication-worker',
      })
    ).rejects.toMatchObject({ code: 'PARENT_MISMATCH' });
    expect(persistInventory).not.toHaveBeenCalled();
    expect(trustedIndexTime).not.toHaveBeenCalled();
    expect(preparePublicationCandidate).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('reuses the completed custody timestamp after a lost registration response', async () => {
    const inventory =
      createAflTradeValuationOutputInventoryVerificationFixture('two_party_player_swap');
    const assessmentVerification = createAflTradeCompleteAssessmentVerificationFixture(
      inventory,
      'two_party_player_swap'
    );
    const custodyFixture =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture('two_party_player_swap');
    const publicationCandidate = candidateAt(custodyFixture.createdAt);
    const attemptedIndexIds: string[] = [];
    const attemptedCandidateIds: string[] = [];
    const attemptedPublicationIds: string[] = [];
    let pinnedCandidate: unknown = null;
    let attempt = 0;
    const register = vi.fn(async (input) => {
      attemptedIndexIds.push(
        input.custodyIndexVerification.output.valuationOutputCustodyIndex
          .valuationOutputCustodyIndexId
      );
      attemptedCandidateIds.push(input.publicationCandidate.publicationId);
      const publication = createAflTradeCustodiedPublicationManifest({
        publicationCandidate: input.publicationCandidate,
        custodyIndexVerification: input.custodyIndexVerification,
      });
      attemptedPublicationIds.push(publication.publicationManifest.publicationId);
      attempt += 1;
      if (attempt === 1) throw new Error('registration response lost');
      return {
        publication,
        mutation: {
          registry: { revision: 4, publications: {}, activeByScope: {} },
          idempotentReplay: true,
        },
      };
    });
    const service = createAflTradeValuationPublicationPreparationService({
      environment: 'non_production',
      persistInventory: vi.fn(async () => custodyFixture.custodyReceipts[0]),
      trustedIndexTime: vi.fn(async () => custodyFixture.createdAt),
      persistCustodyIndex: vi.fn(async () => undefined),
      preparePublicationCandidate: vi.fn(async () => {
        if (attempt === 0) return publicationCandidate;
        const content = {
          ...publicationCandidate.content,
          supportedCohorts: ['changed-after-response-loss'],
        };
        return {
          publicationId: createAflTradeContentAddress('publication', content),
          content,
        };
      }),
      pinPublicationCandidate: vi.fn(async ({ publicationCandidate: candidate }) => {
        pinnedCandidate ??= candidate;
        return pinnedCandidate;
      }),
      publicationCommand: { register },
    });
    const request = {
      inventoryIndexVerification: custodyFixture.inventoryIndexVerification,
      inventoryCustodyInputs: [{ verification: inventory, assessmentVerification }],
      preparationKey: 'fixture-publication-preparation:lost-response',
      universalLayer: 'scarcity_adjusted' as const,
      actor: 'fixture-valuation-publication-worker',
    };

    await expect(service.prepare(request)).rejects.toThrow('registration response lost');
    const replay = await service.prepare(request);

    expect(attemptedIndexIds).toHaveLength(2);
    expect(attemptedIndexIds[0]).toBe(attemptedIndexIds[1]);
    expect(attemptedCandidateIds[0]).toBe(attemptedCandidateIds[1]);
    expect(attemptedPublicationIds[0]).toBe(attemptedPublicationIds[1]);
    expect(replay.mutation.idempotentReplay).toBe(true);
  });
});
