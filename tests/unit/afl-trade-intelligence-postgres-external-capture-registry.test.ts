import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeFixtureArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeExternalCaptureExecutionReceipt,
  createAflTradeLocalFixtureExecutionReceipt,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { PostgresAflTradeExternalCaptureRegistry } from '@/server/aflTradeIntelligence/source/postgresExternalCaptureRegistry';

const capturedAt = '2026-08-09T07:00:00.000Z';

function executionReceipt(evaluatedAt = capturedAt) {
  return createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${'a'.repeat(64)}`,
    gateDecisionId: `gate-decision:${'b'.repeat(64)}`,
    gateDecisionKey: 'draftguru-year-page-production',
    ledgerRevision: 4,
    evaluatedAt,
    provider: 'draftguru',
    capabilityId: 'draftguru-year-page',
    parserVersion: 'draftguru-parser/v1',
    fieldManifestSha256: 'f'.repeat(64),
    upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${'c'.repeat(64)}`,
  });
}

async function captureInput(captureTime = capturedAt) {
  const bytes = new TextEncoder().encode('<html>fixture draft</html>');
  const artifact = createAflTradeByteArtifactRef(bytes, 'text/html; charset=utf-8', captureTime);
  const repository = createAflTradeFixtureArtifactRepository({ artifactClass: 'raw_source' });
  await repository.putIfAbsent(artifact, bytes);
  const artifactReadback = await verifyAflTradeArtifactReadback(
    repository,
    artifact,
    captureTime,
    1_000_000
  );
  return {
    environment: 'test_fixture' as const,
    provider: 'draftguru' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftPathway: null,
    dataset: 'draft_trade_facts',
    datasetVersion: '2025',
    accessMechanism: 'public_web',
    capabilityId: 'draftguru-year-page',
    sourceUrl: 'https://www.draftguru.com.au/years/2025',
    artifact,
    artifactReadback,
    capturedAt: captureTime,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'draftguru-parser/v1',
    fieldManifestSha256: 'f'.repeat(64),
    executionReceipt: executionReceipt(captureTime),
    eTag: 'fixture-etag',
    lastModified: 'Sat, 09 Aug 2026 07:00:00 GMT',
  };
}

function fakeClient(options?: {
  replay?: boolean;
  custodyEnvironment?: string;
  existingCustodyJson?: unknown;
}) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('manifest_json') && sql.includes('sourceUrl')) {
      return {
        rows: [
          {
            capture_id: `source-capture:${'e'.repeat(64)}`,
            source_artifact_id: `artifact:${'a'.repeat(64)}`,
            manifest_json: {
              httpValidators: { eTag: 'stored-etag', lastModified: 'stored-date' },
            },
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_artifact_custody')) {
      return {
        rows: [
          {
            content_sha256: parameters[1],
            storage_uri: parameters[2],
            media_type: parameters[3],
            byte_length: parameters[4],
            artifact_class: 'raw_source',
            environment: options?.custodyEnvironment ?? 'test_fixture',
            custody_profile_id: parameters[7],
            custody_json: options?.existingCustodyJson ?? JSON.parse(String(parameters[10])),
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT attempt_id') && sql.includes("status='not_modified'")) {
      return { rows: [{ attempt_id: parameters[0] }], rowCount: 1 };
    }
    if (sql.includes('SELECT attempt_id') && sql.includes('outcome_source_capture_attempt')) {
      return {
        rows: [
          {
            attempt_id: parameters[0],
            environment: 'test_fixture',
            provider: 'draftguru',
            dataset: 'draft_trade_facts',
            capability_id: 'draftguru-year-page',
            evidence_artifact_id: parameters[5],
            status: 'captured',
            started_at: capturedAt,
            completed_at: capturedAt,
            attempt_json: parameters[8],
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT capture_id') && sql.includes('outcome_source_capture')) {
      return {
        rows: [
          {
            capture_id: parameters[0],
            source_artifact_id: parameters[3],
            manifest_json: JSON.parse(String(parameters[15])),
          },
        ],
        rowCount: 1,
      };
    }
    const isCaptureInsert =
      sql.includes('INSERT INTO outcome_source_capture') &&
      !sql.includes('outcome_source_capture_attempt');
    return {
      rows: [],
      rowCount: isCaptureInsert && options?.replay ? 0 : sql.includes('INSERT') ? 1 : 0,
    };
  };
  const client: AflOutcomeSqlClient = {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
  return { client, statements };
}

describe('PostgreSQL external page capture registry', () => {
  it('loads exact conditional-request validators from the latest immutable capture', async () => {
    const fixture = fakeClient();
    const registry = new PostgresAflTradeExternalCaptureRegistry(fixture.client);

    await expect(
      registry.loadValidators({
        environment: 'test_fixture',
        provider: 'draftguru',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        draftPathway: null,
        dataset: 'draft_trade_facts',
        datasetVersion: '2025',
        capabilityId: 'draftguru-year-page',
        sourceUrl: 'https://www.draftguru.com.au/years/2025',
        parserVersion: 'draftguru-parser/v1',
        fieldManifestSha256: 'f'.repeat(64),
      })
    ).resolves.toEqual({
      eTag: 'stored-etag',
      lastModified: 'stored-date',
      priorCaptureId: `source-capture:${'e'.repeat(64)}`,
      priorArtifactId: `artifact:${'a'.repeat(64)}`,
    });
    expect(fixture.statements[0]?.parameters).toEqual([
      'test_fixture',
      'draftguru',
      'AFLM',
      2025,
      'draft_trade_facts',
      '2025',
      'draftguru-year-page',
      'https://www.draftguru.com.au/years/2025',
      'draftguru-parser/v1',
      'f'.repeat(64),
      null,
    ]);
    expect(fixture.statements[0]?.sql).toContain("batch.status='finalized'");
    expect(fixture.statements[0]?.sql).toContain("capture.manifest_json->>'parserVersion'=$9");
    expect(fixture.statements[0]?.sql).toContain("manifest_json->>'draftPathway'");
  });

  it('persists raw custody, capture attempt and source capture atomically', async () => {
    const fixture = fakeClient();
    const registry = new PostgresAflTradeExternalCaptureRegistry(fixture.client);
    const result = await registry.persistCapture(await captureInput());

    expect(result.captureId).toMatch(/^source-capture:[a-f0-9]{64}$/);
    expect(result.artifactId).toMatch(/^artifact:[a-f0-9]{64}$/);
    expect(result.idempotentReplay).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes('outcome_artifact_custody'))).toBe(
      true
    );
    expect(
      fixture.statements.some(({ sql }) => sql.includes('outcome_source_capture_attempt'))
    ).toBe(true);
    expect(fixture.statements.some(({ sql }) => sql.includes('outcome_source_capture'))).toBe(true);
  });

  it('persists a content-addressed not-modified audit attempt', async () => {
    const fixture = fakeClient();
    const registry = new PostgresAflTradeExternalCaptureRegistry(fixture.client);
    await expect(
      registry.persistNotModified({
        environment: 'test_fixture',
        provider: 'draftguru',
        dataset: 'draft_trade_facts',
        capabilityId: 'draftguru-year-page',
        sourceUrl: 'https://www.draftguru.com.au/years/2025',
        capturedAt,
        eTag: 'stored-etag',
        lastModified: 'stored-date',
        priorCaptureId: `source-capture:${'e'.repeat(64)}`,
        priorArtifactId: `artifact:${'a'.repeat(64)}`,
        executionReceipt: executionReceipt(),
      })
    ).resolves.toMatchObject({
      attemptId: expect.stringMatching(/^source-capture-attempt:[a-f0-9]{64}$/),
      idempotentReplay: false,
    });
  });

  it('accepts a later capture of identical bytes while retaining first-writer custody', async () => {
    const first = await captureInput();
    const second = await captureInput('2026-08-10T07:00:00.000Z');
    const registry = new PostgresAflTradeExternalCaptureRegistry(
      fakeClient({ existingCustodyJson: first.artifactReadback }).client
    );

    await expect(registry.persistCapture(second)).resolves.toMatchObject({
      artifactId: first.artifact.artifactId,
      idempotentReplay: false,
    });
  });

  it('reports exact capture replay and rejects custody from another environment', async () => {
    const replay = new PostgresAflTradeExternalCaptureRegistry(fakeClient({ replay: true }).client);
    await expect(replay.persistCapture(await captureInput())).resolves.toMatchObject({
      idempotentReplay: true,
    });

    const wrongEnvironment = new PostgresAflTradeExternalCaptureRegistry(
      fakeClient({ custodyEnvironment: 'production' }).client
    );
    await expect(wrongEnvironment.persistCapture(await captureInput())).rejects.toThrow(
      /custody environment/i
    );
  });

  it('rejects a valid execution receipt bound to another capability', async () => {
    const input = await captureInput();
    if (
      input.executionReceipt.content.schemaVersion !== 'afl-trade-external-capture-execution/v1'
    ) {
      throw new Error('Fixture must use the legacy test-only receipt.');
    }
    input.executionReceipt = createAflTradeExternalCaptureExecutionReceipt({
      ...input.executionReceipt.content,
      capabilityId: 'draftguru-trade-detail',
    });
    const registry = new PostgresAflTradeExternalCaptureRegistry(fakeClient().client);

    await expect(registry.persistCapture(input)).rejects.toThrow(/receipt|capture/i);
  });

  it('rejects legacy fixture receipts at every non-fixture persistence entry point', async () => {
    const registry = new PostgresAflTradeExternalCaptureRegistry(fakeClient().client);
    await expect(
      registry.persistCapture({ ...(await captureInput()), environment: 'production' })
    ).rejects.toThrow(/execution receipt v2/i);
    await expect(
      registry.persistNotModified({
        environment: 'production',
        provider: 'draftguru',
        dataset: 'draft_trade_facts',
        capabilityId: 'draftguru-year-page',
        sourceUrl: 'https://www.draftguru.com.au/years/2025',
        capturedAt,
        eTag: 'stored-etag',
        lastModified: 'stored-date',
        priorCaptureId: `source-capture:${'e'.repeat(64)}`,
        priorArtifactId: `artifact:${'a'.repeat(64)}`,
        executionReceipt: executionReceipt(),
      })
    ).rejects.toThrow(/execution receipt v2/i);
  });

  it('rejects local generation receipts at the external capture registry', async () => {
    const input = {
      ...(await captureInput()),
      executionReceipt: createAflTradeLocalFixtureExecutionReceipt({
        schemaVersion: 'statly-local-fixture-execution/v1',
        environment: 'test_fixture',
        fixtureOnly: true,
        liveSourceAccessed: false,
        providerRightsExpanded: false,
        rightsArtifactId: `source-rights:${'a'.repeat(64)}`,
        gateDecisionId: `gate-decision:${'b'.repeat(64)}`,
        gateDecisionKey: 'fixture-local-generation',
        ledgerRevision: 7,
        provider: 'statly_local_fixture',
        capabilityId: 'statly-local-generated-fixture',
        parserVersion: 'statly-local-fixture/v1',
        fieldManifestSha256: 'f'.repeat(64),
        fixtureEvidenceId: `artifact:${'e'.repeat(64)}`,
      }),
    };
    const registry = new PostgresAflTradeExternalCaptureRegistry(fakeClient().client);

    await expect(registry.persistCapture(input)).rejects.toThrow(/local fixture receipt/i);
  });

  it('keeps terminal capture attempts append-only in PostgreSQL', () => {
    const migration = readFileSync(
      'prisma/afl-trade-outcomes/migrations/0002_normalized_analytical_authority/migration.sql',
      'utf8'
    );
    expect(migration).toContain(`IF OLD."status" <> 'started' OR EXISTS (`);
  });
});
