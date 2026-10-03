import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function fixture(metricDefinitionOverride?: unknown) {
  // Only the SQL boundary is synthetic. Source authority, numerical owners and local custody are real.
  const source = await nativePavModelRunSqlFixture('exact_readback', metricDefinitionOverride);
  const rootDirectory = mkdtempSync(join(tmpdir(), 'statly-native-final-execution-'));
  roots.push(rootDirectory);
  const store = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory,
    repositoryId: 'native-final-execution',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters: readonly unknown[] = []) {
      if (statement.includes('SELECT root.intent_json,authority.consumed_at'))
        return {
          rows: [{ intent_json: source.intent, consumed_at: source.startedAt }] as Row[],
          rowCount: 1,
        };
      if (statement.includes('SELECT intent_json FROM outcome_valuation_model_run_intent'))
        return { rows: [{ intent_json: source.intent }] as Row[], rowCount: 1 };
      if (statement.includes('SELECT run.run_json,authority.authorization_json'))
        return { rows: [] as Row[], rowCount: 0 };
      return source.sql.query<Row>(statement, parameters);
    },
    transaction: (work) => source.sql.transaction(() => work(sql)),
  };
  const dependencies = {
    sql,
    candidateArtifactRepository: store,
    artifactRepository: {
      loadExact: async (...args: Parameters<typeof store.loadExact>) =>
        (await store.loadExact(...args)) ?? source.artifactRepository.loadExact(...args),
    },
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    maximumArtifactBytes: 4 * 1024 * 1024,
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority(dependencies);
  await adapter.prepare(source);
  expect(await adapter.issueOnceForIntent(source)).toBe(true);
  const request = {
    intentId: source.intent.intentId,
    authorizationId: source.authorization.authorizationId,
  };
  expect(await adapter.consumeIntentOnce({ ...request, consumedAt: source.startedAt })).toBe(true);
  await adapter.retainNativeCandidateCheckpoint(request);
  return { source, dependencies, store, adapter, request };
}

it('rejects a deterministic artifact-size incompatibility before committing final access', async () => {
  const { source, dependencies, request } = await fixture();
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    maximumArtifactBytes: 100_000,
  });
  await expect(adapter.executeNativeFinalTest(request)).rejects.toThrow(
    'Native candidate executable exceeds its artifact bound.'
  );
  expect(source.checkpoint).toMatchObject({ content: { stage: 'candidate_locked' } });
}, 120_000);

it('retains actual native final reports once and recovers completed execution without numerical replay', async () => {
  const { source, dependencies, store, request } = await fixture();
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    candidateArtifactRepository: {
      ...store,
      async putIfAbsent(reference, bytes) {
        if (
          [
            'afl-trade-admitted-player-pav-candidate/v1',
            'afl-trade-native-pav-pre-final-evaluation/v1',
          ].includes(JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion)
        )
          throw new Error('Accepted numerical artifacts must be reused, not rewritten');
        return store.putIfAbsent(reference, bytes);
      },
    },
  });
  const result = await adapter.executeNativeFinalTest(request);
  expect(result.state).toBe('completed');
  expect(result.checkpoint.content.stage).toBe('final_test_completed');
  const recovery = await adapter.loadRetainedRecoveryState({ intentId: source.intent.intentId });
  expect(recovery.finalTestCompletionEvidence?.outcome.status).toBe('succeeded');
  const before = source.calls.length;
  const restarted = new PostgresAflTradeAdmittedModelRunAuthority(dependencies);
  expect(await restarted.executeNativeFinalTest(request)).toEqual(result);
  expect(source.calls.slice(before).filter(({ sql }) => sql.startsWith('INSERT'))).toHaveLength(0);
}, 120_000);

it('rejects unsupported declared metrics before the irreversible final marker', async () => {
  const { adapter, request, source } = await fixture({
    synthetic: 'generic review is not a native metric declaration',
  });
  await expect(adapter.executeNativeFinalTest(request)).rejects.toThrow();
  const state = await adapter.loadRetainedRecoveryState({ intentId: source.intent.intentId });
  expect(state.checkpoints.at(-1)?.content.stage).toBe('candidate_locked');
  expect(state.finalTestCompletionEvidence).toBeNull();
}, 120_000);

it('does not expose private numerical context or grant execution from an earlier public begin', async () => {
  const { adapter, request } = await fixture();
  const started = await adapter.beginNativeFinalTestCheckpoint(request);
  expect(Object.keys(started).sort()).toEqual(['checkpoint', 'state']);
  expect(started.state).toBe('newly_started');
  expect(await adapter.executeNativeFinalTest(request)).toEqual({
    state: 'already_started',
    checkpoint: started.checkpoint,
  });
}, 120_000);

it('rechecks current authority after the start commits and leaves expiry ambiguous', async () => {
  const { source, dependencies, request, store } = await fixture();
  let markerCommitted = false;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters: readonly unknown[] = []) {
      if (markerCommitted && statement.includes('clock_timestamp()) AS now'))
        return { rows: [{ now: '2030-01-01T00:00:00.000Z' }] as Row[], rowCount: 1 };
      return dependencies.sql.query<Row>(statement, parameters);
    },
    async transaction(work) {
      const result = await dependencies.sql.transaction(() => work(sql));
      markerCommitted = true;
      return result;
    },
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    sql,
    candidateArtifactRepository: {
      ...store,
      async putIfAbsent() {
        throw new Error('Expired final execution attempted output storage');
      },
    },
  });
  await expect(adapter.executeNativeFinalTest(request)).rejects.toThrow(
    'Native PAV stage requires current Gate 2 authority.'
  );
  const state = await adapter.loadRetainedRecoveryState({ intentId: source.intent.intentId });
  expect(state.checkpoints.at(-1)?.content.stage).toBe('final_test_started');
  expect(state.finalTestCompletionEvidence).toBeNull();
  expect((await adapter.executeNativeFinalTest(request)).state).toBe('already_started');
}, 120_000);

it('keeps partial final report storage failure ambiguous and never grants another evaluation', async () => {
  const { source, dependencies, store, request } = await fixture();
  let failed = false;
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    candidateArtifactRepository: {
      ...store,
      async putIfAbsent(reference, bytes) {
        const document = JSON.parse(new TextDecoder().decode(bytes));
        if (document.content?.schemaVersion === 'afl-trade-native-pav-final-evaluation/v2') {
          failed = true;
          throw new Error('Synthetic final report storage unavailable');
        }
        return store.putIfAbsent(reference, bytes);
      },
    },
  });
  await expect(adapter.executeNativeFinalTest(request)).rejects.toThrow(
    'Synthetic final report storage unavailable'
  );
  expect(failed).toBe(true);
  const before = source.calls.length;
  const restarted = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    candidateArtifactRepository: {
      ...store,
      async putIfAbsent() {
        throw new Error('Replay attempted an artifact write');
      },
    },
  });
  expect((await restarted.executeNativeFinalTest(request)).state).toBe('already_started');
  const recovery = await restarted.loadRetainedRecoveryState({ intentId: source.intent.intentId });
  expect(recovery.finalTestCompletionEvidence).toBeNull();
  expect(recovery.checkpoints.at(-1)?.content.stage).toBe('final_test_started');
  expect(source.calls.slice(before).filter(({ sql }) => sql.startsWith('INSERT'))).toHaveLength(0);
}, 120_000);

it('rejects a custody class switch after marker commit before writing any final output', async () => {
  const { dependencies, source, request, store } = await fixture();
  let markerCommitted = false;
  let outputWrites = 0;
  const sql: AflOutcomeSqlClient = {
    query: dependencies.sql.query.bind(dependencies.sql),
    async transaction(work) {
      const result = await dependencies.sql.transaction(() => work(sql));
      markerCommitted = true;
      return result;
    },
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    ...dependencies,
    sql,
    candidateArtifactRepository: {
      ...store,
      get artifactClass() {
        return markerCommitted ? 'capture_metadata' : 'derived_private';
      },
      async putIfAbsent(reference, bytes) {
        outputWrites++;
        return store.putIfAbsent(reference, bytes);
      },
    },
  });
  await expect(adapter.executeNativeFinalTest(request)).rejects.toThrow(/custody/i);
  expect(outputWrites).toBe(0);
  const recovery = await adapter.loadRetainedRecoveryState({ intentId: source.intent.intentId });
  expect(recovery.checkpoints.at(-1)?.content.stage).toBe('final_test_started');
  expect(recovery.finalTestCompletionEvidence).toBeNull();
}, 120_000);
