import { aflTradeFactualReconciliationRunSchema } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { reconcileAflTradeFactualFacts } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationService';
import { PostgresAflTradeFactualReconciliationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReconciliationRepository';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  prepareLocalAflTradeFitzRoyFactualReleaseCandidate,
  prepareLocalAflTradeFitzRoyMatchEvidence,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradePostseasonSeasonCoverage,
  aflTradePostseasonCoverageSubject,
} from '@/server/aflTradeIntelligence/modeling/postseasonSeasonCoverage';
import { loadCurrentAflTradePostseasonCoverage } from '@/server/aflTradeIntelligence/modeling/postgresPostseasonCoverageAuthority';
import { loadCurrentAflTradePostseasonCalculation } from '@/server/aflTradeIntelligence/modeling/postgresPostseasonCalculationAuthority';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { registerSourceFirstHpnPlayerMapFixture } from '../testUtils/sourceFirstHpnPlayerMapFixture';
import { registerSourceFirstHpnResultsMapFixture } from '../testUtils/sourceFirstHpnResultsMapFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});
const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

// Synthetic upstream bytes and reviews; all source, identity, factual, projection,
// promotion, spell and HPN owners execute without replacing database guards.
it('builds and reloads a source-first HPN input with a registered spell and rejects withdrawn current authority', async () => {
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const sources = [];
  const primaryRuns: string[] = [];
  for (const provider of ['footywire', 'afl_tables'] as const) {
    for (const hpnPlayerSide of ['home', 'away'] as const) {
      const options = { provider, profile: 'hpn_player_stats' as const, hpnPlayerSide };
      const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
      const source = fixture.command.capture;
      if (hpnPlayerSide === 'home')
        await ledger.appendBatch({
          expectedRevision: (await ledger.load()).revision,
          records: [
            {
              sourceRights: source.sourceRights,
              proposal: source.ledger.proposals[0]!,
              decision: source.ledger.decisions[0]!,
            },
          ],
        });
      const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
      const factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
        provider,
        hpnPlayerStats: true,
        hpnPlayerSide,
      });
      if (provider === 'footywire') primaryRuns.push(factual.receipt.factualRunId);
      const map = await registerSourceFirstHpnPlayerMapFixture(
        client,
        staged,
        provider,
        hpnPlayerSide
      );
      sources.push({
        normalizationRunId: staged.staging.normalization.normalizationRunId,
        fieldMapId: map.fieldMapId,
        inputKind: 'player_match_stats',
        role: provider === 'footywire' ? 'primary' : 'corroborating',
      });
    }
  }
  const resultSource = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'match_only',
  }).command.capture;
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: resultSource.sourceRights,
        proposal: resultSource.ledger.proposals[0]!,
        decision: resultSource.ledger.decisions[0]!,
      },
    ],
  });
  const results = await prepareLocalAflTradeFitzRoyMatchEvidence(client);
  const resultMap = await registerSourceFirstHpnResultsMapFixture(client, results);
  sources.push({
    normalizationRunId: results.ingestion.staging.normalization.normalizationRunId,
    fieldMapId: resultMap.fieldMapId,
    inputKind: 'completed_match_result',
    role: null,
  });
  const storedRuns = await pool.query(
    'SELECT COALESCE(receipt_canonical_json::jsonb,receipt_json) AS receipt_json FROM outcome_factual_reconciliation_run WHERE factual_run_id=ANY($1::text[])',
    [primaryRuns]
  );
  const runs = storedRuns.rows.map(({ receipt_json }) =>
    aflTradeFactualReconciliationRunSchema.parse(receipt_json)
  );
  expect(runs).toHaveLength(2);
  const heads = await pool.query<{ subject_key: string; revision: number }>(
    'SELECT subject_key,revision FROM outcome_reconciled_factual_metric_head'
  );
  const combined = reconcileAflTradeFactualFacts({
    policy: runs[0]!.content.policy,
    sourceMemberships: runs.flatMap((run) => run.content.sourceMemberships),
    currentHeadRevisions: heads.rows.map((row) => ({
      subjectKey: row.subject_key,
      revision: row.revision,
    })),
    startedAt: await instant(),
    completedAt: await instant(),
  });
  await new PostgresAflTradeFactualReconciliationRepository(client).persistRun(combined, {
    environment: 'non_production',
  });
  const factualRunId = combined.factualRunId;
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    draftSessions: true,
    existingDraftTargets: [
      {
        playerId: 'afl-player:local-rehearsal',
        playerName: 'Player One',
        clubId: 'afl-club:local-rehearsal',
        clubName: 'Carlton',
      },
      {
        playerId: 'afl-player:local-rehearsal-away',
        playerName: 'Player Two',
        clubId: 'afl-club:local-rehearsal-away',
        clubName: 'Fremantle',
      },
    ],
    existingTargets: {
      playerId: 'afl-player:local-rehearsal',
      playerName: 'Player One',
      fromClubId: 'afl-club:local-rehearsal-away',
      fromClubName: 'Fremantle',
      toClubId: 'afl-club:local-rehearsal',
      toClubName: 'Carlton',
    },
  });
  const approve = async (type: string, subject: string, content: unknown) => {
    const id = `synthetic-hpn-registration-review:${subject}`;
    await pool.query(
      `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic complete HPN input regression',$4::jsonb,'synthetic-reviewer',$5)`,
      [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
    );
    return id;
  };
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async (reference) => {
      const artifact = promoted.retainedArtifacts.get(reference.artifactId);
      if (!artifact) throw new Error('Missing exact retained fixture artifact.');
      return artifact.bytes;
    },
  });
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-complete-hpn-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  let spell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.draftEntries[0]!.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2026-03-19',
    continuityEvidence: promoted.draftEntries[0]!.entry.evidence,
    createdAt: await instant(),
  });
  let approval = await approve('acquisition_spell_registration', spell.spellVersionId, spell);
  await spells.registerReviewedSpell(spell, approval, scope);
  const awaySpell = createAflTradeAcquisitionSpellRegistration({
    ...spell.content,
    playerId: 'afl-player:local-rehearsal-away',
    clubId: 'afl-club:local-rehearsal-away',
    entry: promoted.draftEntries[1]!.entry,
    observedThrough: '2026-03-20',
    continuityEvidence: promoted.draftEntries[1]!.entry.evidence,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    awaySpell,
    await approve('acquisition_spell_registration', awaySpell.spellVersionId, awaySpell),
    scope
  );
  const repository = new PostgresAflTradeHpnPavInputRepository(client);
  const methodBytes = new TextEncoder().encode(
    '<html>Explicit synthetic HPN method fixture</html>'
  );
  const methodArtifact = createAflTradeByteArtifactRef(methodBytes, 'text/html', await instant());
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
     VALUES($1,$2,$3,$4,$5,$6,$7,'non_production','raw_source','{}'::jsonb)`,
    [
      methodArtifact.artifactId,
      methodArtifact.contentSha256,
      methodArtifact.storageUri,
      methodArtifact.mediaType,
      methodArtifact.byteLength,
      methodArtifact.createdAt,
      await instant(),
    ]
  );
  const method = createAflTradeHpnPavMethod({
    sourceArtifact: methodArtifact,
    sourceBytes: methodBytes,
    capturedAt: methodArtifact.createdAt,
  });
  const methodAuthority = { loadExact: async () => ({ method, sourceBytes: methodBytes }) };
  const calculations = new PostgresAflTradeHpnPavCalculationRepository(client, methodAuthority);
  await calculations.registerMethod(method, scope);
  const request = {
    ...scope,
    seasonYear: 2026,
    methodId: method.methodId,
    factualRunId,
    effectiveThrough: '2026-03-20T23:59:59.999Z',
    sources,
    knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
    knowledgeCutoffAt: await instant(),
  };
  await expect(repository.buildAndPersistSeasonInputSet(request, scope)).rejects.toMatchObject({
    code: 'RESOLUTION_NOT_CURRENT',
  });
  spell = createAflTradeAcquisitionSpellRegistration({
    ...spell.content,
    version: 2,
    supersedesSpellVersionId: spell.spellVersionId,
    observedThrough: '2026-03-20',
    createdAt: await instant(),
  });
  approval = await approve('acquisition_spell_registration', spell.spellVersionId, spell);
  await spells.registerReviewedSpell(spell, approval, scope);
  request.knowledgeCutoffAt = await instant();
  const built = await repository.buildAndPersistSeasonInputSet(request, scope);
  expect(built.idempotentReplay).toBe(false);
  expect(built.inputSet.content.rows).toHaveLength(5);
  const players = built.inputSet.content.rows.filter((row) => row.kind === 'player_match_stats');
  expect(players).toHaveLength(4);
  expect(
    players.every(
      (row) =>
        row.acquisitionSpell.spellVersionId ===
        (row.player.canonicalId === 'afl-player:local-rehearsal'
          ? spell.spellVersionId
          : awaySpell.spellVersionId)
    )
  ).toBe(true);
  const read = {
    ...scope,
    seasonYear: 2026,
    methodId: request.methodId,
    inputSetId: built.inputSet.inputSetId,
  };
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).resolves.toEqual(
    built.inputSet
  );
  await expect(repository.buildAndPersistSeasonInputSet(request, scope)).resolves.toEqual({
    inputSet: built.inputSet,
    idempotentReplay: true,
  });
  const finalized = await calculations.calculateAndPersist(read, scope);
  const currentRequest = {
    ...scope,
    calculationId: finalized.calculation.calculationId,
    methodId: method.methodId,
    seasonYear: 2026,
    knowledgeCutoffAt: await instant(),
  };
  const loadCalculation = (overrides = {}) =>
    client.transaction((transaction) =>
      loadCurrentAflTradePostseasonCalculation(
        transaction,
        { ...currentRequest, ...overrides },
        methodAuthority
      )
    );
  await expect(loadCalculation()).resolves.toEqual({
    calculation: finalized.calculation,
    inputSet: built.inputSet,
  });
  // Simulate corrupted read results without disabling guards or modifying retained evidence.
  // The row counts remain unchanged; exact child projections must still reject the result.
  for (const collection of ['teams', 'players'] as const) {
    await expect(
      client.transaction((transaction) =>
        loadCurrentAflTradePostseasonCalculation(
          {
            async query<Row>(sql: string, parameters?: readonly unknown[]) {
              const result = await transaction.query<Row>(sql, parameters);
              if (!sql.includes('AS teams')) return result;
              const rows = structuredClone(result.rows);
              const retained = rows[0] as {
                teams: { total_pav: number }[];
                players: { total_pav: number }[];
              };
              retained[collection][0]!.total_pav += 1;
              return { ...result, rows };
            },
          },
          currentRequest,
          methodAuthority
        )
      )
    ).rejects.toThrow('exact persisted membership');
  }
  await expect(
    pool.query(
      'UPDATE outcome_hpn_pav_calculation_player SET total_pav=total_pav+1 WHERE calculation_id=$1',
      [currentRequest.calculationId]
    )
  ).rejects.toThrow();
  await expect(loadCalculation()).resolves.toEqual({
    calculation: finalized.calculation,
    inputSet: built.inputSet,
  });
  await expect(loadCalculation({ seasonYear: 2025 })).rejects.toThrow('not current and finalized');
  await expect(loadCalculation({ environment: 'test_fixture' })).rejects.toThrow(
    'not current and finalized'
  );
  await expect(
    loadCalculation({ knowledgeCutoffAt: built.inputSet.content.createdAt })
  ).rejects.toThrow('not current and finalized');
  await expect(
    client.transaction((transaction) =>
      loadCurrentAflTradePostseasonCalculation(transaction, currentRequest, {
        loadExact: async () => ({ method, sourceBytes: new TextEncoder().encode('wrong bytes') }),
      })
    )
  ).rejects.toThrow('method custody differs');
  const seasonArtifacts = new Map<string, Uint8Array>();
  const coverageReader = {
    read: async (ref: { artifactId: string }) => {
      const bytes = seasonArtifacts.get(ref.artifactId);
      if (!bytes) throw new Error('Unknown synthetic season evidence.');
      return bytes;
    },
  };
  const loadCoverage = async () => {
    const request = {
      ...scope,
      methodId: method.methodId,
      seasonYear: 2026,
      knowledgeCutoffAt: await instant(),
    };
    return client.transaction((transaction) =>
      loadCurrentAflTradePostseasonCoverage(transaction, request, methodAuthority, coverageReader)
    );
  };
  expect(await loadCoverage()).toBeNull();
  let priorCoverageDecision: string | null = null;
  const publishCoverage = async (state: 'complete' | 'partial', expectedMatchIds: string[]) => {
    const document = { fixtureOnly: true, state, expectedMatchIds, seasonYear: 2026 };
    const ref = createAflTradeCanonicalJsonArtifactRef(document, await instant());
    seasonArtifacts.set(
      ref.artifactId,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
    await pool.query(
      `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,'non_production','derived_private','{}')`,
      [
        ref.artifactId,
        ref.contentSha256,
        ref.storageUri,
        ref.mediaType,
        ref.byteLength,
        ref.createdAt,
        await instant(),
      ]
    );
    const coverage = createAflTradePostseasonSeasonCoverage({
      schemaVersion: 'afl-trade-postseason-season-coverage/v1',
      ...scope,
      seasonYear: 2026,
      methodId: method.methodId,
      calculationId: finalized.calculation.calculationId,
      state,
      expectedMatchIds,
      evidence: ref,
      createdAt: await instant(),
    });
    const id = `synthetic-coverage:${coverage.coverageId}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,'postseason_season_coverage',$2,'approved',$3,'Explicit synthetic season coverage',$4::jsonb,'synthetic-reviewer',$5)`,
      [
        id,
        aflTradePostseasonCoverageSubject(coverage.content),
        priorCoverageDecision,
        canonicalizeAflTradeJson(coverage),
        await instant(),
      ]
    );
    priorCoverageDecision = id;
    return coverage;
  };
  const matches = built.inputSet.content.completedMatches.map(({ matchId }) => matchId);
  const complete = await publishCoverage('complete', matches);
  expect((await loadCoverage())?.coverage).toEqual(complete);
  await publishCoverage('complete', [...matches, 'synthetic-unplayed-match']);
  await expect(loadCoverage()).rejects.toThrow('completed matches');
  const partial = await publishCoverage('partial', [...matches, 'synthetic-unplayed-match']);
  expect((await loadCoverage())?.coverage).toEqual(partial);
  seasonArtifacts.set(partial.content.evidence.artifactId, new TextEncoder().encode('corrupt'));
  await expect(loadCoverage()).rejects.toThrow('not current and exact');
  seasonArtifacts.set(
    partial.content.evidence.artifactId,
    new TextEncoder().encode(
      canonicalizeAflTradeJson({
        fixtureOnly: true,
        state: 'partial',
        expectedMatchIds: [...matches, 'synthetic-unplayed-match'],
        seasonYear: 2026,
      })
    )
  );
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
    VALUES('synthetic-full-hpn-revocation','acquisition_spell_registration',$1,'rejected',$2,'Synthetic withdrawal',$3::jsonb,'synthetic-reviewer',$4)`,
    [spell.spellVersionId, approval, canonicalizeAflTradeJson(spell), await instant()]
  );
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).rejects.toMatchObject({
    code: 'RESOLUTION_NOT_CURRENT',
  });
  await expect(repository.buildAndPersistSeasonInputSet(request, scope)).rejects.toMatchObject({
    code: 'RESOLUTION_NOT_CURRENT',
  });
  await expect(repository.loadFinalizedSeasonInputSet(read, scope)).resolves.toEqual(
    built.inputSet
  );
  await expect(loadCalculation()).rejects.toMatchObject({ code: 'RESOLUTION_NOT_CURRENT' });
  await expect(loadCoverage()).rejects.toMatchObject({ code: 'RESOLUTION_NOT_CURRENT' });
  await expect(
    calculations.loadFinalizedCalculation(
      {
        calculationId: finalized.calculation.calculationId,
        environment: scope.environment,
      },
      scope
    )
  ).resolves.toEqual(finalized.calculation);
});
