import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  createAflTradeHpnFieldMapCandidate,
  listAflTradeHpnCandidateSourceFields,
} from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { assessAflTradeHpnSourceFirstCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_source_projected_${process.pid}_${Date.now()}`;
const ordinaryRole = `afl_source_reader_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 4 });
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
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scoped.toString(),
  });
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
      CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
    END IF;
  END $$`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(`GRANT SELECT ON "${schemaName}".outcome_review_decision,
    "${schemaName}".outcome_governed_evidence_reference TO afl_trade_nonproduction_governance_registry_writer`);
  await admin.query(`CREATE ROLE "${ordinaryRole}" NOLOGIN`);
  await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${ordinaryRole}"`);
  await admin.query(
    `GRANT SELECT ON "${schemaName}".outcome_hpn_projected_field_map,"${schemaName}".outcome_hpn_field_map_review_decision TO "${ordinaryRole}"`
  );
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.query(`DROP ROLE IF EXISTS "${ordinaryRole}"`);
  await admin.end();
});

// Full database guards with explicit synthetic upstream bytes/reviews. No historical
// corpus, validator replacement, real provider request, or scientific claim.
it('authenticates an exact source-first result map and refuses another source occurrence', async () => {
  const options = { profile: 'completed_match_result' as const };
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
  const sourceAuthority = fixture.command.capture;
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: sourceAuthority.sourceRights,
        proposal: sourceAuthority.ledger.proposals[0]!,
        decision: sourceAuthority.ledger.decisions[0]!,
      },
    ],
  });
  const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
  const retained = await client.query<{ finalized_at: Date; staging_sha256: string }>(
    'SELECT finalized_at,staging_sha256 FROM outcome_provider_normalization_run WHERE normalization_run_id=$1',
    [staged.staging.normalization.normalizationRunId]
  );
  const at = (
    await client.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
  const map = fixture.command.fieldMap;
  const mapArtifact = createAflTradeCanonicalJsonArtifactRef(map, map.approvedAt);
  const candidate = createAflTradeHpnFieldMapCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    provider: 'footywire',
    capabilityId: map.capabilityId,
    sourceSchemaSha256: map.sourceSchemaSha256,
    inputKind: 'completed_match_result',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    providerDecodeMap: map,
    providerDecodeMapArtifact: mapArtifact,
    createdAt: at,
    semanticBindings: [
      { semanticField: 'match', mapping: { kind: 'direct', sourceField: 'match_id' } },
      { semanticField: 'homeClub', mapping: { kind: 'direct', sourceField: 'home' } },
      { semanticField: 'awayClub', mapping: { kind: 'direct', sourceField: 'away' } },
      { semanticField: 'homePoints', mapping: { kind: 'direct', sourceField: 'home_points' } },
      { semanticField: 'awayPoints', mapping: { kind: 'direct', sourceField: 'away_points' } },
      { semanticField: 'completionStatus', mapping: { kind: 'direct', sourceField: 'status' } },
    ],
    completionRule: { kind: 'source_status', completedValues: ['Final'] },
  });
  const sourceUseAssessment = assessAflTradeHpnSourceFirstCalculationSourceUse({
    rights: sourceAuthority.sourceRights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(
      sourceAuthority.sourceRights,
      sourceAuthority.sourceRights.content.proposedAt
    ),
    competition: 'AFLM',
    seasonYear: 2026,
    valuationScopeKey: 'afl-men:2026-trades',
    evaluatedAt: at,
    sourceFields: candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields),
    source: {
      captureId: staged.staging.capture.captureId,
      sourceSnapshotId: staged.snapshotId,
      sourceArtifact: staged.receipt.content.sourceCustody.artifact,
      normalizationRunId: staged.staging.normalization.normalizationRunId,
      normalizationFinalizationSha256: sha256AflTradeCanonicalJson({
        normalizationRunId: staged.staging.normalization.normalizationRunId,
        stagingSha256: retained.rows[0]!.staging_sha256,
        finalizedAt: retained.rows[0]!.finalized_at.toISOString(),
      }),
      providerDecodeMapId: map.mapId,
      providerDecodeMapSha256: mapArtifact.contentSha256,
      sourceSchemaSha256: map.sourceSchemaSha256,
      gateDecisionId: fixture.gateDecisionId,
      gateProposalId: sourceAuthority.ledger.proposals[0]!.proposalId,
      gateDecisionKey: sourceAuthority.ledger.decisions[0]!.content.decisionKey,
    },
  });
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, at);
  const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(sourceUseAssessment, at);
  const decision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: assessmentArtifact,
    decision: 'approved',
    reviewerId: 'synthetic-result-reviewer',
    rationale: 'Synthetic current-source authority regression only.',
    decidedAt: at,
  });
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(decision, at);
  const projectedFieldMap = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision,
    decisionArtifact,
  });
  const repository = new PostgresAflTradeHpnProjectedFieldMapAuthority(client);
  await repository.registerApprovedProjection({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: assessmentArtifact,
    reviewDecision: decision,
    decisionArtifact,
    projectedFieldMap,
  });
  const selector = {
    provider: 'footywire',
    capabilityId: map.capabilityId,
    inputKind: 'completed_match_result' as const,
    sourceSchemaSha256: map.sourceSchemaSha256,
    providerDecodeMapId: map.mapId,
    seasonYear: 2026,
    rightsArtifactId: sourceAuthority.sourceRights.rightsArtifactId,
    valuationScopeKey: 'afl-men:2026-trades',
    captureId: staged.staging.capture.captureId,
    normalizationRunId: staged.staging.normalization.normalizationRunId,
  };
  expect(await repository.loadCurrentForSource(selector)).toEqual(projectedFieldMap);
  await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
    const result = await transaction.query<{ exact: boolean }>(
      'SELECT outcome_hpn_source_first_projected_map_is_exact($1) AS exact',
      [projectedFieldMap.fieldMapId]
    );
    expect(result.rows[0]!.exact).toBe(true);
  });
  for (const source of [
    selector,
    { ...selector, captureId: 'source-capture:' + 'e'.repeat(64) },
    { ...selector, normalizationRunId: 'provider-normalization-run:' + 'f'.repeat(64) },
  ]) {
    await client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
      const authority = await transaction.query<{ exact: boolean }>(
        `SELECT outcome_hpn_source_first_projected_map_is_exact($1)
          AND outcome_hpn_projected_field_map_authority_for_source_is_exact($1,$2,$3,clock_timestamp()) AS exact`,
        [projectedFieldMap.fieldMapId, source.captureId, source.normalizationRunId]
      );
      expect(authority.rows[0]!.exact).toBe(source === selector);
    });
  }
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL ROLE "${ordinaryRole}"`);
    const result = await transaction.query<{ exact: boolean }>(
      'SELECT outcome_hpn_projected_field_map_authority_is_exact($1,clock_timestamp()) AS exact',
      [`hpn-pav-field-map:${'0'.repeat(64)}`]
    );
    expect(result.rows[0]!.exact).toBe(false);
  });
  for (const sql of [
    'SELECT outcome_hpn_source_first_projected_map_is_exact($1)',
    'SELECT outcome_hpn_projected_field_map_authority_is_exact($1,clock_timestamp())',
  ]) {
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE "${ordinaryRole}"`);
        await transaction.query(sql, [projectedFieldMap.fieldMapId]);
      })
    ).rejects.toThrow('permission denied');
  }
  for (const lock of [
    {
      sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      value: `outcome-review-subject:provider_field_map:${map.mapId}`,
    },
    {
      sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      value: `afl-trade-gate:gate_0a_permission_to_evaluate:non_production:${sourceAuthority.ledger.decisions[0]!.content.decisionKey}`,
    },
    {
      sql: 'SELECT capture_id FROM outcome_source_capture WHERE capture_id=$1 FOR UPDATE',
      value: selector.captureId,
    },
  ]) {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(lock.sql, [lock.value]);
      expect(await repository.loadCurrentForSource(selector)).toBeNull();
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(await repository.loadCurrentForSource(selector)).toEqual(projectedFieldMap);
  }
  expect(
    await repository.loadCurrentForSource({
      ...selector,
      normalizationRunId: `provider-normalization-run:${'f'.repeat(64)}`,
    })
  ).toBeNull();
  expect(
    await repository.loadCurrentForSource({
      ...selector,
      captureId: `source-capture:${'e'.repeat(64)}`,
    })
  ).toBeNull();

  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
  });
  const instant = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const approve = async (type: string, subject: string, content: unknown) => {
    const id = `synthetic-hpn-spell-review:${subject}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic source-first spell authority',$4::jsonb,'synthetic-reviewer',$5)`,
      [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
    );
    return id;
  };
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async () => promoted.sourceBytes,
  });
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-source-first-hpn-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const spell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2026-08-31',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  const approval = await approve('acquisition_spell_registration', spell.spellVersionId, spell);
  await spells.registerReviewedSpell(spell, approval, scope);
  const rowId = (
    await pool.query<{ provider_decoded_row_id: string }>(
      'SELECT provider_decoded_row_id FROM outcome_provider_decoded_row WHERE normalization_run_id=$1 ORDER BY provider_decoded_row_id LIMIT 1',
      [selector.normalizationRunId]
    )
  ).rows[0]!.provider_decoded_row_id;
  const eligible = async (date: string, row = rowId, run = selector.normalizationRunId) =>
    (
      await pool.query<{ eligible: boolean }>(
        'SELECT outcome_hpn_acquisition_spell_is_current($1,$2,$3,$4,$5::DATE,clock_timestamp()) AS eligible',
        [spell.spellVersionId, row, run, projectedFieldMap.fieldMapId, date]
      )
    ).rows[0]!.eligible;
  expect(await eligible('2026-08-31')).toBe(true);
  expect(await eligible('2026-09-01')).toBe(false);
  expect(await eligible('2026-08-31', 'another-source-row')).toBe(false);
  expect(await eligible('2026-08-31', rowId, 'another-source-run')).toBe(false);
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
    VALUES('synthetic-hpn-spell-revocation','acquisition_spell_registration',$1,'rejected',$2,
      'Synthetic authority withdrawal',$3::jsonb,'synthetic-reviewer',$4)`,
    [spell.spellVersionId, approval, canonicalizeAflTradeJson(spell), await instant()]
  );
  expect(await eligible('2026-08-31')).toBe(false);
  await expect(
    pool.query("UPDATE outcome_source_capture SET status='approved' WHERE capture_id=$1", [
      selector.captureId,
    ])
  ).rejects.toThrow('exact automated non-production admission');
  expect(await eligible('2026-08-31')).toBe(false);
  await expect(spells.loadCurrentExact(spell.spellVersionId, scope)).rejects.toThrow('not current');
});

// The database scalar boundary is shared by input guards and reviewed nonparticipants.
it.each([
  ['text', { kind: 'text', value: 'St Kilda' }, 'St Kilda'],
  ['zero', { kind: 'integer', value: '0' }, 0],
  ['false', { kind: 'logical', value: false }, false],
  ['missing', { kind: 'missing' }, null],
  ['finite', { kind: 'finite_number', value: '1.25e2' }, 125],
])('reads %s from flat and retained envelope payloads', async (_name, cell, expected) => {
  for (const payload of [{ Team: cell }, { values: { Team: cell }, observedSeasonText: '2025' }]) {
    const result = await pool.query(
      `SELECT outcome_hpn_pav_scalar($1::jsonb,'Team') AS value,
        outcome_hpn_pav_scalar($1::jsonb,'Team') IS NULL AS invalid`,
      [JSON.stringify(payload)]
    );
    expect(result.rows[0]).toEqual({ value: expected, invalid: false });
  }
});

it.each([
  null,
  [],
  {},
  { values: null },
  { values: [] },
  { values: {}, Team: { kind: 'text', value: 'fallback' } },
  { values: { Team: { kind: 'text', value: 'nested' } }, Team: { kind: 'text', value: 'flat' } },
  { values: { Team: { kind: 'text', value: 42 } } },
  { values: { Team: { kind: 'logical', value: 'false' } } },
  { values: { Team: { kind: 'missing', value: 42 } } },
  { values: { Team: { kind: 'integer', value: '' } } },
  { values: { Team: { kind: 'integer', value: '1.5' } } },
  { values: { Team: { kind: 'finite_number', value: 'NaN' } } },
])('fails closed for malformed or ambiguous scalar payload %#', async (payload) => {
  const result = await pool.query(
    `SELECT outcome_hpn_pav_scalar($1::jsonb,'Team') IS NULL AS invalid`,
    [JSON.stringify(payload)]
  );
  expect(result.rows[0].invalid).toBe(true);
});
