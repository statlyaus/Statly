import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  createAflTradeExternalCaptureExecutionReceipt,
  ingestAflTradeExternalPage,
  type AflTradeExternalPageIngestionDependencies,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';

const digest = (character: string) => character.repeat(64);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const capturedAt = '2026-08-09T07:00:00.000Z';
const sourceScope = {
  environment: 'test_fixture' as const,
  competition: 'AFLM',
  anchorSeasonYear: 2025,
  draftPathway: null,
  dataset: 'draft_trade_facts',
  datasetVersion: '2025',
  accessMechanism: 'public_web',
  capabilityId: 'external-draft-trade-page',
};

function dependencies(options?: { replay?: boolean }) {
  const captureRegistry = {
    loadValidators: vi.fn(async () => ({
      eTag: 'old-tag',
      lastModified: null,
      priorCaptureId: `source-capture:${digest('p')}`,
      priorArtifactId: `artifact:${digest('a')}`,
    })),
    persistNotModified: vi.fn(async () => ({
      attemptId: `source-capture-attempt:${digest('n')}`,
      idempotentReplay: false,
    })),
    persistCapture: vi.fn(async (input: { artifact: { artifactId: string } }) => ({
      captureId: `source-capture:${digest('c')}`,
      artifactId: input.artifact.artifactId,
      idempotentReplay: false,
    })),
  };
  const staging = {
    persist: vi.fn(async () => ({
      batchId: `external-evidence-batch:${digest('b')}`,
      idempotentReplay: options?.replay ?? false,
    })),
  };
  const authorizeCapture = vi.fn<AflTradeExternalPageIngestionDependencies['authorizeCapture']>(
    async (request) => {
      if (request.provider === 'fitzroy_official_afl_player_details') {
        throw new Error('This fixture covers only the bounded external-page providers.');
      }
      return createAflTradeExternalCaptureExecutionReceipt({
        schemaVersion: 'afl-trade-external-capture-execution/v1',
        rightsArtifactId: `source-rights:${digest('a')}`,
        gateDecisionId: `gate-decision:${digest('b')}`,
        gateDecisionKey: 'fixture-production',
        ledgerRevision: 7,
        evaluatedAt: capturedAt,
        provider: request.provider,
        capabilityId: request.capabilityId,
        parserVersion: request.parserVersion,
        fieldManifestSha256: request.fieldManifestSha256,
        upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
        egressPolicyEvidenceId: `artifact:${digest('e')}`,
      });
    }
  );
  return { captureRegistry, staging, authorizeCapture };
}

describe('external AFL draft/trade page ingestion', () => {
  it('stores and reads back raw bytes before registering and staging parsed facts', async () => {
    const rawArtifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' });
    const deps = dependencies();
    const bytes = new TextEncoder().encode('<html>captured trade</html>');
    await rawArtifacts.putIfAbsent(
      createAflTradeByteArtifactRef(bytes, 'text/html; charset=utf-8', '2026-08-08T07:00:00.000Z'),
      bytes
    );
    const capturePage = vi.fn(async () => ({
      status: 'captured' as const,
      sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
      bytes,
      contentSha256: sha256(bytes),
      mediaType: 'text/html; charset=utf-8',
      eTag: 'new-tag',
      lastModified: 'Sat, 09 Aug 2026 07:00:00 GMT',
    }));

    const result = await ingestAflTradeExternalPage(
      {
        ...sourceScope,
        provider: 'draftguru',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
        capturedAt,
        effectiveAt: capturedAt,
        parserVersion: 'draftguru-parser/v1',
        fieldManifestSha256: digest('f'),
        maximumBytes: 1_000_000,
      },
      {
        rawArtifacts,
        captureRegistry: deps.captureRegistry,
        staging: deps.staging,
        authorizeCapture: deps.authorizeCapture,
        capturePage,
        parsePage: ({ capture }) => ({
          evidence: [
            createAflTradeExternalEvidenceEnvelope({
              schemaVersion: 'afl-trade-external-evidence/v1',
              provider: 'draftguru',
              capture,
              sourceRow: { ordinal: 1, sourceKey: 'transaction:fixture' },
              claim: {
                kind: 'transaction',
                nativeEventId: '2025-fixture',
                seasonYear: 2025,
                occurredOn: null,
                transactionType: 'trade',
                title: 'Fixture trade',
              },
              publicationEligible: false,
            }),
          ],
          issues: [],
        }),
      }
    );

    expect(result).toMatchObject({
      status: 'staged',
      captureId: `source-capture:${digest('c')}`,
      idempotentReplay: false,
      evidenceCount: 1,
    });
    expect(capturePage).toHaveBeenCalledWith(
      expect.objectContaining({
        validators: expect.objectContaining({ eTag: 'old-tag', lastModified: null }),
      })
    );
    expect(deps.captureRegistry.persistCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'draftguru',
        executionReceipt: expect.objectContaining({
          content: expect.objectContaining({
            provider: 'draftguru',
            capabilityId: 'external-draft-trade-page',
          }),
        }),
        artifactReadback: expect.objectContaining({
          content: expect.objectContaining({ status: 'passed', artifactClass: 'raw_source' }),
        }),
      })
    );
    expect(deps.authorizeCapture).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'draftguru', capturedAt }),
      expect.objectContaining({
        capture: expect.objectContaining({ status: 'captured' }),
      })
    );
    expect(deps.staging.persist).toHaveBeenCalledTimes(1);
  });

  it('records an audit attempt but no capture or staging batch for an unchanged response', async () => {
    const deps = dependencies();
    const result = await ingestAflTradeExternalPage(
      {
        ...sourceScope,
        provider: 'footywire',
        draftPathway: 'national',
        sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=N',
        capturedAt,
        effectiveAt: capturedAt,
        parserVersion: 'footywire-draft-parser/v1',
        fieldManifestSha256: digest('f'),
        maximumBytes: 1_000_000,
      },
      {
        rawArtifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' }),
        captureRegistry: deps.captureRegistry,
        staging: deps.staging,
        authorizeCapture: deps.authorizeCapture,
        capturePage: async () => ({
          status: 'not_modified',
          sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=N',
          eTag: 'old-tag',
          lastModified: null,
        }),
        parsePage: () => {
          throw new Error('parser must not run');
        },
      }
    );

    expect(result).toEqual({
      status: 'not_modified',
      attemptId: `source-capture-attempt:${digest('n')}`,
    });
    expect(deps.captureRegistry.persistNotModified).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'test_fixture',
        provider: 'footywire',
        dataset: 'draft_trade_facts',
        capabilityId: 'external-draft-trade-page',
        eTag: 'old-tag',
        priorCaptureId: `source-capture:${digest('p')}`,
        priorArtifactId: `artifact:${digest('a')}`,
        executionReceipt: expect.objectContaining({
          content: expect.objectContaining({ provider: 'footywire' }),
        }),
      })
    );
    expect(deps.captureRegistry.persistCapture).not.toHaveBeenCalled();
    expect(deps.staging.persist).not.toHaveBeenCalled();
  });

  it('fails closed when parsed facts do not bind the registered capture', async () => {
    const deps = dependencies();
    await expect(
      ingestAflTradeExternalPage(
        {
          ...sourceScope,
          provider: 'draftguru',
          sourceUrl: 'https://www.draftguru.com.au/years/2025',
          capturedAt,
          effectiveAt: capturedAt,
          parserVersion: 'draftguru-parser/v1',
          fieldManifestSha256: digest('f'),
          maximumBytes: 1_000_000,
        },
        {
          rawArtifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' }),
          captureRegistry: deps.captureRegistry,
          staging: deps.staging,
          authorizeCapture: deps.authorizeCapture,
          capturePage: async () => ({
            status: 'captured',
            sourceUrl: 'https://www.draftguru.com.au/years/2025',
            bytes: new TextEncoder().encode('<html>draft</html>'),
            contentSha256: digest('0'),
            mediaType: 'text/html',
            eTag: null,
            lastModified: null,
          }),
          parsePage: ({ capture }) => ({
            evidence: [
              createAflTradeExternalEvidenceEnvelope({
                schemaVersion: 'afl-trade-external-evidence/v1',
                provider: 'footywire',
                capture: { ...capture, captureId: `source-capture:${digest('x')}` },
                sourceRow: { ordinal: 1, sourceKey: 'forged' },
                claim: {
                  kind: 'draft_selection',
                  draftYear: 2025,
                  draftType: 'national',
                  selectionNumber: 14,
                  roundNumber: 1,
                  player: { nativeId: null, recordedName: 'Harry Kyle' },
                  selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
                },
                publicationEligible: false,
              }),
            ],
            issues: [],
          }),
        }
      )
    ).rejects.toThrow();
    expect(deps.staging.persist).not.toHaveBeenCalled();
  });

  it('fails closed before custody when the capture adapter reports a different byte digest', async () => {
    const deps = dependencies();
    const rawArtifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' });
    await expect(
      ingestAflTradeExternalPage(
        {
          ...sourceScope,
          provider: 'draftguru',
          sourceUrl: 'https://www.draftguru.com.au/years/2025',
          capturedAt,
          effectiveAt: capturedAt,
          parserVersion: 'draftguru-parser/v1',
          fieldManifestSha256: digest('f'),
          maximumBytes: 1_000_000,
        },
        {
          rawArtifacts,
          captureRegistry: deps.captureRegistry,
          staging: deps.staging,
          authorizeCapture: deps.authorizeCapture,
          capturePage: async () => ({
            status: 'captured',
            sourceUrl: 'https://www.draftguru.com.au/years/2025',
            bytes: new TextEncoder().encode('<html>draft</html>'),
            contentSha256: digest('0'),
            mediaType: 'text/html',
            eTag: null,
            lastModified: null,
          }),
          parsePage: () => {
            throw new Error('parser must not run');
          },
        }
      )
    ).rejects.toThrow(/digest/i);
    expect(deps.captureRegistry.persistCapture).not.toHaveBeenCalled();
    expect(deps.staging.persist).not.toHaveBeenCalled();
  });

  it('surfaces exact staging replay without duplicating the captured facts', async () => {
    const deps = dependencies({ replay: true });
    const bytes = new TextEncoder().encode('<html>trade</html>');
    const result = await ingestAflTradeExternalPage(
      {
        ...sourceScope,
        provider: 'draftguru',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
        capturedAt,
        effectiveAt: capturedAt,
        parserVersion: 'draftguru-parser/v1',
        fieldManifestSha256: digest('f'),
        maximumBytes: 1_000_000,
      },
      {
        rawArtifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' }),
        captureRegistry: deps.captureRegistry,
        staging: deps.staging,
        authorizeCapture: deps.authorizeCapture,
        capturePage: async () => ({
          status: 'captured',
          sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
          bytes,
          contentSha256: sha256(bytes),
          mediaType: 'text/html',
          eTag: null,
          lastModified: null,
        }),
        parsePage: ({ capture }) => ({
          evidence: [
            createAflTradeExternalEvidenceEnvelope({
              schemaVersion: 'afl-trade-external-evidence/v1',
              provider: 'draftguru',
              capture,
              sourceRow: { ordinal: 1, sourceKey: 'transaction:fixture' },
              claim: {
                kind: 'transaction',
                nativeEventId: '2025-fixture',
                seasonYear: 2025,
                occurredOn: null,
                transactionType: 'trade',
                title: null,
              },
              publicationEligible: false,
            }),
          ],
          issues: [],
        }),
      }
    );

    expect(result).toMatchObject({ status: 'staged', idempotentReplay: true });
  });

  it('revalidates current authority after retrieval and before any custody or staging write', async () => {
    const deps = dependencies();
    deps.authorizeCapture.mockRejectedValueOnce(new Error('authority withdrawn'));
    const bytes = new TextEncoder().encode('<html>trade</html>');

    await expect(
      ingestAflTradeExternalPage(
        {
          ...sourceScope,
          provider: 'draftguru',
          sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
          capturedAt,
          effectiveAt: capturedAt,
          parserVersion: 'draftguru-parser/v1',
          fieldManifestSha256: digest('f'),
          maximumBytes: 1_000_000,
        },
        {
          rawArtifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' }),
          captureRegistry: deps.captureRegistry,
          staging: deps.staging,
          authorizeCapture: deps.authorizeCapture,
          capturePage: async () => ({
            status: 'captured',
            sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
            bytes,
            contentSha256: sha256(bytes),
            mediaType: 'text/html',
            eTag: null,
            lastModified: null,
          }),
          parsePage: () => {
            throw new Error('parser must not run');
          },
        }
      )
    ).rejects.toThrow(/withdrawn/);
    expect(deps.captureRegistry.persistCapture).not.toHaveBeenCalled();
    expect(deps.staging.persist).not.toHaveBeenCalled();
  });
});
