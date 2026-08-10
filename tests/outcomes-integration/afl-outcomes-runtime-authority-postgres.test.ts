import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradePublicationManifestSchema } from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { recordApprovedAflTradeFitzRoySources } from '@/server/aflTradeIntelligence/governance/recordApprovedFitzRoySources';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflTradeProjectionFreshnessHighWaterStore } from '@/server/aflTradeIntelligence/publication/postgresProjectionFreshnessHighWaterStore';
import { createPostgresAflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error(
      'AFL_OUTCOMES_TEST_DATABASE_URL must identify an explicitly provisioned disposable PostgreSQL database.'
    );
  })();

const schemaName = `afl_outcomes_runtime_${process.pid}_${Date.now()}`;
const prismaSchemaPath = join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma');
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;
const artifactReference = (letter: string) => ({
  artifactId: artifact(letter),
  contentSha256: letter.repeat(64),
  storageUri: `artifact://sha256/${letter.repeat(64)}`,
  mediaType: 'application/json',
  byteLength: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
});

function publicationManifest() {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'runtime-authority-fixture',
    createdAt: '2026-08-08T00:00:00.000Z',
    valuationBundleId: `valuation-bundle:${'1'.repeat(64)}`,
    gate3DecisionId: `gate-decision:${'2'.repeat(64)}`,
    sourceRegisterIds: ['runtime-authority-fixture-source'],
    supportedViews: ['current' as const],
    supportedCohorts: ['runtime-authority-fixture-supported'],
    excludedCohorts: [],
    valueUnitId: 'runtime-authority-fixture-unit',
    entryCount: 1,
    publicationBundleArtifact: artifactReference('3'),
    methodologyArtifact: artifactReference('4'),
    validationReportArtifact: artifactReference('5'),
    modelCardArtifact: artifactReference('6'),
  };
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}
const field = {
  sourceField: 'Player',
  normalizedField: 'player.displayName',
  uses: {
    archive_fact: 'allowed' as const,
    model_training: 'allowed' as const,
    derived_feature: 'allowed' as const,
    public_display: 'allowed' as const,
  },
  attributionRequired: true,
  notes: null,
};

const initialApproval = {
  policy: {
    fieldSets: {
      'afl-tables-player-stats': [field],
      'footywire-player-stats': [field],
      'fryzigg-player-stats': [field],
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': artifact('e'),
        'zero-provenance-review': artifact('f'),
      },
      'footywire-player-stats': {
        'full-season-custody': artifact('1'),
        'html-schema-fingerprint': artifact('2'),
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': artifact('3'),
        'reconciliation-promotion-review': artifact('4'),
      },
    },
    evidence: {
      terms: artifact('a'),
      authority: artifact('b'),
      rateLimit: artifact('c'),
    },
    termsEffectiveAt: '2026-08-08T00:00:00.000Z',
    termsExpireAt: '2027-08-08T00:00:00.000Z',
    proposedAt: '2026-08-08T00:01:00.000Z',
    proposedBy: 'statly-data-governance-owner',
  },
  gate: {
    decidedAt: '2026-08-08T00:02:00.000Z',
    effectiveAt: '2026-08-08T00:02:00.000Z',
    revalidateAt: '2027-08-08T00:00:00.000Z',
    accountableOwner: 'statly-data-governance-owner',
    reviewer: {
      id: 'independent-source-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: artifact('d'),
    },
    authorityEvidenceId: artifact('b'),
    rateLimitEvidenceId: artifact('c'),
  },
};

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  execFileSync(
    'npx',
    ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', prismaSchemaPath],
    {
      env: { ...process.env, AFL_OUTCOMES_DATABASE_URL: scopedDatabaseUrl() },
      stdio: 'pipe',
    }
  );
});

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL AFL trade runtime authority', () => {
  it('atomically appends, resolves, and rolls back multi-provider Gate batches', async () => {
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    );
    const initial = await recordApprovedAflTradeFitzRoySources(repository, initialApproval);

    expect(initial.revision).toBe(3);
    expect(initial.records).toHaveLength(3);
    const footywire = initial.records.find(
      ({ sourceRights }) => sourceRights.content.provider === 'footywire'
    );
    expect(footywire).toBeDefined();
    const resolved = await repository.resolveAuthorization(
      footywire!.sourceRights.rightsArtifactId
    );
    expect(resolved.sourceRights).toEqual(footywire!.sourceRights);
    expect(resolved.ledger.decisions).toHaveLength(3);

    await outcomesPool.query(`
      CREATE FUNCTION fail_footywire_gate_renewal() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.decision_key = 'footywire-player-stats-production' AND NEW.version = 2 THEN
          RAISE EXCEPTION 'injected mid-batch renewal failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_footywire_gate_renewal_insert
        BEFORE INSERT ON outcome_gate_decision
        FOR EACH ROW EXECUTE FUNCTION fail_footywire_gate_renewal();
    `);
    const renewal = {
      policy: {
        ...initialApproval.policy,
        termsEffectiveAt: '2027-08-08T00:00:00.000Z',
        termsExpireAt: '2028-08-08T00:00:00.000Z',
        proposedAt: '2027-08-08T00:01:00.000Z',
      },
      gate: {
        ...initialApproval.gate,
        decidedAt: '2027-08-08T00:02:00.000Z',
        effectiveAt: '2027-08-08T00:02:00.000Z',
        revalidateAt: '2028-08-08T00:00:00.000Z',
      },
    };
    await expect(recordApprovedAflTradeFitzRoySources(repository, renewal)).rejects.toThrow();

    const afterFailure = await repository.load();
    expect(afterFailure.revision).toBe(3);
    expect(afterFailure.ledger.decisions).toHaveLength(3);
    expect(
      await outcomesPool.query(
        'SELECT count(*)::INTEGER AS count FROM outcome_source_rights_proposal'
      )
    ).toMatchObject({ rows: [{ count: 3 }] });
  });

  it('rejects a Gate-head revision jump without matching immutable decisions', async () => {
    const connection = await outcomesPool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `UPDATE outcome_gate_ledger_head SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE singleton_id = 1`
      );
      await expect(connection.query('COMMIT')).rejects.toThrow(
        'Gate ledger head revision must equal its immutable decision count'
      );
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined);
      connection.release();
    }
  });

  it('persists projection freshness across repository restarts and rejects clock rollback', async () => {
    const projectionId = `projection:${'9'.repeat(64)}`;
    const publicationId = `publication:${'9'.repeat(64)}`;
    const projectionArtifactId = `artifact:${'9'.repeat(64)}`;
    const projectionCreatedAt = '2026-08-08T01:00:00.000Z';
    await outcomesPool.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'application/json',1,'public_projection','test_fixture',$4,$4,'{}'::jsonb)`,
      [
        projectionArtifactId,
        '9'.repeat(64),
        `artifact://sha256/${'9'.repeat(64)}`,
        '2026-08-08T00:30:00.000Z',
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_publication_manifest
        (publication_id,scope_key,created_at,manifest_json)
       VALUES ($1,'runtime-freshness-fixture',$2,$3::jsonb)`,
      [
        publicationId,
        '2026-08-08T00:00:00.000Z',
        JSON.stringify({
          publicationId,
          content: {
            schemaVersion: 'afl-trade-publication/v2',
            environment: 'test_fixture',
            scopeKey: 'runtime-freshness-fixture',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        }),
      ]
    );
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_projection_manifest
        (projection_id,publication_id,artifact_id,created_at,manifest_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        projectionId,
        publicationId,
        projectionArtifactId,
        projectionCreatedAt,
        JSON.stringify({
          projectionId,
          content: {
            schemaVersion: 'afl-trade-projection/v1',
            publicationId,
            environment: 'test_fixture',
            scopeKey: 'runtime-freshness-fixture',
            createdAt: projectionCreatedAt,
          },
        }),
      ]
    );
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const firstProcess = createPostgresAflTradeProjectionFreshnessHighWaterStore(client);
    await firstProcess.advance(projectionId, '2026-08-08T02:00:00.000Z');

    const restartedProcess = createPostgresAflTradeProjectionFreshnessHighWaterStore(client);
    await restartedProcess.advance(projectionId, '2026-08-08T02:01:00.000Z');
    await expect(
      restartedProcess.advance(projectionId, '2026-08-08T02:00:30.000Z')
    ).rejects.toThrow(/clock rollback/i);

    expect(
      await outcomesPool.query(
        `SELECT evaluated_at, revision FROM outcome_projection_freshness_high_water WHERE projection_id = $1`,
        [projectionId]
      )
    ).toMatchObject({
      rows: [{ evaluated_at: new Date('2026-08-08T02:01:00.000Z'), revision: 2 }],
    });
  });

  it('persists valuation publication state, exact replay, and stale-revision CAS', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const repository = createPostgresAflTradePublicationRepository(client);
    const manifest = publicationManifest();
    const registered = await repository.register({
      expectedRevision: 0,
      manifest,
      actor: 'runtime-authority-publication-worker',
      evidenceId: artifact('7'),
    });
    expect(registered.registry.revision).toBe(1);
    expect(registered.idempotentReplay).toBe(false);

    const restarted = createPostgresAflTradePublicationRepository(client);
    expect(await restarted.load()).toEqual(registered.registry);
    expect(
      await restarted.register({
        expectedRevision: 1,
        manifest,
        actor: 'runtime-authority-publication-worker',
        evidenceId: artifact('7'),
      })
    ).toMatchObject({ registry: { revision: 1 }, idempotentReplay: true });

    const rejectionCommand = {
      action: 'reject' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-08T01:00:00.000Z',
      actor: 'runtime-authority-publication-reviewer',
      evidenceId: artifact('8'),
      reason: 'Real PostgreSQL rejection proves durable publication state.',
    };
    const rejected = await restarted.apply({
      expectedRevision: 1,
      command: rejectionCommand,
    });
    expect(rejected.registry.publications[manifest.publicationId]?.state).toBe('rejected');

    await expect(
      restarted.apply({ expectedRevision: 1, command: rejectionCommand })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(await createPostgresAflTradePublicationRepository(client).load()).toEqual(
      rejected.registry
    );
  });
});
