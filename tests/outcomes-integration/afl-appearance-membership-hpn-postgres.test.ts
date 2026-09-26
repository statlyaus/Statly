import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeAppearanceMembershipSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deriveAflTradeAppearanceMembershipSpells } from '@/server/aflTradeIntelligence/outcomes/appearanceMembershipSpellDerivation';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { registerSourceFirstHpnPlayerMapFixture } from '../testUtils/sourceFirstHpnPlayerMapFixture';
import { registerSourceFirstHpnResultsMapFixture } from '../testUtils/sourceFirstHpnResultsMapFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
let artifactRoot: string;
beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'postseason-measured-'));
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await rm(artifactRoot, { recursive: true, force: true });
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

// Synthetic upstream bytes and reviews; all source, identity, factual, projection, appearance
// membership and HPN owners execute without replacing database guards. No player has a promoted
// entry event: season PAV is attributed through appearance-membership (v3) spells only.
it('builds, calculates and reloads season HPN PAV attributed through appearance-membership spells', async () => {
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
  const approve = async (type: string, subject: string, content: unknown) => {
    const id = `synthetic-appearance-review:${subject}`;
    await pool.query(
      `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic appearance-membership HPN regression',$4::jsonb,'synthetic-reviewer',$5)`,
      [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
    );
    return id;
  };
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const ruleEvidenceBytes = new TextEncoder().encode(
    canonicalizeAflTradeJson({ ownerApprovedAppearanceMembership: 'season PAV attribution only' })
  );
  const ruleEvidence = createAflTradeCanonicalJsonArtifactRef(
    { ownerApprovedAppearanceMembership: 'season PAV attribution only' },
    await instant()
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
     VALUES($1,$2,$3,$4,$5,$6,$6,'non_production','derived_private','{}'::jsonb)`,
    [
      ruleEvidence.artifactId,
      ruleEvidence.contentSha256,
      ruleEvidence.storageUri,
      ruleEvidence.mediaType,
      ruleEvidence.byteLength,
      ruleEvidence.createdAt,
    ]
  );
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async () => ruleEvidenceBytes,
  });
  const rule = createAflTradeAppearanceMembershipSpellRule({
    ...scope,
    ruleVersion: 'synthetic-appearance-membership-hpn-v1',
    evidence: [ruleEvidence],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const facts = await pool.query<{
    appearance_fact_id: string;
    player_id: string;
    represented_club_id: string;
    match_id: string;
    season_year: number;
    effective_at: Date;
    availability: 'measured' | 'missing' | 'not_applicable' | 'quarantined';
    appeared: boolean | null;
  }>(
    `SELECT fact.appearance_fact_id,fact.player_id,fact.represented_club_id,fact.match_id,
            fact.season_year,fact.effective_at,fact.availability::text AS availability,fact.appeared
       FROM outcome_provider_player_appearance_fact fact
       JOIN outcome_provider_fact_batch batch ON batch.fact_batch_id=fact.fact_batch_id
      WHERE fact.competition='AFLM' AND fact.season_year=2026 AND batch.status='approved'
        AND batch.environment='non_production'`
  );
  const proposals = deriveAflTradeAppearanceMembershipSpells({
    ...scope,
    seasonYear: 2026,
    ruleId: rule.ruleId,
    createdAt: await instant(),
    facts: facts.rows.map((fact) => ({
      appearanceFactId: fact.appearance_fact_id,
      playerId: fact.player_id,
      clubId: fact.represented_club_id,
      matchId: fact.match_id,
      competition: 'AFLM' as const,
      seasonYear: fact.season_year,
      effectiveAt: fact.effective_at.toISOString(),
      availability: fact.availability,
      appeared: fact.appeared,
    })),
  });
  expect(proposals.map(({ content }) => [content.playerId, content.clubId])).toEqual([
    ['afl-player:local-rehearsal', 'afl-club:local-rehearsal'],
    ['afl-player:local-rehearsal-away', 'afl-club:local-rehearsal-away'],
  ]);
  for (const proposal of proposals) {
    await spells.registerReviewedSpell(
      proposal,
      await approve('acquisition_spell_registration', proposal.spellVersionId, proposal),
      scope
    );
  }
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
  const built = await repository.buildAndPersistSeasonInputSet(request, scope);
  expect(built.idempotentReplay).toBe(false);
  const players = built.inputSet.content.rows.filter((row) => row.kind === 'player_match_stats');
  expect(players).toHaveLength(4);
  const spellFor = new Map(proposals.map((proposal) => [proposal.content.playerId, proposal]));
  for (const row of players) {
    const expected = spellFor.get(row.player.canonicalId)!;
    expect(row.acquisitionSpell).toMatchObject({
      spellVersionId: expected.spellVersionId,
      startEventVersionId: null,
      startAssetVersionId: null,
      endReason: 'last_reviewed_appearance_in_season',
    });
  }
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
  expect(finalized.calculation.content.valueUnit).toBe('season_pav');
  expect(
    finalized.calculation.content.players.map((player) => player.spellVersionId).sort()
  ).toEqual(proposals.map((proposal) => proposal.spellVersionId).sort());
  const persisted = await pool.query<{ players: number }>(
    'SELECT count(*)::integer AS players FROM outcome_hpn_pav_calculation_player WHERE calculation_id=$1',
    [finalized.calculation.calculationId]
  );
  expect(persisted.rows[0]!.players).toBe(proposals.length);
  // The same appearance-membership spells stay unusable for trade-attribution consumers.
  await expect(
    pool.query(`INSERT INTO outcome_player_pav_observation (spell_version_id) VALUES ($1)`, [
      proposals[0]!.spellVersionId,
    ])
  ).rejects.toThrow('limited to HPN season PAV attribution');

  // Retirement: a reviewed entry spell covering the home player's window is admitted over the
  // current appearance-membership spell and makes it non-current, with no manual supersession.
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
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
  const reviewedSpells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async (reference) => {
      const artifact = promoted.retainedArtifacts.get(reference.artifactId);
      if (!artifact) throw new Error('Missing exact retained fixture artifact.');
      return artifact.bytes;
    },
  });
  const entryRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-reviewed-entry-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedRule(
    entryRule,
    await approve('acquisition_spell_rule', entryRule.ruleId, entryRule),
    scope
  );
  const reviewedSpell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: entryRule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2026-03-20',
    continuityEvidence: promoted.entry.evidence,
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedSpell(
    reviewedSpell,
    await approve('acquisition_spell_registration', reviewedSpell.spellVersionId, reviewedSpell),
    scope
  );
  const currentness = async (spellVersionId: string) =>
    (
      await pool.query<{ current: boolean }>(
        'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
        [spellVersionId]
      )
    ).rows[0]!.current;
  const homeWindow = spellFor.get('afl-player:local-rehearsal')!;
  const awayWindow = spellFor.get('afl-player:local-rehearsal-away')!;
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
  expect(await currentness(homeWindow.spellVersionId)).toBe(false);
  expect(await currentness(awayWindow.spellVersionId)).toBe(true);
  // The retained input bound to the retired window now fails current-authority reads; the logical
  // input scope is immutable, so a successor calculation belongs to a new scope, not this test.
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).rejects.toThrow();
});
