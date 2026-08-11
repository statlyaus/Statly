import { describe, expect, it, vi } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createApprovedAflTradeExternalGateRecords } from '@/server/aflTradeIntelligence/source/approvedExternalDraftTradeGateRecords';
import { createApprovedAflTradeExternalSourcePolicies } from '@/server/aflTradeIntelligence/source/approvedExternalDraftTradeSourcePolicies';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
import {
  ingestAuthorizedAflTradeExternalPage,
  type AflTradeExternalProviderIngestionDependencies,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { PostgresAflTradeExternalCaptureRegistry } from '@/server/aflTradeIntelligence/source/postgresExternalCaptureRegistry';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;
const sourceRights = createApprovedAflTradeExternalSourcePolicies({
  fieldSets: {
    'draftguru-trade-index': [
      {
        sourceField: 'trade_url',
        normalizedField: 'trade_detail_link.sourceUrl',
        uses: {
          archive_fact: 'allowed',
          model_training: 'blocked',
          derived_feature: 'blocked',
          public_display: 'blocked',
        },
        attributionRequired: true,
        notes: null,
      },
    ],
    'draftguru-trade-detail': [
      {
        sourceField: 'trade_id',
        normalizedField: 'transaction.nativeEventId',
        uses: {
          archive_fact: 'allowed',
          model_training: 'allowed',
          derived_feature: 'allowed',
          public_display: 'allowed',
        },
        attributionRequired: true,
        notes: null,
      },
    ],
    'draftguru-year-page': [
      {
        sourceField: 'selection_number',
        normalizedField: 'selection.number',
        uses: {
          archive_fact: 'allowed',
          model_training: 'allowed',
          derived_feature: 'allowed',
          public_display: 'allowed',
        },
        attributionRequired: true,
        notes: null,
      },
    ],
    'footywire-draft-results': [
      {
        sourceField: 'selection_number',
        normalizedField: 'selection.number',
        uses: {
          archive_fact: 'allowed',
          model_training: 'allowed',
          derived_feature: 'allowed',
          public_display: 'allowed',
        },
        attributionRequired: true,
        notes: null,
      },
    ],
    'official-afl-indicative-draft-order': [
      {
        sourceField: 'pick_number',
        normalizedField: 'custody.recordedPickNumber',
        uses: {
          archive_fact: 'allowed',
          model_training: 'allowed',
          derived_feature: 'allowed',
          public_display: 'allowed',
        },
        attributionRequired: true,
        notes: null,
      },
    ],
  },
  datasetVersions: {
    'draftguru-trade-index': '2026-08-09',
    'draftguru-trade-detail': '2026-08-09',
    'draftguru-year-page': '2026-08-09',
    'footywire-draft-results': '2026-08-09',
    'official-afl-indicative-draft-order': '2026-08-09',
  },
  parserVersions: {
    'draftguru-trade-index': 'draftguru-trade-index-parser/v1',
    'draftguru-trade-detail': 'draftguru-trade-parser/v1',
    'draftguru-year-page': 'draftguru-year-parser/v1',
    'footywire-draft-results': 'footywire-draft-parser/v1',
    'official-afl-indicative-draft-order': 'official-afl-order-parser/v1',
  },
  conditionEvidence: {
    'draftguru-trade-index': {
      'discovery-field-boundary': artifact('9'),
      'html-schema-fingerprint': artifact('0'),
    },
    'draftguru-trade-detail': {
      'transaction-field-boundary': artifact('1'),
      'html-schema-fingerprint': artifact('2'),
    },
    'draftguru-year-page': {
      'selection-field-boundary': artifact('3'),
      'html-schema-fingerprint': artifact('4'),
    },
    'footywire-draft-results': {
      'selection-corroboration-only': artifact('5'),
      'html-schema-fingerprint': artifact('6'),
    },
    'official-afl-indicative-draft-order': {
      'indicative-order-not-final-selection': artifact('7'),
      'article-schema-fingerprint': artifact('8'),
    },
  },
  evidence: { terms: artifact('a'), authority: artifact('b'), egress: artifact('d') },
  termsEffectiveAt: '2026-08-09T00:00:00.000Z',
  termsExpireAt: '2027-08-09T00:00:00.000Z',
  proposedAt: '2026-08-09T00:01:00.000Z',
  proposedBy: 'data-owner',
}).find(
  ({ content }) =>
    content.acquisition.kind === 'provider_web' &&
    content.acquisition.capabilityId === 'draftguru-trade-detail'
)!;

const records = createApprovedAflTradeExternalGateRecords({
  sourceRights,
  environment: 'production',
  version: 1,
  supersedesDecisionId: null,
  decidedAt: '2026-08-09T00:02:00.000Z',
  effectiveAt: '2026-08-09T00:02:00.000Z',
  revalidateAt: '2027-08-09T00:00:00.000Z',
  accountableOwner: 'data-owner',
  reviewer: { id: 'reviewer', role: 'source-reviewer', evidenceId: artifact('c') },
  authorityEvidenceId: artifact('b'),
});

const request = {
  environment: 'production' as const,
  provider: 'draftguru' as const,
  competition: 'AFLM',
  anchorSeasonYear: 2026,
  draftPathway: null,
  dataset: sourceRights.content.dataset,
  datasetVersion: sourceRights.content.datasetVersion,
  accessMechanism: 'automated_web',
  capabilityId: 'draftguru-trade-detail',
  sourceUrl: 'https://www.draftguru.com.au/trades/2026-fixture',
  capturedAt: '2026-08-10T00:00:00.000Z',
  effectiveAt: '2026-08-09T00:00:00.000Z',
  parserVersion: 'draftguru-trade-parser/v1',
  fieldManifestSha256: sha256AflTradeCanonicalJson(sourceRights.content.fields),
  maximumBytes: 1_000_000,
};

const gateRequest = {
  decisionKey: records.decision.content.decisionKey,
  environment: 'production' as const,
  rightsArtifactId: sourceRights.rightsArtifactId,
  evaluatedAt: '2026-08-10T00:00:00.000Z',
  competition: 'AFLM',
  season: 2026,
  accessMechanism: 'automated_web' as const,
  capabilityId: null,
  geography: 'global',
  commercialContext: 'public-research',
  audience: 'public',
  operations: ['bounded_evaluation_capture', 'raw_evidence_retention'] as const,
  fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' as const }],
  rawRetentionDays: 365,
  metadataRetentionDays: null,
  cacheSeconds: 86_400,
};

function fixtureDependencies() {
  const resolveAuthorization = vi.fn(async () => ({
    revision: 1,
    ledger: { proposals: [records.proposal], decisions: [records.decision] },
    sourceRights,
  }));
  const complete = vi.fn(async () => undefined);
  const persistNotModified = vi.fn(async () => ({
    attemptId: 'attempt-1',
    idempotentReplay: false,
  }));
  const dependencies: AflTradeExternalProviderIngestionDependencies = {
    admission: {
      acquire: vi.fn(async () => ({
        status: 'admitted' as const,
        lease: {
          provider: 'draftguru' as const,
          capabilityId: request.capabilityId,
          requestSha256: 'd'.repeat(64),
          token: 'fixture-token',
          providerKey: 'provider',
          requestKey: 'request',
          expiresAtMs: Date.parse('2026-08-10T00:01:00.000Z'),
          providerCooldownMs: 1_000,
          successRequestCooldownMs: 86_400_000,
          egressPolicyEvidenceId: artifact('d'),
        },
      })),
      complete,
    },
    policyFor: () => ({
      upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
      cacheSeconds: 86_400,
      maximumLeaseMs: 60_000,
      egressPolicyEvidenceId: artifact('d'),
      rawRetentionDays: 365,
    }),
    resolveAuthorization,
    ingestion: {
      rawArtifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' }),
      captureRegistry: {
        loadValidators: async () => ({
          priorCaptureId: `source-capture:${'e'.repeat(64)}`,
          priorArtifactId: artifact('f'),
          eTag: 'fixture-etag',
          lastModified: null,
        }),
        persistNotModified,
        persistCapture: async (input) => ({
          captureId: `source-capture:${'9'.repeat(64)}`,
          artifactId: input.artifact.artifactId,
          idempotentReplay: false,
        }),
      },
      staging: { persist: async () => ({ batchId: 'unused', idempotentReplay: false }) },
      capturePage: async () => ({
        status: 'not_modified' as const,
        sourceUrl: request.sourceUrl,
        eTag: 'fixture-etag',
        lastModified: null,
      }),
      parsePage: () => ({ evidence: [], issues: [] }),
    },
    clock: { now: () => '2026-08-10T00:00:00.000Z' },
  };
  return {
    resolveAuthorization,
    complete,
    persistNotModified,
    dependencies,
  };
}

describe('authorized external provider ingestion', () => {
  it('rechecks durable authority after retrieval and completes the admitted lease', async () => {
    const fixture = fixtureDependencies();
    const result = await ingestAuthorizedAflTradeExternalPage(
      { request, gateRequest },
      fixture.dependencies
    );

    expect(result).toEqual({
      status: 'completed',
      result: { status: 'not_modified', attemptId: 'attempt-1' },
    });
    expect(fixture.resolveAuthorization).toHaveBeenCalledTimes(2);
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'succeeded' })
    );
    expect(fixture.persistNotModified).toHaveBeenCalledWith(
      expect.objectContaining({
        executionReceipt: expect.objectContaining({
          content: expect.objectContaining({
            schemaVersion: 'afl-trade-external-capture-execution/v2',
            request: expect.objectContaining({ sourceUrl: request.sourceUrl }),
            requestSha256: sha256AflTradeCanonicalJson(request),
            admission: expect.objectContaining({
              leaseId: expect.stringMatching(/^external-capture-lease:[a-f0-9]{64}$/),
              leaseTokenSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
            outcome: expect.objectContaining({
              status: 'not_modified',
              priorCaptureId: `source-capture:${'e'.repeat(64)}`,
              observedArtifactId: artifact('f'),
            }),
          }),
        }),
      })
    );
  });

  it('rejects parser output outside the exact reviewed source-field manifest', () => {
    const gate0aReceipt = createAflTradeGate0AReceipt(
      { proposals: [records.proposal], decisions: [records.decision] },
      sourceRights,
      gateRequest,
      gateRequest.evaluatedAt
    );
    const evidence = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'draftguru',
      capture: {
        captureId: `source-capture:${'1'.repeat(64)}`,
        artifactId: artifact('2'),
        contentSha256: '2'.repeat(64),
        mediaType: 'text/html',
        sourceUrl: request.sourceUrl,
        capturedAt: request.capturedAt,
        effectiveAt: request.effectiveAt,
        parserVersion: request.parserVersion,
        fieldManifestSha256: request.fieldManifestSha256,
      },
      sourceRow: { ordinal: 1, sourceKey: 'trade-row' },
      claim: {
        kind: 'transaction',
        nativeEventId: '2026-fixture',
        seasonYear: 2026,
        occurredOn: '2026-08-09',
        transactionType: 'trade',
        title: 'Unreviewed title',
      },
      publicationEligible: false,
    });

    expect(() =>
      requireAflTradeExternalEvidenceFieldAuthority({
        evidence: [evidence],
        sourceRights,
        gate0aReceipt,
      })
    ).toThrow(/outside the reviewed/i);
  });

  it('rejects substitution of another capability under valid provider rights', async () => {
    const fixture = fixtureDependencies();

    await expect(
      ingestAuthorizedAflTradeExternalPage(
        {
          request: {
            ...request,
            capabilityId: 'draftguru-year-page',
            sourceUrl: 'https://www.draftguru.com.au/years/2026',
          },
          gateRequest,
        },
        fixture.dependencies
      )
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
    expect(fixture.dependencies.admission.acquire).not.toHaveBeenCalled();
  });

  it('rejects a URL whose encoded year does not match the authorized anchor', async () => {
    const fixture = fixtureDependencies();

    await expect(
      ingestAuthorizedAflTradeExternalPage(
        {
          request: {
            ...request,
            capabilityId: 'draftguru-year-page',
            sourceUrl: 'https://www.draftguru.com.au/years/2025',
          },
          gateRequest,
        },
        fixture.dependencies
      )
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
    expect(fixture.resolveAuthorization).not.toHaveBeenCalled();
  });

  it('rejects runtime rate, cache, retention or egress controls that differ from rights', async () => {
    const fixture = fixtureDependencies();
    fixture.dependencies.policyFor = () => ({
      upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
      cacheSeconds: 86_400,
      maximumLeaseMs: 60_000,
      egressPolicyEvidenceId: artifact('d'),
      rawRetentionDays: 365,
    });

    await expect(
      ingestAuthorizedAflTradeExternalPage({ request, gateRequest }, fixture.dependencies)
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
    expect(fixture.dependencies.admission.acquire).not.toHaveBeenCalled();
  });

  it('fails the lease when authority is withdrawn during retrieval', async () => {
    const fixture = fixtureDependencies();
    fixture.resolveAuthorization
      .mockResolvedValueOnce({
        revision: 1,
        ledger: { proposals: [records.proposal], decisions: [records.decision] },
        sourceRights,
      })
      .mockRejectedValueOnce(new Error('withdrawn'));

    await expect(
      ingestAuthorizedAflTradeExternalPage({ request, gateRequest }, fixture.dependencies)
    ).rejects.toThrow('withdrawn');
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failed' })
    );
  });

  it('rejects a receipt when its claimed Gate authority is absent from durable storage', async () => {
    const fixture = fixtureDependencies();
    const statements: string[] = [];
    const query: AflOutcomeSqlClient['query'] = async (sql) => {
      statements.push(sql);
      return (
        sql.includes('manifest_json') && sql.includes('sourceUrl')
          ? {
              rows: [
                {
                  capture_id: `source-capture:${'e'.repeat(64)}`,
                  source_artifact_id: artifact('f'),
                  manifest_json: {
                    httpValidators: { eTag: 'fixture-etag', lastModified: null },
                  },
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 }
      ) as never;
    };
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };
    fixture.dependencies.ingestion.captureRegistry = new PostgresAflTradeExternalCaptureRegistry(
      client
    );

    await expect(
      ingestAuthorizedAflTradeExternalPage({ request, gateRequest }, fixture.dependencies)
    ).rejects.toThrow(/durable Gate 0A authority/i);
    expect(
      statements.some(
        (sql) => sql.includes("affectedArtifacts' @>") && sql.includes('clock_timestamp()')
      )
    ).toBe(true);
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failed' })
    );
  });
});
