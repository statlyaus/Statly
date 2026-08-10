import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradePublicationManifestSchema } from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { createAflTradeCustodiedProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import { createAflTradeProjectionReleaseArtifact } from '@/server/aflTradeIntelligence/publication/projectionReleaseArtifact';
import {
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

const hash = (value: string) => value.repeat(64);
const artifact = (value: string) => ({
  artifactId: `artifact:${hash(value)}`,
  contentSha256: hash(value),
  storageUri: `artifact://sha256/${hash(value)}`,
  mediaType: 'application/json',
  byteLength: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
});

function publicationManifest() {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current',
    createdAt: '2026-08-08T00:00:00.000Z',
    valuationBundleId: `valuation-bundle:${hash('1')}`,
    gate3DecisionId: `gate-decision:${hash('2')}`,
    sourceRegisterIds: ['fixture-source'],
    supportedViews: ['current' as const],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: [],
    valueUnitId: 'fixture-unit',
    entryCount: 1,
    publicationBundleArtifact: artifact('3'),
    methodologyArtifact: artifact('4'),
    validationReportArtifact: artifact('5'),
    modelCardArtifact: artifact('6'),
  };
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

class PublicationSqlFixture implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  head = { revision: 0, registry_json: { revision: 0, publications: {}, activeByScope: {} } };
  manifests: unknown[] = [];
  projections: unknown[] = [];
  events: unknown[] = [];
  pointers: unknown[] = [];
  custodyIndexes: unknown[] = [];
  custodyEntries: unknown[] = [];

  transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    let rows: unknown[] = [];
    let rowCount = 0;
    if (compact.includes('FROM outcome_valuation_publication_registry_head')) {
      rows = [structuredClone(this.head)];
    } else if (compact.includes('FROM outcome_valuation_publication_manifest')) {
      rows = structuredClone(this.manifests);
    } else if (compact.includes('FROM outcome_valuation_projection_manifest')) {
      rows = structuredClone(this.projections);
    } else if (compact.includes('FROM outcome_valuation_publication_event')) {
      rows = structuredClone(this.events);
    } else if (compact.includes('FROM outcome_valuation_active_publication')) {
      rows = structuredClone(this.pointers);
    } else if (compact.includes('FROM outcome_valuation_output_custody_index_entry')) {
      rows = structuredClone(this.custodyEntries);
    } else if (compact.includes('FROM outcome_valuation_output_custody_index')) {
      rows = structuredClone(this.custodyIndexes);
    } else if (compact.startsWith('INSERT INTO outcome_valuation_output_custody_index (')) {
      this.custodyIndexes.push({
        custody_index_id: values[0],
        index_json: JSON.parse(values[10] as string),
        artifact_json: JSON.parse(values[11] as string),
        finalized_at: null,
      });
      rowCount = 1;
    } else if (compact.startsWith('INSERT INTO outcome_valuation_output_custody_index_entry')) {
      this.custodyEntries.push({
        custody_index_id: values[0],
        ordinal: values[1],
        entry_json: JSON.parse(values[7] as string),
      });
      rowCount = 1;
    } else if (compact.startsWith('UPDATE outcome_valuation_output_custody_index SET')) {
      const stored = this.custodyIndexes.find(
        (row) => (row as { custody_index_id: unknown }).custody_index_id === values[0]
      ) as { finalized_at: string | null } | undefined;
      if (stored?.finalized_at === null) {
        stored.finalized_at = '2026-08-08T00:00:00.000Z';
        rowCount = 1;
      }
    } else if (compact.startsWith('INSERT INTO outcome_valuation_publication_manifest')) {
      this.manifests.push({ manifest_json: structuredClone(values[4]) });
      rowCount = 1;
    } else if (compact.startsWith('INSERT INTO outcome_valuation_projection_manifest')) {
      this.projections.push({
        manifest_json: structuredClone(values[5]),
        artifact_id: values[3],
      });
      rowCount = 1;
    } else if (compact.startsWith('INSERT INTO outcome_valuation_publication_event')) {
      this.events.push({ event_json: structuredClone(values[6]) });
      rowCount = 1;
    } else if (compact.startsWith('UPDATE outcome_valuation_publication_registry_head')) {
      if (this.head.revision === values[3]) {
        this.head = {
          revision: values[0] as number,
          registry_json: structuredClone(values[1]) as typeof this.head.registry_json,
        };
        rowCount = 1;
      }
    } else {
      throw new Error(`Unexpected publication SQL: ${compact}`);
    }
    return { rows: rows as Row[], rowCount };
  }
}

describe('PostgreSQL AFL trade valuation publication registry', () => {
  it('persists and reloads one exact custody-backed publication and projection chain', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const fixture = createAflTradeCustodiedProjectionManifestFixture(custodyIndexVerification);
    const manifest = fixture.projectionDocumentSetVerification.publicationManifest;
    if (manifest.content.schemaVersion !== 'afl-trade-publication/v4') {
      throw new Error('Expected the custody-backed fixture to produce publication v4.');
    }
    const sql = new PublicationSqlFixture();
    const repository = createPostgresAflTradePublicationRepository(sql);

    const registered = await repository.register({
      expectedRevision: 0,
      manifest,
      actor: 'fixture-publication-worker',
      evidenceId: manifest.content.valuationOutputCustodyIndex.artifactRef.artifactId,
      custodyIndexVerification,
    });

    expect(registered.idempotentReplay).toBe(false);
    expect(sql.custodyIndexes).toHaveLength(1);
    expect(sql.custodyEntries).toHaveLength(1);
    expect(await repository.load()).toEqual(registered.registry);
    await expect(
      repository.register({
        expectedRevision: 1,
        manifest,
        actor: 'fixture-publication-worker',
        evidenceId: manifest.content.valuationOutputCustodyIndex.artifactRef.artifactId,
        custodyIndexVerification,
      })
    ).resolves.toMatchObject({ idempotentReplay: true });

    const projectionInput = {
      ...createAflTradeProjectionManifestMaterializationInput(fixture),
      custodyIndexVerification,
    };
    const projectionOutput =
      createAflTradeCustodiedProjectionManifestMaterialization(projectionInput);
    const projectionReleaseArtifact = createAflTradeProjectionReleaseArtifact({
      verification: { ...projectionInput, output: projectionOutput },
      createdAt: projectionOutput.projectionManifest.content.createdAt,
    });
    const validationCommand = {
      action: 'validate' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-08T01:00:00.000Z',
      actor: 'fixture-publication-reviewer',
      evidenceId: projectionOutput.projectionManifestArtifactRef.artifactId,
      projectionManifestVerification: { ...projectionInput, output: projectionOutput },
    };
    const changedBytes = Uint8Array.from(projectionReleaseArtifact.bytes);
    changedBytes[0] = changedBytes[0] === 123 ? 91 : 123;
    await expect(
      repository.apply({
        expectedRevision: 1,
        command: validationCommand,
        projectionReleaseArtifact: {
          ...projectionReleaseArtifact,
          bytes: changedBytes,
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(sql.projections).toHaveLength(0);

    const validated = await repository.apply({
      expectedRevision: 1,
      command: validationCommand,
      projectionReleaseArtifact,
    });
    expect(validated.registry.publications[manifest.publicationId]).toMatchObject({
      state: 'validated',
      projectionId: projectionOutput.projectionManifest.projectionId,
    });
    expect(sql.projections).toContainEqual(
      expect.objectContaining({ artifact_id: projectionReleaseArtifact.artifactRef.artifactId })
    );
    expect(projectionReleaseArtifact.artifactRef.artifactId).not.toBe(
      projectionOutput.projectionManifestArtifactRef.artifactId
    );
    expect(await repository.load()).toEqual(validated.registry);

    const withoutCustody = createPostgresAflTradePublicationRepository(new PublicationSqlFixture());
    await expect(
      withoutCustody.register({
        expectedRevision: 0,
        manifest,
        actor: 'fixture-publication-worker',
        evidenceId: manifest.content.valuationOutputCustodyIndex.artifactRef.artifactId,
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('persists, reloads, exactly replays, and advances canonical publication state', async () => {
    const sql = new PublicationSqlFixture();
    const repository = createPostgresAflTradePublicationRepository(sql);
    const manifest = publicationManifest();

    const registered = await repository.register({
      expectedRevision: 0,
      manifest,
      actor: 'fixture-publication-worker',
      evidenceId: artifact('7').artifactId,
    });
    expect(registered.registry.revision).toBe(1);
    expect(registered.idempotentReplay).toBe(false);

    const restarted = createPostgresAflTradePublicationRepository(sql);
    expect(await restarted.load()).toEqual(registered.registry);
    const replay = await restarted.register({
      expectedRevision: 1,
      manifest,
      actor: 'fixture-publication-worker',
      evidenceId: artifact('7').artifactId,
    });
    expect(replay.registry.revision).toBe(1);
    expect(replay.idempotentReplay).toBe(true);

    const rejectionCommand = {
      action: 'reject' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-08T01:00:00.000Z',
      actor: 'fixture-publication-reviewer',
      evidenceId: artifact('8').artifactId,
      reason: 'Fixture rejection exercises durable state.',
    };
    const rejected = await restarted.apply({
      expectedRevision: 1,
      command: rejectionCommand,
    });
    expect(rejected.registry.revision).toBe(2);
    expect(rejected.registry.publications[manifest.publicationId]?.state).toBe('rejected');
    expect(await restarted.load()).toEqual(rejected.registry);

    const rejectionReplay = await restarted.apply({
      expectedRevision: 2,
      command: {
        ...rejectionCommand,
        occurredAt: '2026-08-08T01:05:00.000Z',
      },
    });
    expect(rejectionReplay.registry.revision).toBe(2);
    expect(rejectionReplay.idempotentReplay).toBe(true);
    expect(sql.events).toHaveLength(2);
  });

  it('rejects a stale expected registry revision before mutating state', async () => {
    const sql = new PublicationSqlFixture();
    const repository = createPostgresAflTradePublicationRepository(sql);
    const manifest = publicationManifest();
    await repository.register({
      expectedRevision: 0,
      manifest,
      actor: 'fixture-publication-worker',
      evidenceId: artifact('7').artifactId,
    });

    await expect(
      repository.apply({
        expectedRevision: 0,
        command: {
          action: 'reject',
          publicationId: manifest.publicationId,
          occurredAt: '2026-08-08T01:00:00.000Z',
          actor: 'fixture-publication-reviewer',
          evidenceId: artifact('8').artifactId,
          reason: 'This command is stale.',
        },
      })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(sql.head.revision).toBe(1);
    expect(sql.events).toHaveLength(1);
  });

  it('rejects a disposition across the configured environment boundary', async () => {
    const sql = new PublicationSqlFixture();
    const repository = createPostgresAflTradePublicationRepository(sql);
    const manifest = publicationManifest();
    await repository.register({
      expectedRevision: 0,
      manifest,
      actor: 'fixture-publication-worker',
      evidenceId: artifact('7').artifactId,
    });

    await expect(
      repository.apply({
        expectedRevision: 1,
        expectedEnvironment: 'production',
        command: {
          action: 'reject',
          publicationId: manifest.publicationId,
          occurredAt: '2026-08-08T01:00:00.000Z',
          actor: 'production-incident-commander',
          evidenceId: artifact('8').artifactId,
          reason: 'A production command cannot mutate a fixture publication.',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(sql.head.revision).toBe(1);
    expect(sql.events).toHaveLength(1);
  });
});
