import { expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeModelRunCheckpoint,
  aflTradeAnyModelRunCheckpointSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const source = await nativePavModelRunSqlFixture();
  const rootDirectory = mkdtempSync(join(tmpdir(), 'statly-native-final-start-'));
  roots.push(rootDirectory);
  let committed = false;
  let expired = false;
  // SQL responses are synthetic; candidate bytes and existing authority services are real.
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
      if (expired && statement.includes('clock_timestamp()) AS now'))
        return { rows: [{ now: '2030-01-01T00:00:00.000Z' }] as Row[], rowCount: 1 };
      return source.sql.query<Row>(statement, parameters);
    },
    async transaction(work) {
      committed = false;
      const result = await source.sql.transaction(() => work(sql));
      committed = true;
      return result;
    },
  };
  const dependencies = {
    sql,
    artifactRepository: source.artifactRepository,
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    candidateArtifactRepository: createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory,
      repositoryId: 'native-final-start',
      maximumObjectBytes: 4 * 1024 * 1024,
    }),
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority(dependencies);
  await adapter.prepare(source);
  expect(await adapter.issueOnceForIntent(source)).toBe(true);
  const request = {
    intentId: source.intent.intentId,
    authorizationId: source.authorization.authorizationId,
  };
  expect(await adapter.consumeIntentOnce({ ...request, consumedAt: source.startedAt })).toBe(true);
  return {
    source,
    adapter,
    dependencies,
    request,
    isCommitted: () => committed,
    expire: () => {
      expired = true;
    },
  };
}

it('commits one final-test start after exact candidate lock and does not grant a restart rerun', async () => {
  const current = await fixture();
  const locked = await current.adapter.retainNativeCandidateCheckpoint(current.request);
  const started = await current.adapter.beginNativeFinalTestCheckpoint(current.request);
  expect(started.state).toBe('newly_started');
  expect(current.isCommitted()).toBe(true);
  expect(started.checkpoint.content).toMatchObject({
    stage: 'final_test_started',
    previousCheckpointId: locked.checkpoint.checkpointId,
    candidateArtifact: locked.checkpoint.content.candidateArtifact,
  });
  current.expire();
  const before = current.source.calls.length;
  const restarted = new PostgresAflTradeAdmittedModelRunAuthority(current.dependencies);
  expect(await restarted.beginNativeFinalTestCheckpoint(current.request)).toEqual({
    state: 'already_started',
    checkpoint: started.checkpoint,
  });
  expect(current.source.calls.slice(before).some(({ sql }) => sql.startsWith('INSERT'))).toBe(
    false
  );
}, 120_000);

it('refuses to fit a missing candidate or open final-test work after authority expiry', async () => {
  const current = await fixture();
  await expect(current.adapter.beginNativeFinalTestCheckpoint(current.request)).rejects.toThrow(
    /already retained candidate lock/i
  );
  await current.adapter.retainNativeCandidateCheckpoint(current.request);
  current.expire();
  await expect(current.adapter.beginNativeFinalTestCheckpoint(current.request)).rejects.toThrow();
  expect(
    [...current.source.retained.values()].some(
      (document) =>
        typeof document === 'object' &&
        document !== null &&
        'content' in document &&
        (document.content as { stage?: string }).stage === 'final_test_started'
    )
  ).toBe(false);
}, 120_000);

it('requires exact candidate custody before beginning native final-test work', async () => {
  const sql: AflOutcomeSqlClient = {
    async query() {
      throw new Error('Missing candidate custody must fail before database access.');
    },
    async transaction(work) {
      return work(sql);
    },
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
    sql,
    artifactRepository: createAflTradeFixtureArtifactRepository(),
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
  });
  await expect(
    adapter.beginNativeFinalTestCheckpoint({
      intentId: `model-run-intent:${'a'.repeat(64)}`,
      authorizationId: `model-run-authorization:${'b'.repeat(64)}`,
    })
  ).rejects.toThrow(/candidate.*artifact.*(store|repository)/i);
});

it('rejects missing retained candidate bytes before writing a final-test marker', async () => {
  const current = await fixture();
  await current.adapter.retainNativeCandidateCheckpoint(current.request);
  const before = current.source.calls.length;
  const missingStore = new PostgresAflTradeAdmittedModelRunAuthority({
    ...current.dependencies,
    candidateArtifactRepository: createAflTradeFixtureArtifactRepository(),
  });
  await expect(missingStore.beginNativeFinalTestCheckpoint(current.request)).rejects.toThrow();
  expect(current.source.calls.slice(before).some(({ sql }) => sql.startsWith('INSERT'))).toBe(
    false
  );
}, 120_000);

it.each([
  ['missing', 'preFinalArtifact'],
  ['changed', 'preFinalArtifact'],
  ['missing', 'validationPlanArtifact'],
  ['changed', 'validationPlanArtifact'],
] as const)(
  'rejects %s retained %s report before opening final-test work',
  async (mode, reportField) => {
    const current = await fixture();
    const locked = await current.adapter.retainNativeCandidateCheckpoint(current.request);
    const repository = current.dependencies.candidateArtifactRepository;
    const custody = await repository.loadExact(
      locked.checkpoint.content.evidenceArtifact!,
      4 * 1024 * 1024
    );
    const reportId = JSON.parse(new TextDecoder().decode(custody!.bytes))[reportField].artifactId;
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      ...current.dependencies,
      candidateArtifactRepository: {
        ...repository,
        async loadExact(reference, maximumBytes) {
          const stored = await repository.loadExact(reference, maximumBytes);
          return reference.artifactId !== reportId
            ? stored
            : mode === 'missing'
              ? null
              : stored && { ...stored, bytes: new TextEncoder().encode('{}') };
        },
      },
    });
    const before = current.source.calls.length;
    await expect(adapter.beginNativeFinalTestCheckpoint(current.request)).rejects.toThrow(
      /(?:pre-final report|validation plan) bytes/i
    );
    expect(current.source.calls.slice(before).some(({ sql }) => sql.startsWith('INSERT'))).toBe(
      false
    );
  },
  120_000
);

it.each(['v1', 'v2'] as const)(
  'keeps legacy %s custody readable without granting a new final test or recalibrating it',
  async (version) => {
    const current = await fixture();
    const locked = await current.adapter.retainNativeCandidateCheckpoint(current.request);
    const repository = current.dependencies.candidateArtifactRepository;
    const stored = await repository.loadExact(
      locked.checkpoint.content.candidateArtifact!,
      4 * 1024 * 1024
    );
    const candidate = JSON.parse(new TextDecoder().decode(stored!.bytes));
    const fullCustody = await repository.loadExact(
      locked.checkpoint.content.evidenceArtifact!,
      4 * 1024 * 1024
    );
    const preFinalArtifact = JSON.parse(
      new TextDecoder().decode(fullCustody!.bytes)
    ).preFinalArtifact;
    const legacyBody = {
      schemaVersion: `afl-trade-native-pav-candidate-custody/${version}`,
      authorityBoundary:
        version === 'v1'
          ? 'train_only_no_evaluation_or_qualification'
          : 'pre_final_numerical_evidence_no_final_test_or_qualification',
      rootIntentId: current.request.intentId,
      fitIntentId: current.request.intentId,
      candidateId: candidate.candidateId,
      candidateArtifact: locked.checkpoint.content.candidateArtifact,
      ...(version === 'v2' ? { preFinalArtifact } : {}),
    };
    const legacyRef = createAflTradeCanonicalJsonArtifactRef(
      legacyBody,
      locked.checkpoint.content.recordedAt
    );
    await repository.putIfAbsent(
      legacyRef,
      new TextEncoder().encode(canonicalizeAflTradeJson(legacyBody))
    );
    const { schemaVersion: _schemaVersion, ...lockedContent } = locked.checkpoint.content;
    const retainedCheckpoints = [...current.source.retained.entries()]
      .filter(([key]) => key.startsWith('outcome_valuation_model_run_checkpoint:'))
      .map(([key, value]) => ({
        key,
        checkpoint: aflTradeAnyModelRunCheckpointSchema.parse(value),
      }));
    const originalStarted = retainedCheckpoints.find(
      (item) => item.checkpoint.content.stage === 'started'
    )!.checkpoint;
    const legacy = createAflTradeModelRunCheckpoint({
      ...lockedContent,
      stage: 'candidate_locked',
      previousCheckpointId: originalStarted.checkpointId,
      evidenceArtifact: legacyRef,
    });
    // Explicit synthetic historical custody; no real checkpoint or authority guard is overridden.
    for (const item of retainedCheckpoints)
      if (item.checkpoint.content.stage !== 'started') current.source.retained.delete(item.key);
    current.source.retained.set(
      `outcome_valuation_model_run_checkpoint:${legacy.checkpointId}`,
      legacy
    );
    expect((await current.adapter.retainNativeCandidateCheckpoint(current.request)).state).toBe(
      'already_locked'
    );
    await expect(current.adapter.beginNativeFinalTestCheckpoint(current.request)).rejects.toThrow(
      /legacy fit-only locks cannot be upgraded/i
    );
    const started = createAflTradeModelRunCheckpoint({
      ...legacy.content,
      stage: 'final_test_started',
      previousCheckpointId: legacy.checkpointId,
    });
    current.source.retained.set(
      `outcome_valuation_model_run_checkpoint:${started.checkpointId}`,
      started
    );
    current.expire();
    const before = current.source.calls.length;
    expect(await current.adapter.beginNativeFinalTestCheckpoint(current.request)).toEqual({
      state: 'already_started',
      checkpoint: started,
    });
    expect(current.source.calls.slice(before).some(({ sql }) => sql.startsWith('INSERT'))).toBe(
      false
    );
  },
  120_000
);
