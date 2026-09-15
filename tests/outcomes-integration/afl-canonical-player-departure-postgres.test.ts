import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createCanonicalPlayerDeparture,
  canonicalDepartureSpellBinding,
  type CanonicalPlayerDeparture,
} from '@/server/aflTradeIntelligence/source/canonicalPlayerDeparture';
import { PostgresCanonicalPlayerDepartureRepository } from '@/server/aflTradeIntelligence/source/postgresCanonicalPlayerDepartureRepository';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `departure_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
const execution = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
let event: CanonicalPlayerDeparture;
let repository: PostgresCanonicalPlayerDepartureRepository;
let spells: PostgresAflTradeAcquisitionSpellRegistrationRepository;
let source: Awaited<ReturnType<typeof createRetainedExternalCaptureFixture>>;
const now = async () =>
  (
    await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
  ).rows[0]!.at.toISOString();
async function review(id: string, type: string, subject: string, record: unknown) {
  await pool.query(
    `INSERT INTO outcome_review_decision (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
 VALUES ($1,$2,$3,'approved','Synthetic exact departure review',$4::jsonb,'operator:external-canonical-promotion',clock_timestamp())`,
    [id, type, subject, canonicalizeAflTradeJson(record)]
  );
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const acquisition = await createSyntheticAcquisitionPlayerPromotion(pool, {
    tradeSeasonYear: 2010,
    promoterThroughSeason: 2012,
  });
  source = await createRetainedExternalCaptureFixture(
    sql,
    true,
    'test_fixture',
    1,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true
  );
  const evidenceId = (
    await pool.query('SELECT evidence_id FROM outcome_external_evidence_row WHERE batch_id=$1', [
      source.target.evidenceBatchId,
    ])
  ).rows[0].evidence_id;
  const reader = {
    read: async (ref: typeof acquisition.sourceArtifact) => {
      if (ref.artifactId === acquisition.sourceArtifact.artifactId) return acquisition.sourceBytes;
      const result = await source.raw.loadExact(ref, 2097152);
      if (!result) throw new Error('Fixture evidence absent');
      return result.bytes;
    },
  };
  repository = new PostgresCanonicalPlayerDepartureRepository(sql, reader);
  spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(sql, reader);
  event = createCanonicalPlayerDeparture({
    ...execution,
    playerId: acquisition.playerId,
    fromClubId: acquisition.clubId,
    toClubId: null,
    acquisition: acquisition.entry,
    departureYear: 2012,
    reason: 'contract_release',
    recordedPlayer: 'Synthetic Player',
    recordedClub: 'Synthetic Club',
    sourceEvidenceId: evidenceId,
    sourceBatchId: source.target.evidenceBatchId,
    evidence: [source.target.sourceArtifact],
    createdAt: await now(),
  });
  await review('departure-review', 'canonical_player_departure', event.departureEventId, event);
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('rejects forged SQL, missing approval, altered bytes and cross-scope execution', async () => {
  await expect(
    pool.query(
      `INSERT INTO outcome_canonical_player_departure (departure_event_id,content_canonical_json,approval_decision_id,registered_at,acquisition_asset_version_id) VALUES ('forged',$1,'departure-review',date_trunc('milliseconds',transaction_timestamp()),$2)`,
      [canonicalizeAflTradeJson(event.content), event.content.acquisition.assetVersionId]
    )
  ).rejects.toThrow();
  await expect(repository.register(event, 'missing-review', execution)).rejects.toThrow();
  await expect(
    repository.register(event, 'departure-review', { ...execution, environment: 'non_production' })
  ).rejects.toThrow('scope');
  await expect(
    new PostgresCanonicalPlayerDepartureRepository(sql, {
      read: async () => new Uint8Array([0]),
    }).register(event, 'departure-review', execution)
  ).rejects.toThrow('bytes');
});
it('rejects reviewed records that disagree with the retained claim or incoming identity', async () => {
  for (const [index, change] of [
    { recordedClub: 'Different Club' },
    { createdAt: source.target.request.capturedAt },
    { reason: 'delisting' as const },
    { playerId: 'player:unrelated' },
    { sourceEvidenceId: 'external-evidence:' + '0'.repeat(64) },
  ].entries()) {
    const wrong = createCanonicalPlayerDeparture({ ...event.content, ...change });
    await review(
      `wrong-departure-${index}`,
      'canonical_player_departure',
      wrong.departureEventId,
      wrong
    );
    await expect(
      repository.register(wrong, `wrong-departure-${index}`, execution)
    ).rejects.toThrow();
  }
  expect(
    (await pool.query('SELECT count(*)::int AS n FROM outcome_canonical_player_departure')).rows[0]
      .n
  ).toBe(0);
});

it('registers and replays the canonical departure, closes the exact spell, and rejects revoked authority', async () => {
  await expect(repository.register(event, 'departure-review', execution)).resolves.toEqual(event);
  await expect(repository.register(event, 'departure-review', execution)).resolves.toEqual(event);
  await expect(repository.loadCurrentExact(event.departureEventId, execution)).resolves.toEqual(
    event
  );
  expect(
    (await pool.query('SELECT count(*)::int AS n FROM outcome_canonical_player_departure')).rows[0]
      .n
  ).toBe(1);
  const duplicate = createCanonicalPlayerDeparture({ ...event.content, createdAt: await now() });
  await review(
    'duplicate-acquisition-review',
    'canonical_player_departure',
    duplicate.departureEventId,
    duplicate
  );
  await expect(
    repository.register(duplicate, 'duplicate-acquisition-review', execution)
  ).rejects.toThrow();
  const rule = createAflTradeWindowAcquisitionSpellRegistrationRule({
    ...execution,
    ruleVersion: 'synthetic-departure-v2',
    evidence: event.content.evidence,
    createdAt: await now(),
  });
  await review('departure-rule-review', 'acquisition_spell_rule', rule.ruleId, rule);
  await spells.registerReviewedRule(rule, 'departure-rule-review', execution);
  const spell = createAflTradeWindowAcquisitionSpellRegistration({
    ...execution,
    playerId: event.content.playerId,
    clubId: event.content.fromClubId,
    entry: event.content.acquisition,
    departure: canonicalDepartureSpellBinding(event),
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2013-12-31',
    continuityEvidence: event.content.evidence,
    createdAt: await now(),
  });
  await review(
    'departure-spell-review',
    'acquisition_spell_registration',
    spell.spellVersionId,
    spell
  );
  await expect(
    spells.registerReviewedSpell(spell, 'departure-spell-review', execution)
  ).resolves.toEqual(spell);
  await expect(spells.loadCurrentExact(spell.spellVersionId, execution)).resolves.toEqual(spell);
  const altered = createAflTradeWindowAcquisitionSpellRegistration({
    ...spell.content,
    departure: {
      ...canonicalDepartureSpellBinding(event),
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2012-02-01',
        latestDate: '2012-12-31',
      },
    },
  });
  await review(
    'altered-window-review',
    'acquisition_spell_registration',
    altered.spellVersionId,
    altered
  );
  await expect(
    spells.registerReviewedSpell(altered, 'altered-window-review', execution)
  ).rejects.toThrow();
  const row = (
    await pool.query(
      'SELECT end_date,end_reason FROM outcome_acquisition_spell_version WHERE spell_version_id=$1',
      [spell.spellVersionId]
    )
  ).rows[0];
  expect(row).toEqual({ end_date: null, end_reason: 'reviewed_departure' });
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const tx: AflOutcomeSqlClient = {
      query: async <Row>(query, parameters) => {
        const result = await connection.query(query, parameters ? [...parameters] : undefined);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
      transaction: async (work) => work(tx),
    };
    const at = await now();
    const proposalContent = {
      ...source.proposal.content,
      version: 2,
      proposedAt: at,
      proposal: 'Withdraw synthetic departure source',
    };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      ...source.decision.content,
      proposalId: proposal.proposalId,
      version: 2,
      state: 'withdrawn',
      decidedAt: at,
      effectiveAt: at,
      revalidateAt: null,
      supersedesDecisionId: source.decision.decisionId,
      withdrawalActions: ['Stop synthetic departure source use'],
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
      content: decisionContent,
    });
    const ledger = createPostgresAflTradeGateDecisionLedgerRepository(tx);
    await ledger.append({
      expectedRevision: (await ledger.load()).revision,
      sourceRights: source.rights,
      proposal,
      decision,
    });
    const revoked = await connection.query(
      'SELECT outcome_canonical_player_departure_current($1,clock_timestamp()) AS departure,outcome_acquisition_spell_registration_current($2,clock_timestamp()) AS spell',
      [event.departureEventId, spell.spellVersionId]
    );
    expect(revoked.rows[0]).toEqual({ departure: false, spell: false });
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }

  await expect(
    pool.query(`UPDATE outcome_canonical_player_departure SET content_canonical_json='{}'`)
  ).rejects.toThrow('immutable');
  await pool.query(
    `INSERT INTO outcome_review_decision (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
 VALUES ('departure-revoked','canonical_player_departure',$1,'rejected','Synthetic revocation','{}','operator:external-canonical-promotion',clock_timestamp(),'departure-review')`,
    [event.departureEventId]
  );
  await expect(repository.loadCurrentExact(event.departureEventId, execution)).rejects.toThrow(
    'current'
  );
  await expect(spells.loadCurrentExact(spell.spellVersionId, execution)).rejects.toThrow('current');
});
