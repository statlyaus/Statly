// @vitest-environment node

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { aflTradePublicationManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/publicationProjectionManifests';
import { createAflTradeValuationOutputInventoryIndex } from '@/server/aflTradeIntelligence/artifacts/valuationOutputInventoryIndex';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { createPostgresAflTradeValuationOutputCustodyOperationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresValuationOutputCustodyOperationAuthority';
import { persistAflTradeValuationOutputInventory } from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';
import {
  createAflTradeCustodiedPublicationManifest,
  createAflTradeValuationOutputCustodyIndex,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputCustodyIndex';
import {
  createAflTradeProjectionManifestFixture,
  createAflTradeValuationOutputInventoryVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';
import { createAflTradeCompleteAssessmentVerificationFixture } from '../fixtures/aflTradeCompleteAssessmentFixture';

class PgliteSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly db: PGlite) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.db.query<Row>(sql, [...parameters]);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const output = await work(this);
      await this.db.exec('COMMIT');
      return output;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

async function applyOutcomeMigrations(db: PGlite): Promise<void> {
  const root = join(process.cwd(), 'prisma/afl-trade-outcomes/migrations');
  const names: string[] = [];
  for (const name of (await readdir(root)).sort()) {
    if ((await stat(join(root, name))).isDirectory()) names.push(name);
  }
  await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  for (const name of names) {
    await db.exec(await readFile(join(root, name, 'migration.sql'), 'utf8'));
  }
}

function durableRepository() {
  const delegate = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  return {
    ...delegate,
    assurance: 'durable_object_storage' as const,
    custodyProfile: createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: 'publication-custody-postgres-test',
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

describe('valuation publication custody PostgreSQL boundary', () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it('persists, finalizes, reloads, and freezes the exact custody-backed publication parent', async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await applyOutcomeMigrations(db);
    const client = new PgliteSqlClient(db);
    const inventoryVerification = createAflTradeValuationOutputInventoryVerificationFixture();
    const assessmentVerification =
      createAflTradeCompleteAssessmentVerificationFixture(inventoryVerification);
    const inventory = {
      valuationOutputInventory: inventoryVerification.output.valuationOutputInventory,
      artifactRef: inventoryVerification.output.valuationOutputInventoryArtifactRef,
    };
    const inventoryIndex = createAflTradeValuationOutputInventoryIndex({
      valuationBundleManifest: inventoryVerification.valuationBundle.valuationBundleManifest,
      valuationBundleArtifactRef: inventoryVerification.valuationBundle.artifactRef,
      valuationOutputInventories: [inventory],
      createdAt: '2026-08-05T05:00:00.000Z',
    });
    const custody = await persistAflTradeValuationOutputInventory(
      { verification: inventoryVerification, assessmentVerification },
      {
        repository: durableRepository(),
        operationAuthority: createPostgresAflTradeValuationOutputCustodyOperationAuthority(client),
      }
    );
    const indexCreatedAt = custody.receipt.content.verifiedAt;
    const custodyRequest = {
      inventoryIndexVerification: {
        valuationBundleManifest: inventoryVerification.valuationBundle.valuationBundleManifest,
        valuationBundleArtifactRef: inventoryVerification.valuationBundle.artifactRef,
        valuationOutputInventories: [inventory],
        output: inventoryIndex,
      },
      custodyReceipts: [custody],
      createdAt: indexCreatedAt,
    };
    const custodyOutput = createAflTradeValuationOutputCustodyIndex(custodyRequest);
    const custodyVerification = { ...custodyRequest, output: custodyOutput };
    const original =
      createAflTradeProjectionManifestFixture().projectionDocumentSetVerification
        .publicationManifest;
    if (original.content.schemaVersion !== 'afl-trade-publication/v3') {
      throw new Error('Expected the legacy fixture publication candidate to be v3.');
    }
    const publicationBundleAt = indexCreatedAt;
    const publicationAt = indexCreatedAt;
    const candidateContent = {
      ...structuredClone(original.content),
      createdAt: publicationAt,
      publicationBundleArtifact: createAflTradeCanonicalJsonArtifactRef(
        { fixtureArtifact: 'postgres-custodied-publication-bundle' },
        publicationBundleAt
      ),
    };
    const publicationCandidate = aflTradePublicationManifestV3Schema.parse({
      publicationId: createAflTradeContentAddress('publication', candidateContent),
      content: candidateContent,
    });
    const publication = createAflTradeCustodiedPublicationManifest({
      publicationCandidate,
      custodyIndexVerification: custodyVerification,
    }).publicationManifest;
    const repository = createPostgresAflTradePublicationRepository(client);

    const registered = await repository.register({
      expectedRevision: 0,
      manifest: publication,
      actor: 'fixture-publication-worker',
      evidenceId: custodyOutput.artifactRef.artifactId,
      custodyIndexVerification: custodyVerification,
    });

    expect(registered.idempotentReplay).toBe(false);
    expect(await createPostgresAflTradePublicationRepository(client).load()).toEqual(
      registered.registry
    );
    const projectionCreatedAt = new Date(publication.content.createdAt);
    const trustedProjectionTime = await db.query<{ trusted_at: string }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp())::text AS trusted_at`
    );
    const projectionVerifiedAt = trustedProjectionTime.rows[0]?.trusted_at;
    if (projectionVerifiedAt === undefined) throw new Error('Missing trusted projection time.');
    const projectionArtifact = createAflTradeCanonicalJsonArtifactRef(
      { fixtureArtifact: 'postgres-public-projection-release-envelope' },
      projectionCreatedAt.toISOString()
    );
    const projectionId = `projection:${'c'.repeat(64)}`;
    const projectionManifest = {
      projectionId,
      content: {
        schemaVersion: 'afl-trade-projection/v3',
        publicationId: publication.publicationId,
        environment: publication.content.environment,
        scopeKey: publication.content.scopeKey,
        createdAt: projectionCreatedAt.toISOString(),
        valuationOutputCustodyIndex: publication.content.valuationOutputCustodyIndex,
      },
    };
    await db.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'public_projection',$6,$7,$8,$9,$10)`,
      [
        projectionArtifact.artifactId,
        projectionArtifact.contentSha256,
        projectionArtifact.storageUri,
        projectionArtifact.mediaType,
        projectionArtifact.byteLength,
        publication.content.environment,
        'artifact-custody-profile:fixture-public-projection',
        projectionArtifact.createdAt,
        projectionVerifiedAt,
        {},
      ]
    );
    const projectionPredicates = await db.query<Record<string, boolean>>(
      `SELECT $3::timestamptz < publication.created_at AS projection_predates_publication,
              $4::text <> publication.scope_key AS scope_mismatch,
              artifact.artifact_class <> 'public_projection'::"OutcomeArtifactClass"
                AS class_mismatch,
              artifact.environment::text <>
                publication.manifest_json->'content'->>'environment' AS environment_mismatch,
              artifact.created_at < $3::timestamptz AS artifact_predates_projection,
              artifact.verified_at > date_trunc('milliseconds',transaction_timestamp())
                AS verification_is_future,
              $5::text IS DISTINCT FROM publication.custody_index_id AS custody_id_mismatch,
              $6::jsonb IS DISTINCT FROM
                publication.manifest_json->'content'->'valuationOutputCustodyIndex'
                AS custody_binding_mismatch
         FROM outcome_valuation_publication_manifest publication
         JOIN outcome_artifact_custody artifact ON artifact.artifact_id=$2
        WHERE publication.publication_id=$1`,
      [
        publication.publicationId,
        projectionArtifact.artifactId,
        projectionCreatedAt.toISOString(),
        publication.content.scopeKey,
        publication.content.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
        publication.content.valuationOutputCustodyIndex,
      ]
    );
    expect(projectionPredicates.rows).toEqual([
      {
        projection_predates_publication: false,
        scope_mismatch: false,
        class_mismatch: false,
        environment_mismatch: false,
        artifact_predates_projection: false,
        verification_is_future: false,
        custody_id_mismatch: false,
        custody_binding_mismatch: false,
      },
    ]);
    await db.query(
      `INSERT INTO outcome_valuation_projection_manifest
        (projection_id,publication_id,custody_index_id,artifact_id,created_at,manifest_json)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        projectionId,
        publication.publicationId,
        publication.content.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
        projectionArtifact.artifactId,
        projectionCreatedAt.toISOString(),
        projectionManifest,
      ]
    );
    await expect(
      db.query<{ projection_id: string }>(
        `SELECT projection_id FROM outcome_valuation_projection_manifest WHERE projection_id=$1`,
        [projectionId]
      )
    ).resolves.toMatchObject({ rows: [{ projection_id: projectionId }] });
    const stored = await db.query<{
      finalized_at: string;
      entry_count: number;
      members: number;
    }>(
      `SELECT parent.finalized_at::text, parent.entry_count,
                count(member.*)::integer AS members
           FROM outcome_valuation_output_custody_index parent
           JOIN outcome_valuation_output_custody_index_entry member
             ON member.custody_index_id=parent.custody_index_id
          GROUP BY parent.custody_index_id`
    );
    expect(stored.rows[0]).toMatchObject({ entry_count: 1, members: 1 });
    await expect(
      db.exec(
        `UPDATE outcome_valuation_output_custody_index_entry
              SET trade_id='trade:late-mutation'`
      )
    ).rejects.toThrow(/append-only/i);
    await expect(
      repository.register({
        expectedRevision: 1,
        manifest: publication,
        actor: 'fixture-publication-worker',
        evidenceId: custodyOutput.artifactRef.artifactId,
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }, 120_000);

  it('rejects direct approval and publication events without exact current Gate decisions', async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await applyOutcomeMigrations(db);
    const client = new PgliteSqlClient(db);
    const repository = createPostgresAflTradePublicationRepository(client);
    const publication =
      createAflTradeProjectionManifestFixture().projectionDocumentSetVerification
        .publicationManifest;
    await repository.register({
      expectedRevision: 0,
      manifest: publication,
      actor: 'fixture-publication-worker',
      evidenceId: publication.content.publicationBundleArtifact.artifactId,
    });
    const prior = await db.query<{ event_id: string }>(
      `SELECT event_id FROM outcome_valuation_publication_event WHERE revision=1`
    );
    const occurredAt = new Date(Date.parse(publication.content.createdAt) + 1_000).toISOString();
    for (const authority of [
      { action: 'approve', field: 'gate4DecisionId', gate: 'Gate 4', state: 'approved' },
      { action: 'publish', field: 'gate5DecisionId', gate: 'Gate 5', state: 'published' },
    ] as const) {
      const changedRecord = {
        publicationId: publication.publicationId,
        projectionId: `projection:${'d'.repeat(64)}`,
        [authority.field]: `gate-decision:${'e'.repeat(64)}`,
        state: authority.state,
      };
      const content = {
        schemaVersion: 'afl-trade-publication-persistence-event/v1',
        revision: 2,
        previousEventId: prior.rows[0]?.event_id ?? null,
        publicationId: publication.publicationId,
        action: authority.action,
        occurredAt,
        changedRecords: [changedRecord],
        activeScopeKey: publication.content.scopeKey,
        activePointerAfter: null,
      };
      const eventId = createAflTradeContentAddress('publication-event', content);

      await expect(
        db.exec(`
        BEGIN;
        INSERT INTO outcome_valuation_publication_event
          (revision,event_id,previous_event_id,publication_id,action,occurred_at,event_json)
        VALUES
          (2,'${eventId}','${content.previousEventId}','${publication.publicationId}',
           '${authority.action}','${occurredAt}','${JSON.stringify({ eventId, content }).replaceAll("'", "''")}'::jsonb);
        UPDATE outcome_valuation_publication_registry_head
           SET revision=2,registry_json='{}'::jsonb,updated_at='${occurredAt}'
         WHERE singleton_id=1;
        COMMIT;
      `)
      ).rejects.toThrow(new RegExp(`current ${authority.gate}`, 'i'));
      await db.exec('ROLLBACK');
    }
  }, 120_000);
});
