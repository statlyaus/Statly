import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeValuationDatasetRepository } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';
import { seedSyntheticPavDatasetSqlParents } from '../testUtils/syntheticPavDatasetSqlParents';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable test database is required.');
const schemaName = `native_pav_guards_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);
let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;

async function insertProtocol(protocol = fixture.protocol) {
  return client.query(
    `INSERT INTO outcome_valuation_model_protocol
    (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,prepared_at,protocol_canonical_json,protocol_json)
    VALUES($1,'test_fixture',$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING protocol_id`,
    [
      protocol.protocolId,
      fixture.base.dataset.datasetId,
      fixture.admission.admissionId,
      fixture.base.evidence.analyticalAuthority.receiptId,
      protocol.content.preparedAt,
      canonicalizeAflTradeJson(protocol.content),
      canonicalizeAflTradeJson(protocol),
    ]
  );
}
async function insertObservation(content = fixture.observationSet.content) {
  const document = {
    observationSetId: createAflTradeContentAddress('player-observation-set', content),
    content,
  };
  return client.query(
    `INSERT INTO outcome_valuation_player_observation_set
    (observation_set_id,environment,dataset_id,admission_id,protocol_id,dataset_row_set_sha256,observation_count,observation_canonical_json,observation_json)
    VALUES($1,'test_fixture',$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING observation_set_id`,
    [
      document.observationSetId,
      content.datasetId,
      content.datasetAdmissionId,
      content.modelProtocolId,
      content.datasetRowSetSha256,
      content.observations.length,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(document),
    ]
  );
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: url.toString() });
  fixture = await admittedPavModelRunFixture();
  await seedSyntheticPavDatasetSqlParents(client, {
    ...fixture.base,
    evidence: { ...fixture.base.evidence, gate2Ledger: fixture.evidence.gate2Ledger },
  });
  const repository = new PostgresAflTradeValuationDatasetRepository(client);
  await repository.persistCandidate(fixture.base.dataset);
  const evidence = fixture.base.evidence;
  await repository.persistEvidence(fixture.base.dataset, {
    gateLedgerRevision: 1,
    analyticalAuthority: evidence.analyticalAuthority,
    operationalAuthorization: evidence.operationalAuthorization,
    consumedFieldSets: evidence.consumedFieldSets,
    sourceRights: evidence.sourceRights.map((source) => ({
      ...source,
      rightsArtifactId: source.rightsProposal.rightsArtifactId,
    })),
  });
  // Only synthetic upstream admission and method rows are seeded here. The target
  // protocol/observation guards are never disabled. Rollback restores triggers on error.
  await client.transaction(async (transaction) => {
    for (const table of ['outcome_valuation_dataset_admission', 'outcome_hpn_pav_method'])
      await transaction.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
    const admission = fixture.admission;
    await transaction.query(
      `INSERT INTO outcome_valuation_dataset_admission
      (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,gate_ledger_revision,analytical_authority_receipt_id,
       operational_authorization_receipt_id,source_count,status,admission_canonical_json,admission_json,finalized_at)
      VALUES($1,$2,'test_fixture',$3,$4,1,$5,$6,54,'finalized',$7,$8::jsonb,$3)`,
      [
        admission.admissionId,
        admission.content.datasetId,
        admission.content.admittedAt,
        admission.content.gate2Decision.decisionId,
        admission.content.analyticalAuthorityReceiptId,
        admission.content.operationalAuthorizationReceiptId,
        canonicalizeAflTradeJson(admission.content),
        canonicalizeAflTradeJson(admission),
      ]
    );
    const method = fixture.evidence.hpnMethod;
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_method
      (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,method_canonical_json,method_json)
      VALUES($1,$2,'test_fixture',$3,$4,$4,$5,$6::jsonb)`,
      [
        method.methodId,
        method.methodId.split(':')[1],
        method.content.sourceArtifact.artifactId,
        method.content.capturedAt,
        canonicalizeAflTradeJson(method.content),
        canonicalizeAflTradeJson(method),
      ]
    );
    for (const table of ['outcome_valuation_dataset_admission', 'outcome_hpn_pav_method'])
      await transaction.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
  });
  const disabled = await client.query<{
    count: string;
  }>(`SELECT count(*)::text count FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND t.tgenabled='D'`);
  expect(disabled.rows[0]!.count).toBe('0');
}, 120_000);
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

describe.sequential(
  'Native protocol/observation SQL guards with synthetic upstream parents only',
  () => {
    it('rejects a re-addressed native protocol substituting the original PAV policy', async () => {
      const content = {
        ...fixture.protocol.content,
        pavPolicy: {
          ...fixture.protocol.content.pavPolicy,
          policyId: `player-pav-policy:${'f'.repeat(64)}`,
        },
      };
      await expect(
        insertProtocol({
          protocolId: createAflTradeContentAddress('model-protocol', content),
          content,
        })
      ).rejects.toThrow('Native PAV protocol ancestry mismatch');
    });
    it('registers and replays the exact native pair without changing the database clock', async () => {
      expect(fixture.evidence.pavObservationSet.content.observations).toHaveLength(16);
      expect(fixture.observationSet.content.observations).toHaveLength(4);
      expect((await insertProtocol()).rowCount).toBe(1);
      expect((await insertProtocol()).rowCount).toBe(0);
      expect((await insertObservation()).rowCount).toBe(1);
      expect((await insertObservation()).rowCount).toBe(0);
    });
    it('rejects real adapter consumption without a current private PAV parent', async () => {
      const intent = fixture.intent;
      await client.query(
        `INSERT INTO outcome_valuation_model_run_intent
          (intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,started_at,intent_canonical_json,intent_json)
         VALUES($1,'test_fixture',$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          intent.intentId,
          intent.content.datasetId,
          intent.content.datasetAdmissionId,
          intent.content.modelProtocolId,
          intent.content.observationSetId,
          intent.content.startedAt,
          canonicalizeAflTradeJson(intent.content),
          canonicalizeAflTradeJson(intent),
        ]
      );
      const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
        sql: client,
        artifactRepository: createAflTradeFixtureArtifactRepository(),
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(client),
      });
      // The real current-parent reader requires non-production custody, which this
      // explicitly synthetic fixture does not provide. No source authority function
      // is replaced and no usable authorization is invented. A missing authorization
      // alone would return false; this exact parent error establishes the earlier check.
      await expect(
        adapter.consumeIntentOnce({
          authorizationId: `model-run-authorization:${'a'.repeat(64)}`,
          intentId: intent.intentId,
          consumedAt: await adapter.now(),
        })
      ).rejects.toMatchObject({
        code: 'NOT_FINALIZED',
        message: 'Player-PAV observation set is absent or not finalized.',
      });
    });
    it('rejects a re-addressed selected observation value substitution', async () => {
      const rows = structuredClone(fixture.observationSet.content.observations);
      rows[0]!.pavObservation.playerId = 'substituted-player';
      const { observationId: _old, ...content } = rows[0]!;
      rows[0]!.observationId = createAflTradeContentAddress('player-observation', content);
      await expect(
        insertObservation({ ...fixture.observationSet.content, observations: rows })
      ).rejects.toThrow('Native PAV observation projection mismatch');
    });
    it.each(['sourceObservationSet', 'pavPolicy', 'hpnMethod'] as const)(
      'rejects re-addressed %s artifact byte custody substitution',
      async (field) => {
        const content = structuredClone(fixture.protocol.content);
        content[field].artifact.contentSha256 = 'e'.repeat(64);
        await expect(
          insertProtocol({
            protocolId: createAflTradeContentAddress('model-protocol', content),
            content,
          })
        ).rejects.toThrow('Native PAV protocol artifact mismatch');
      }
    );
    it('rejects a scalar protocol version paired with the admitted PAV dataset', async () => {
      const content = { ...fixture.protocol.content, schemaVersion: 'afl-trade-model-protocol/v2' };
      await expect(
        insertProtocol({
          protocolId: createAflTradeContentAddress('model-protocol', content),
          content,
        } as unknown as typeof fixture.protocol)
      ).rejects.toThrow('Native PAV protocol ancestry mismatch');
    });
    it('rejects a scalar observation version paired with the native protocol', async () => {
      await expect(
        insertObservation({
          ...fixture.observationSet.content,
          schemaVersion: 'afl-trade-player-observation-set/v2',
        } as unknown as typeof fixture.observationSet.content)
      ).rejects.toThrow('Native PAV observation versions mismatch');
    });
    it('rejects reordered selected rows even after each row and the set are re-addressed', async () => {
      const observations = [...fixture.observationSet.content.observations]
        .reverse()
        .map((observation, index) => {
          const { observationId: _old, ...rest } = observation;
          const content = { ...rest, rowOrdinal: index + 1 };
          return {
            ...content,
            observationId: createAflTradeContentAddress('player-observation', content),
          };
        });
      await expect(
        insertObservation({ ...fixture.observationSet.content, observations })
      ).rejects.toThrow('Native PAV observation projection mismatch');
    });
    it('rejects a native protocol with a missing partition window instead of accepting SQL null comparisons', async () => {
      const content = structuredClone(fixture.protocol.content);
      delete (content.windows as Partial<typeof content.windows>).train;
      await expect(
        insertProtocol({
          protocolId: createAflTradeContentAddress('model-protocol', content),
          content,
        })
      ).rejects.toThrow('Native PAV protocol ancestry mismatch');
    });
    it.each(['train', 'finalTest'] as const)(
      'rejects the original projection outside its registered %s window',
      async (partition) => {
        const content = structuredClone(fixture.protocol.content);
        content.windows[partition] =
          partition === 'train'
            ? { from: '2006-01-01T00:00:00.000Z', to: '2007-01-01T00:00:00.000Z' }
            : { from: '2018-01-01T00:00:00.000Z', to: '2019-01-01T00:00:00.000Z' };
        const protocol = {
          protocolId: createAflTradeContentAddress('model-protocol', content),
          content,
        };
        await insertProtocol(protocol);
        await expect(
          insertObservation({
            ...fixture.observationSet.content,
            modelProtocolId: protocol.protocolId,
          })
        ).rejects.toThrow('Native PAV observation projection mismatch');
      }
    );
  }
);
