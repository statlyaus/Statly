import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { aflTradeAdmittedPlayerPavCandidateSchema } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import { createAflTradeModelRunCheckpointV2 } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

const artifactRoots: string[] = [];
afterAll(() => {
  for (const directory of artifactRoots) rmSync(directory, { recursive: true, force: true });
});

async function startedFixture() {
  const fixture = await nativePavModelRunSqlFixture();
  const rootDirectory = mkdtempSync(join(tmpdir(), 'statly-native-candidate-checkpoint-'));
  artifactRoots.push(rootDirectory);
  const candidateArtifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory,
    repositoryId: 'candidate-checkpoint',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  const dependencies = {
    sql: fixture.sql,
    artifactRepository: fixture.artifactRepository,
    gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(fixture.sql),
    candidateArtifactRepository,
  };
  const adapter = new PostgresAflTradeAdmittedModelRunAuthority(dependencies);
  await adapter.prepare(fixture);
  expect(await adapter.issueOnceForIntent(fixture)).toBe(true);
  expect(
    await adapter.consumeIntentOnce({
      authorizationId: fixture.authorization.authorizationId,
      intentId: fixture.intent.intentId,
      consumedAt: fixture.startedAt,
    })
  ).toBe(true);
  return {
    fixture,
    dependencies,
    adapter,
    candidateArtifactRepository,
    request: {
      intentId: fixture.intent.intentId,
      authorizationId: fixture.authorization.authorizationId,
    },
  };
}

describe('native PAV candidate checkpoint', () => {
  it.each(['plan_write', 'plan_readback', 'custody_readback'] as const)(
    'recovers retained numerical artifacts after %s failure at a later database time',
    async (failure) => {
      const { fixture, dependencies, request, candidateArtifactRepository } =
        await startedFixture();
      const clock = await fixture.sql.transaction((tx) =>
        tx.query<{ now: string }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS now")
      );
      const firstDatabaseTime = clock.rows[0]!.now;
      let later = false;
      let failPlan = true;
      const sql: AflOutcomeSqlClient = {
        async query<Row>(statement: string, parameters: readonly unknown[] = []) {
          if (statement.includes('SELECT root.intent_json,authority.consumed_at'))
            return {
              rows: [{ intent_json: fixture.intent, consumed_at: fixture.startedAt }] as Row[],
              rowCount: 1,
            };
          if (statement.includes('SELECT intent_json FROM outcome_valuation_model_run_intent'))
            return { rows: [{ intent_json: fixture.intent }] as Row[], rowCount: 1 };
          if (statement.includes('SELECT run.run_json,authority.authorization_json'))
            return { rows: [] as Row[], rowCount: 0 };
          if (later && statement.includes('clock_timestamp()) AS now'))
            return {
              rows: [
                { now: new Date(Date.parse(firstDatabaseTime) + 1000).toISOString() },
              ] as Row[],
              rowCount: 1,
            };
          return fixture.sql.query<Row>(statement, parameters);
        },
        async transaction(work) {
          return fixture.sql.transaction(() => work(sql));
        },
      };
      const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
        ...dependencies,
        sql,
        candidateArtifactRepository: {
          ...candidateArtifactRepository,
          async putIfAbsent(reference, bytes) {
            const content = JSON.parse(new TextDecoder().decode(bytes)).content;
            if (
              later &&
              [
                'afl-trade-admitted-player-pav-candidate/v1',
                'afl-trade-native-pav-pre-final-evaluation/v1',
              ].includes(content?.schemaVersion)
            )
              throw new Error(
                'Accepted numerical stages must be restored without another artifact write.'
              );
            if (
              failPlan &&
              failure === 'plan_write' &&
              JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion ===
                'afl-trade-native-pav-validation-plan-evidence/v1'
            )
              throw new Error('Synthetic transient validation-plan storage failure');
            return candidateArtifactRepository.putIfAbsent(reference, bytes);
          },
          async loadExact(reference, maximumBytes) {
            const stored = await candidateArtifactRepository.loadExact(reference, maximumBytes);
            if (failPlan && stored) {
              const document = JSON.parse(new TextDecoder().decode(stored.bytes));
              if (
                (failure === 'plan_readback' &&
                  document.content?.schemaVersion ===
                    'afl-trade-native-pav-validation-plan-evidence/v1') ||
                (failure === 'custody_readback' &&
                  document.schemaVersion === 'afl-trade-native-pav-candidate-custody/v3')
              )
                return null;
            }
            return stored;
          },
        },
      });
      await expect(adapter.retainNativeCandidateCheckpoint(request)).rejects.toThrow(
        /transient validation-plan storage failure|exact retained (validation plan|candidate evidence) bytes/
      );
      const progress = await adapter.loadRetainedRecoveryState({ intentId: request.intentId });
      expect(progress.checkpoints.map((checkpoint) => checkpoint.content.stage)).toEqual([
        'started',
        'candidate_fitted',
        'pre_final_retained',
      ]);
      expect(progress.terminalRun).toBeNull();
      later = true;
      failPlan = false;
      const recovered = await adapter.retainNativeCandidateCheckpoint(request);
      expect(recovered.state).toBe('candidate_locked');
      expect(recovered.checkpoint.content.candidateArtifact!.createdAt).toBe(firstDatabaseTime);
      const stored = await candidateArtifactRepository.loadExact(
        recovered.checkpoint.content.evidenceArtifact!,
        4 * 1024 * 1024
      );
      const custody = JSON.parse(new TextDecoder().decode(stored!.bytes));
      expect(custody.preFinalArtifact.createdAt).toBe(firstDatabaseTime);
      if (failure !== 'plan_write')
        expect(custody.validationPlanArtifact.createdAt).toBe(firstDatabaseTime);
      if (failure === 'custody_readback')
        expect(recovered.checkpoint.content.evidenceArtifact!.createdAt).toBe(firstDatabaseTime);
    },
    120_000
  );

  it('requires an explicitly configured candidate artifact store', async () => {
    const sql: AflOutcomeSqlClient = {
      async query() {
        throw new Error('Missing candidate storage must fail before database access.');
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
      adapter.retainNativeCandidateCheckpoint({
        intentId: `model-run-intent:${'a'.repeat(64)}`,
        authorizationId: `model-run-authorization:${'b'.repeat(64)}`,
      })
    ).rejects.toThrow(/candidate.*artifact.*(store|repository)/i);
  });

  it('retains exact fitted candidate custody then replays without another checkpoint or artifact write', async () => {
    const { fixture, adapter, request, candidateArtifactRepository } = await startedFixture();
    const locked = await adapter.retainNativeCandidateCheckpoint(request);
    expect(locked.state).toBe('candidate_locked');
    expect(locked.checkpoint.content).toMatchObject({
      stage: 'candidate_locked',
      previousCheckpointId: expect.stringMatching(/^model-run-checkpoint:/),
      rootIntentId: fixture.intent.intentId,
    });
    const artifact = locked.checkpoint.content.candidateArtifact!;
    const stored = await candidateArtifactRepository.loadExact(artifact, 4 * 1024 * 1024);
    expect(stored).not.toBeNull();
    const candidate = aflTradeAdmittedPlayerPavCandidateSchema.parse(
      JSON.parse(new TextDecoder().decode(stored!.bytes))
    );
    expect(candidate.content).toMatchObject({
      configurationArtifact: fixture.intent.content.configurationArtifact,
      pavObservationSetId: fixture.evidence.pavObservationSet.observationSetId,
      authorityBoundary: 'numerical_fit_only_no_execution_or_qualification_authority',
    });
    expect(candidate.content.trainingObservationIds).toHaveLength(1);
    const custody = await candidateArtifactRepository.loadExact(
      locked.checkpoint.content.evidenceArtifact!,
      4 * 1024 * 1024
    );
    expect(JSON.parse(new TextDecoder().decode(custody!.bytes))).toMatchObject({
      schemaVersion: 'afl-trade-native-pav-candidate-custody/v3',
      preFinalArtifact: expect.objectContaining({ mediaType: 'application/json' }),
      validationPlanArtifact: expect.objectContaining({ mediaType: 'application/json' }),
    });
    const beforeReplay = fixture.calls.length;
    const historicalSql: AflOutcomeSqlClient = {
      async query<Row>(statement: string, parameters: readonly unknown[] = []) {
        if (
          statement.includes('SELECT protocol.protocol_json') ||
          statement.includes('FROM outcome_hpn_pav_input_set')
        )
          throw new Error('Historical replay must not reauthorize current sources.');
        if (statement.includes('clock_timestamp()) AS now'))
          return { rows: [{ now: '2030-01-01T00:00:00.000Z' }] as Row[], rowCount: 1 };
        return fixture.sql.query<Row>(statement, parameters);
      },
      async transaction(work) {
        return fixture.sql.transaction(() => work(historicalSql));
      },
    };
    const replayAdapter = new PostgresAflTradeAdmittedModelRunAuthority({
      ...{
        sql: historicalSql,
        artifactRepository: fixture.artifactRepository,
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(
          fixture.sql
        ),
      },
      candidateArtifactRepository: {
        ...candidateArtifactRepository,
        async putIfAbsent() {
          throw new Error('Replay must not write artifacts.');
        },
      },
    });
    await expect(replayAdapter.retainNativeCandidateCheckpoint(request)).resolves.toEqual({
      state: 'already_locked',
      checkpoint: locked.checkpoint,
    });
    expect(fixture.calls.slice(beforeReplay).some(({ sql }) => sql.startsWith('INSERT'))).toBe(
      false
    );
    expect(
      [...fixture.retained.keys()].some((key) => key.startsWith('outcome_valuation_model_run:'))
    ).toBe(false);
    const corrupted = new PostgresAflTradeAdmittedModelRunAuthority({
      sql: historicalSql,
      artifactRepository: fixture.artifactRepository,
      gateDecisionLedgerRepository:
        createPostgresAflTradeGateDecisionLedgerRepository(historicalSql),
      candidateArtifactRepository: {
        ...candidateArtifactRepository,
        async loadExact(reference, maximumBytes) {
          const retained = await candidateArtifactRepository.loadExact(reference, maximumBytes);
          return retained && reference.artifactId === artifact.artifactId
            ? { ...retained, bytes: new TextEncoder().encode('{"changed":true}') }
            : retained;
        },
      },
    });
    await expect(corrupted.retainNativeCandidateCheckpoint(request)).rejects.toThrow(
      'exact retained artifact bytes'
    );
    const substituted = createAflTradeModelRunCheckpointV2({
      ...locked.checkpoint.content,
      evidenceArtifact: artifact,
    });
    fixture.retained.delete(
      `outcome_valuation_model_run_checkpoint:${locked.checkpoint.checkpointId}`
    );
    fixture.retained.set(
      `outcome_valuation_model_run_checkpoint:${substituted.checkpointId}`,
      substituted
    );
    await expect(replayAdapter.retainNativeCandidateCheckpoint(request)).rejects.toThrow(
      'Retained native candidate checkpoint ancestry is inconsistent.'
    );
  }, 60_000);

  it.each([
    'missing_configuration',
    'stale_head',
    'storage_failure',
    'storage_readback_missing',
    'plan_storage_failure',
    'plan_readback_missing',
    'future_pre_final_reference',
    'changed_pre_final_media',
    'changed_custody_boundary',
  ] as const)(
    'rejects %s without a candidate checkpoint',
    async (failure) => {
      const { fixture, dependencies, request, candidateArtifactRepository } =
        await startedFixture();
      let custodyChanged = false;
      const sql: AflOutcomeSqlClient = {
        async query<Row>(statement: string, parameters: readonly unknown[] = []) {
          if (
            failure === 'stale_head' &&
            statement.includes('SELECT head.revision,head.calculation_id')
          )
            return { rows: [] as Row[], rowCount: 0 };
          return fixture.sql.query<Row>(statement, parameters);
        },
        async transaction(work) {
          return fixture.sql.transaction(() => work(sql));
        },
      };
      const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
        ...dependencies,
        sql,
        artifactRepository: {
          ...fixture.artifactRepository,
          async loadExact(reference, maximumBytes) {
            if (
              failure === 'missing_configuration' &&
              reference.artifactId === fixture.intent.content.configurationArtifact.artifactId
            )
              return null;
            return fixture.artifactRepository.loadExact(reference, maximumBytes);
          },
        },
        candidateArtifactRepository: {
          ...candidateArtifactRepository,
          get assurance() {
            return custodyChanged
              ? ('fixture_memory' as const)
              : candidateArtifactRepository.assurance;
          },
          async loadExact(reference, maximumBytes) {
            if (failure === 'storage_readback_missing') return null;
            const stored = await candidateArtifactRepository.loadExact(reference, maximumBytes);
            if (
              failure === 'plan_readback_missing' &&
              stored &&
              JSON.parse(new TextDecoder().decode(stored.bytes)).content?.schemaVersion ===
                'afl-trade-native-pav-validation-plan-evidence/v1'
            )
              return null;
            return stored;
          },
          async putIfAbsent(reference, bytes) {
            if (
              failure === 'storage_failure' ||
              (failure === 'plan_storage_failure' &&
                JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion ===
                  'afl-trade-native-pav-validation-plan-evidence/v1')
            )
              throw new Error('Synthetic candidate storage unavailable');
            const retained = await candidateArtifactRepository.putIfAbsent(reference, bytes);
            if (
              JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion ===
              'afl-trade-native-pav-pre-final-evaluation/v1'
            ) {
              if (failure === 'future_pre_final_reference')
                return {
                  ...retained,
                  reference: { ...retained.reference, createdAt: '2030-01-01T00:00:00.000Z' },
                };
              if (failure === 'changed_pre_final_media')
                return {
                  ...retained,
                  reference: { ...retained.reference, mediaType: 'text/plain' },
                };
              if (failure === 'changed_custody_boundary') custodyChanged = true;
            }
            return retained;
          },
        },
      });
      const expected = [
        'future_pre_final_reference',
        'changed_pre_final_media',
        'changed_custody_boundary',
      ].includes(failure)
        ? /immutable metadata, chronology or profile/
        : failure === 'missing_configuration'
          ? /exact retained executable bytes/
          : failure === 'stale_head'
            ? /current finalized HPN calculation head/
            : failure === 'plan_readback_missing'
              ? /exact retained validation plan bytes/
              : failure === 'storage_readback_missing'
                ? /Stored artifact bytes do not match/
                : /Synthetic candidate storage unavailable/;
      await expect(adapter.retainNativeCandidateCheckpoint(request)).rejects.toThrow(expected);
      expect(
        [...fixture.retained.keys()].filter((key) =>
          key.startsWith('outcome_valuation_model_run_checkpoint:')
        )
      ).toHaveLength(
        ['plan_storage_failure', 'plan_readback_missing'].includes(failure)
          ? 3
          : [
                'future_pre_final_reference',
                'changed_pre_final_media',
                'changed_custody_boundary',
              ].includes(failure)
            ? 2
            : 1
      );
    },
    60_000
  );
});
