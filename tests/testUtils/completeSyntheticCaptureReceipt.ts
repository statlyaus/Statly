import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { registerSyntheticCaptureAuthority } from './syntheticCaptureAuthorityFixture';

/** Simulated network/admission only. Complete receipts use actual rights/Gate schemas and ledger evaluation. */
export async function completeSyntheticCaptureReceipt(
  sql: AflOutcomeSqlClient,
  input: {
    environment: 'test_fixture' | 'non_production';
    provider: 'draftguru' | 'official_afl';
    year: number;
    sourceUrl: string;
    capabilityId: string;
    dataset: string;
    datasetVersion: string;
    parserVersion: string;
    fieldManifestSha256: string;
    capturedAt: string;
    effectiveAt?: string;
    artifact: AflTradeArtifactRef;
  }
) {
  const request = {
    environment: input.environment,
    provider: input.provider,
    competition: 'AFLM',
    anchorSeasonYear: input.year,
    draftPathway: null,
    dataset: input.dataset,
    datasetVersion: input.datasetVersion,
    accessMechanism: 'automated_web',
    capabilityId: input.capabilityId,
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    effectiveAt: input.effectiveAt ?? input.capturedAt,
    parserVersion: input.parserVersion,
    fieldManifestSha256: input.fieldManifestSha256,
    maximumBytes: 2_000_000,
  };
  const requestSha256 = sha256AflTradeCanonicalJson(request);
  const expires = new Date(Date.now() + 600_000).toISOString();
  const authority = await registerSyntheticCaptureAuthority(sql, {
    key: `synthetic-complete-${requestSha256}`,
    provider: input.provider,
    environment: input.environment,
    year: input.year,
    at: input.capturedAt,
    expires,
    scope: input.artifact,
    fields: ['synthetic_field'],
    dataset: input.dataset,
    datasetVersion: input.datasetVersion,
    clientVersion: input.parserVersion,
    capabilityId: input.capabilityId,
    nullableTerms: true,
  });
  const authorization = await authority.ledger.resolveAuthorization(
    authority.rights.rightsArtifactId
  );
  if (!authorization) throw new Error('Synthetic capture authority was not registered.');
  const gate0aReceipt = createAflTradeGate0AReceipt(
    authorization.ledger,
    authority.rights,
    {
      decisionKey: authority.decisionKey,
      environment: input.environment,
      rightsArtifactId: authority.rights.rightsArtifactId,
      evaluatedAt: input.capturedAt,
      competition: 'AFLM',
      season: input.year,
      accessMechanism: 'automated_web',
      capabilityId: null,
      geography: 'global',
      commercialContext: 'internal-evaluation',
      audience: 'internal',
      operations: [...authority.operations],
      fieldUses: [{ sourceField: 'synthetic_field', use: 'archive_fact' }],
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 3600,
    },
    input.capturedAt
  );
  return createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v2',
    sourceRights: authority.rights,
    gate0aReceipt,
    ledgerRevision: authorization.revision,
    request,
    requestSha256,
    admission: {
      leaseId: createAflTradeContentAddress('external-capture-lease', {
        requestSha256,
        fixture: true,
      }),
      leaseTokenSha256: requestSha256,
      leaseExpiresAt: expires,
      startedAt: input.capturedAt,
      upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
      cacheSeconds: 3600,
      rawRetentionDays: 365,
      egressPolicyEvidenceId: input.artifact.artifactId,
    },
    outcome: {
      status: 'captured',
      completedAt: input.capturedAt,
      sourceUrl: input.sourceUrl,
      contentSha256: input.artifact.contentSha256,
      observedArtifactId: input.artifact.artifactId,
      priorCaptureId: null,
      eTag: null,
      lastModified: null,
    },
  });
}
