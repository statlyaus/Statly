// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCompleteAssessmentVerificationFixture } from '../fixtures/aflTradeCompleteAssessmentFixture';
import { createAflTradeValuationOutputInventoryVerificationFixture } from '../fixtures/aflTradeProjectionManifestFixture';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { persistAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';

const VERIFIED_AT = '2026-08-05T11:00:00.000Z';

function durableRepository(environment: 'non_production' | 'production') {
  const delegate = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  return {
    ...delegate,
    assurance: 'durable_object_storage' as const,
    custodyProfile: createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: `valuation-${environment}`,
      environment,
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

function operationAuthority(verifiedAt = VERIFIED_AT) {
  return {
    acquire: vi.fn(async (scope: Record<string, unknown>) => {
      const content = {
        schemaVersion: 'afl-trade-valuation-output-custody-operation/v1' as const,
        ...scope,
        verifiedAt,
      };
      return {
        operationId: createAflTradeContentAddress('valuation-output-custody-operation', content),
        content,
      };
    }),
    complete: vi.fn(async () => undefined),
  };
}

describe('AFL trade valuation output custody', () => {
  it('stores and reads back the exact verified Stage-5 artifact chain idempotently', async () => {
    const repository = durableRepository('non_production');
    const verification = createAflTradeValuationOutputInventoryVerificationFixture();
    const assessmentVerification =
      createAflTradeCompleteAssessmentVerificationFixture(verification);
    const authority = operationAuthority();

    const first = await persistAflTradeValuationOutputInventory(
      { verification, assessmentVerification },
      { repository, operationAuthority: authority }
    );
    const replay = await persistAflTradeValuationOutputInventory(
      { verification, assessmentVerification },
      { repository, operationAuthority: authority }
    );

    expect(first.receipt.content).toMatchObject({
      schemaVersion: 'afl-trade-valuation-output-custody/v1',
      environment: 'non_production',
      operationId: expect.stringMatching(/^valuation-output-custody-operation:[a-f0-9]{64}$/),
      publicationEligible: false,
      valuationOutputInventoryId:
        verification.output.valuationOutputInventory.valuationOutputInventoryId,
      artifactCount: first.receipt.content.artifacts.length,
    });
    expect(first.receipt.content.artifacts).toContainEqual(
      expect.objectContaining({
        role: 'complete_trade_assessment',
        semanticId: assessmentVerification.output.assessmentId,
      })
    );
    expect(first.artifactResults).toContainEqual(
      expect.objectContaining({
        role: 'complete_trade_assessment',
        semanticId: assessmentVerification.output.assessmentId,
        readback: expect.objectContaining({
          content: expect.objectContaining({ status: 'passed' }),
        }),
      })
    );
    expect(first.artifactResults.every(({ status }) => status === 'stored')).toBe(true);
    expect(replay.artifactResults.every(({ status }) => status === 'already_present')).toBe(true);
    expect(first.receiptArtifactStatus).toBe('stored');
    expect(replay.receiptArtifactStatus).toBe('already_present');
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(first.receiptReadback.content.status).toBe('passed');
    expect(first.receiptReadbackArtifactStatus).toBe('stored');
    await expect(
      repository.loadExact(
        first.receiptReadbackArtifactRef,
        first.receiptReadbackArtifactRef.byteLength
      )
    ).resolves.not.toBeNull();
    expect(
      new Set(first.receipt.content.artifacts.map(({ artifact }) => artifact.artifactId)).size
    ).toBe(first.receipt.content.artifactCount);
  });

  it('rejects a changed calculation envelope before writing any artifact', async () => {
    const delegate = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const putIfAbsent = vi.fn(delegate.putIfAbsent.bind(delegate));
    const authority = operationAuthority();
    const verification = createAflTradeValuationOutputInventoryVerificationFixture();
    const tampered = structuredClone(verification);
    tampered.valuationCalculation.valuationCalculation.content.draws.pop();

    await expect(
      persistAflTradeValuationOutputInventory(
        {
          verification: tampered,
          assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(verification),
        },
        { repository: { ...delegate, putIfAbsent }, operationAuthority: authority }
      )
    ).rejects.toMatchObject({ code: 'INVALID_DERIVATION' });

    expect(putIfAbsent).not.toHaveBeenCalled();
    expect(authority.acquire).not.toHaveBeenCalled();
  });

  it('snapshots a hostile verification envelope once before replay and custody', async () => {
    const repository = durableRepository('non_production');
    const authority = operationAuthority();
    const verification = createAflTradeValuationOutputInventoryVerificationFixture();
    const tamperedCalculation = structuredClone(verification.valuationCalculation);
    tamperedCalculation.valuationCalculation.content.draws.pop();
    const hostileVerification = { ...verification };
    const valuationCalculation = vi
      .fn()
      .mockReturnValueOnce(verification.valuationCalculation)
      .mockReturnValue(tamperedCalculation);
    Object.defineProperty(hostileVerification, 'valuationCalculation', {
      enumerable: true,
      get: valuationCalculation,
    });

    const result = await persistAflTradeValuationOutputInventory(
      {
        verification: hostileVerification,
        assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(verification),
      },
      { repository, operationAuthority: authority }
    );

    expect(valuationCalculation).toHaveBeenCalledTimes(1);
    expect(result.receipt.content.valuationCalculationId).toBe(
      verification.valuationCalculation.valuationCalculation.valuationCalculationId
    );
  });

  it('does not accept fixture custody as production evidence', async () => {
    const repository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const authority = operationAuthority();
    const verification = createAflTradeValuationOutputInventoryVerificationFixture();

    await expect(
      persistAflTradeValuationOutputInventory(
        {
          verification,
          assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(verification),
        },
        { repository, operationAuthority: authority }
      )
    ).rejects.toMatchObject({ code: 'CUSTODY_POLICY_MISMATCH' });
    expect(authority.acquire).not.toHaveBeenCalled();
  });

  it('does not relabel a verified non-production bundle as production custody', async () => {
    const repository = durableRepository('production');
    const putIfAbsent = vi.fn(repository.putIfAbsent.bind(repository));
    const authority = operationAuthority();
    const verification = createAflTradeValuationOutputInventoryVerificationFixture();

    await expect(
      persistAflTradeValuationOutputInventory(
        {
          verification,
          assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(verification),
        },
        {
          repository: { ...repository, putIfAbsent },
          operationAuthority: authority,
        }
      )
    ).rejects.toMatchObject({ code: 'CUSTODY_POLICY_MISMATCH' });

    expect(putIfAbsent).not.toHaveBeenCalled();
    expect(authority.acquire).not.toHaveBeenCalled();
  });

  it('uses bounded concurrent artifact custody while preserving canonical result order', async () => {
    const delegate = durableRepository('non_production');
    const authority = operationAuthority();
    let active = 0;
    let peak = 0;
    const tracked = async <T>(operation: () => Promise<T>): Promise<T> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await operation();
      } finally {
        active -= 1;
      }
    };
    const repository = {
      ...delegate,
      putIfAbsent: vi.fn((...args: Parameters<typeof delegate.putIfAbsent>) =>
        tracked(() => delegate.putIfAbsent(...args))
      ),
      loadExact: vi.fn((...args: Parameters<typeof delegate.loadExact>) =>
        tracked(() => delegate.loadExact(...args))
      ),
    };

    const verification = createAflTradeValuationOutputInventoryVerificationFixture();
    const result = await persistAflTradeValuationOutputInventory(
      {
        verification,
        assessmentVerification: createAflTradeCompleteAssessmentVerificationFixture(verification),
      },
      { repository, operationAuthority: authority, maximumConcurrentArtifacts: 4 }
    );

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.artifactResults.map(({ role, semanticId }) => ({ role, semanticId }))).toEqual(
      result.receipt.content.artifacts.map(({ role, semanticId }) => ({ role, semanticId }))
    );
  });
});
