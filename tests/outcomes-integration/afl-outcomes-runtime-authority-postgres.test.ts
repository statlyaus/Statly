import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { recordApprovedAflTradeFitzRoySources } from '@/server/aflTradeIntelligence/governance/recordApprovedFitzRoySources';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflTradeProjectionFreshnessHighWaterStore } from '@/server/aflTradeIntelligence/publication/postgresProjectionFreshnessHighWaterStore';
import { createPostgresAflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error(
      'AFL_OUTCOMES_TEST_DATABASE_URL must identify an explicitly provisioned disposable PostgreSQL database.'
    );
  })();

const schemaName = `afl_outcomes_runtime_${process.pid}_${Date.now()}`;
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

function publicationManifest(
  scopeKey = 'runtime-authority-fixture',
  createdAt = '2026-08-08T00:00:00.000Z'
) {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey,
    createdAt,
    valuationBundleId: `valuation-bundle:${'1'.repeat(64)}`,
    gate3DecisionId: `gate-decision:${'2'.repeat(64)}`,
    sourceRegisterIds: [`${scopeKey}-source`],
    supportedViews: ['current' as const],
    supportedCohorts: [`${scopeKey}-supported`],
    excludedCohorts: [],
    valueUnitId: `${scopeKey}-unit`,
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
    environment: 'production' as const,
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
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(),
  });
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
    const publication = publicationManifest('runtime-freshness-fixture');
    const publicationId = publication.publicationId;
    const projectionArtifactId = `artifact:${'9'.repeat(64)}`;
    const projectionCreatedAt = '2026-08-08T01:00:00.000Z';
    const projectionContent = {
      schemaVersion: 'afl-trade-projection/v1' as const,
      environment: 'test_fixture' as const,
      scopeKey: 'runtime-freshness-fixture',
      createdAt: projectionCreatedAt,
      publicationId,
      buildJobId: 'runtime-freshness-fixture-build',
      responseContractVersion: 'afl-trade-value/v2' as const,
      documentCount: 1,
      projectionArtifact: {
        ...artifactReference('9'),
        createdAt: projectionCreatedAt,
      },
      schemaArtifact: artifactReference('a'),
      parityReportArtifact: artifactReference('b'),
    };
    const projection = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', projectionContent),
      content: projectionContent,
    });
    const projectionId = projection.projectionId;
    await outcomesPool.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'application/json',1,'public_projection','test_fixture',$4,$4,'{}'::jsonb)`,
      [
        projectionArtifactId,
        '9'.repeat(64),
        `artifact://sha256/${'9'.repeat(64)}`,
        projectionCreatedAt,
      ]
    );
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const publicationRepository = createPostgresAflTradePublicationRepository(client);
    const beforeRegistration = await publicationRepository.load();
    const registered = await publicationRepository.register({
      expectedRevision: beforeRegistration.revision,
      manifest: publication,
      actor: 'runtime-freshness-fixture-worker',
      evidenceId: projectionArtifactId,
    });
    await publicationRepository.apply({
      expectedRevision: registered.registry.revision,
      command: {
        action: 'validate',
        publicationId,
        occurredAt: projectionCreatedAt,
        actor: 'runtime-freshness-fixture-reviewer',
        evidenceId: projectionArtifactId,
        projectionManifest: projection,
      },
      projectionArtifactId,
    });
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
    const beforeRegistration = await repository.load();
    const manifest = publicationManifest('runtime-authority-fixture', '2026-08-08T03:00:00.000Z');
    const registered = await repository.register({
      expectedRevision: beforeRegistration.revision,
      manifest,
      actor: 'runtime-authority-publication-worker',
      evidenceId: artifact('7'),
    });
    expect(registered.registry.revision).toBe(beforeRegistration.revision + 1);
    expect(registered.idempotentReplay).toBe(false);

    const restarted = createPostgresAflTradePublicationRepository(client);
    expect(await restarted.load()).toEqual(registered.registry);
    expect(
      await restarted.register({
        expectedRevision: registered.registry.revision,
        manifest,
        actor: 'runtime-authority-publication-worker',
        evidenceId: artifact('7'),
      })
    ).toMatchObject({
      registry: { revision: registered.registry.revision },
      idempotentReplay: true,
    });

    const rejectionCommand = {
      action: 'reject' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-08T04:00:00.000Z',
      actor: 'runtime-authority-publication-reviewer',
      evidenceId: artifact('8'),
      reason: 'Real PostgreSQL rejection proves durable publication state.',
    };
    const rejected = await restarted.apply({
      expectedRevision: registered.registry.revision,
      command: rejectionCommand,
    });
    expect(rejected.registry.publications[manifest.publicationId]?.state).toBe('rejected');

    await expect(
      restarted.apply({
        expectedRevision: registered.registry.revision,
        command: {
          ...rejectionCommand,
          reason: 'A conflicting stale command must not replay the committed rejection.',
        },
      })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(await createPostgresAflTradePublicationRepository(client).load()).toEqual(
      rejected.registry
    );
  });
});
