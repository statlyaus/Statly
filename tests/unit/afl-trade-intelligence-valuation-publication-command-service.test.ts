// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { createAflTradeCustodiedProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import { createAflTradeProjectionReleaseArtifact } from '@/server/aflTradeIntelligence/publication/projectionReleaseArtifact';
import { createAflTradeValuationPublicationCommandService } from '@/server/aflTradeIntelligence/publication/valuationPublicationCommandService';
import { aflTradeValuationOutputCustodyIndexVerificationSchema } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustodyIndex';

import {
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

const TRUSTED_AT = '2026-08-08T03:00:00.000Z';

class TrustedClockSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
    return { rows: [{ trusted_at: TRUSTED_AT }] as Row[], rowCount: 1 };
  }
}

describe('AFL trade valuation publication command service', () => {
  it('registers the exact custody-backed publication candidate through the durable registry', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const candidate =
      createAflTradeProjectionManifestFixture().projectionDocumentSetVerification
        .publicationManifest;
    const register = vi.fn(async () => ({
      registry: { revision: 4, publications: {}, activeByScope: {} },
      idempotentReplay: false,
    }));
    const service = createAflTradeValuationPublicationCommandService({
      client: new TrustedClockSql(),
      publicationRepository: {
        load: vi.fn(async () => ({ revision: 3, publications: {}, activeByScope: {} })),
        apply: vi.fn(),
        register,
      } as unknown as AflTradePublicationRepository,
      gateRepository: { load: vi.fn() },
      environment: 'non_production',
      persistProjectionRelease: vi.fn(),
    });

    const result = await service.register({
      publicationCandidate: candidate,
      custodyIndexVerification,
      actor: 'fixture-publication-worker',
    });

    expect(result.publication.publicationManifest.content.schemaVersion).toBe(
      'afl-trade-publication/v4'
    );
    expect(result.publication.publicationManifest.content.valuationOutputCustodyIndex).toEqual({
      schemaVersion:
        custodyIndexVerification.output.valuationOutputCustodyIndex.content.schemaVersion,
      valuationOutputCustodyIndexId:
        custodyIndexVerification.output.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      artifactRef: custodyIndexVerification.output.artifactRef,
      environment: custodyIndexVerification.output.valuationOutputCustodyIndex.content.environment,
      valuationBundleId:
        custodyIndexVerification.output.valuationOutputCustodyIndex.content.valuationBundleId,
      valuationOutputInventoryIndexId:
        custodyIndexVerification.output.valuationOutputCustodyIndex.content
          .valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventorySetSha256:
        custodyIndexVerification.output.valuationOutputCustodyIndex.content
          .valuationOutputInventoryIndex.inventorySetSha256,
      scopeKey: custodyIndexVerification.output.valuationOutputCustodyIndex.content.scopeKey,
      valueUnitId: custodyIndexVerification.output.valuationOutputCustodyIndex.content.valueUnitId,
      entryCount: custodyIndexVerification.output.valuationOutputCustodyIndex.content.entryCount,
      custodyReceiptSetSha256:
        custodyIndexVerification.output.valuationOutputCustodyIndex.content.custodyReceiptSetSha256,
    });
    expect(register).toHaveBeenCalledWith({
      expectedRevision: 3,
      manifest: result.publication.publicationManifest,
      actor: 'fixture-publication-worker',
      evidenceId:
        custodyIndexVerification.output.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      custodyIndexVerification:
        aflTradeValuationOutputCustodyIndexVerificationSchema.parse(custodyIndexVerification),
    });
  });

  it('validates only the exact custodied release at trusted database time', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const fixture = createAflTradeCustodiedProjectionManifestFixture(custodyIndexVerification);
    const materializationInput = {
      ...createAflTradeProjectionManifestMaterializationInput(fixture),
      custodyIndexVerification,
    };
    const verification = {
      ...materializationInput,
      output: createAflTradeCustodiedProjectionManifestMaterialization(materializationInput),
    };
    const releaseArtifact = createAflTradeProjectionReleaseArtifact({
      verification,
      createdAt: TRUSTED_AT,
    });
    const readbackContent = {
      schemaVersion: 'afl-trade-artifact-readback/v4' as const,
      artifact: releaseArtifact.artifactRef,
      repositoryAssurance: 'durable_object_storage' as const,
      artifactClass: 'public_projection' as const,
      custodyProfileId: `artifact-custody-profile:${'a'.repeat(64)}`,
      custodyProfile: null,
      custodyEnvironment: 'non_production' as const,
      verifiedAt: TRUSTED_AT,
      verification: 'exact_reference_and_sha256_bytes' as const,
      status: 'passed' as const,
    };
    const custody = {
      releaseArtifact,
      readback: {
        receiptId: createAflTradeContentAddress('artifact-readback', readbackContent),
        content: readbackContent,
      },
      idempotentReplay: false,
    };
    const apply = vi.fn(async () => ({
      registry: { revision: 2, publications: {}, activeByScope: {} },
      idempotentReplay: false,
    }));
    const publicationRepository = {
      load: vi.fn(async () => ({ revision: 1, publications: {}, activeByScope: {} })),
      apply,
      register: vi.fn(),
    } as unknown as AflTradePublicationRepository;
    const service = createAflTradeValuationPublicationCommandService({
      client: new TrustedClockSql(),
      publicationRepository,
      gateRepository: { load: vi.fn() },
      environment: 'non_production',
      persistProjectionRelease: vi.fn(async () => custody),
    });

    await service.validate({ verification, actor: 'fixture-projection-worker' });

    expect(apply).toHaveBeenCalledWith({
      expectedRevision: 1,
      command: {
        action: 'validate',
        publicationId: fixture.identity.publicationId,
        occurredAt: TRUSTED_AT,
        actor: 'fixture-projection-worker',
        evidenceId: custody.readback.receiptId,
        projectionManifestVerification: releaseArtifact.verification,
      },
      projectionReleaseArtifact: releaseArtifact,
    });
  });

  it('reloads durable Gate authority for approval instead of accepting a caller ledger', async () => {
    const durableLedger = { proposals: [], decisions: [] };
    const apply = vi.fn(async () => ({
      registry: { revision: 8, publications: {}, activeByScope: {} },
      idempotentReplay: false,
    }));
    const service = createAflTradeValuationPublicationCommandService({
      client: new TrustedClockSql(),
      publicationRepository: {
        load: vi.fn(async () => ({ revision: 7, publications: {}, activeByScope: {} })),
        apply,
        register: vi.fn(),
      } as unknown as AflTradePublicationRepository,
      gateRepository: {
        load: vi.fn(async () => ({ revision: 12, ledger: durableLedger })),
      },
      environment: 'non_production',
      persistProjectionRelease: vi.fn(),
    });

    await service.authorize({
      action: 'approve',
      publicationId: `publication:${'b'.repeat(64)}`,
      gateDecisionId: `gate-decision:${'c'.repeat(64)}`,
      actor: 'fixture-publication-reviewer',
    });

    expect(apply).toHaveBeenCalledWith({
      expectedRevision: 7,
      expectedEnvironment: 'non_production',
      command: expect.objectContaining({
        action: 'approve',
        occurredAt: TRUSTED_AT,
        gateDecisionLedger: durableLedger,
        environment: 'non_production',
      }),
    });
  });

  it('withdraws a publication through trusted time and the durable registry boundary', async () => {
    const apply = vi.fn(async () => ({
      registry: { revision: 10, publications: {}, activeByScope: {} },
      idempotentReplay: false,
    }));
    const service = createAflTradeValuationPublicationCommandService({
      client: new TrustedClockSql(),
      publicationRepository: {
        load: vi.fn(async () => ({ revision: 9, publications: {}, activeByScope: {} })),
        apply,
        register: vi.fn(),
      } as unknown as AflTradePublicationRepository,
      gateRepository: { load: vi.fn() },
      environment: 'production',
      persistProjectionRelease: vi.fn(),
    });

    await service.disposition({
      action: 'withdraw',
      publicationId: `publication:${'d'.repeat(64)}`,
      actor: 'production-incident-commander',
      evidenceId: `incident:${'e'.repeat(64)}`,
      reason: 'Projection integrity alert requires immediate independent valuation withdrawal.',
    });

    expect(apply).toHaveBeenCalledWith({
      expectedRevision: 9,
      expectedEnvironment: 'production',
      command: {
        action: 'withdraw',
        publicationId: `publication:${'d'.repeat(64)}`,
        occurredAt: TRUSTED_AT,
        actor: 'production-incident-commander',
        evidenceId: `incident:${'e'.repeat(64)}`,
        reason: 'Projection integrity alert requires immediate independent valuation withdrawal.',
      },
    });
  });
});
