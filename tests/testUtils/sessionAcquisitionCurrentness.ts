import { Pool } from 'pg';
import { expect } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
  type AflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { createSyntheticAcquisitionPlayerPromotion } from './acquisitionPlayerPromotionFixture';

export async function verifySessionAcquisitionCurrentness(
  pool: Pool,
  promoted: Pick<
    Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>,
    'retainedArtifacts' | 'sourceArtifact' | 'clubId' | 'candidate'
  > & {
    draftEntries: Array<{
      player_id: string;
      entry: AflTradeAcquisitionSpellRegistration['content']['entry'];
    }>;
  }
): Promise<void> {
  const at = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const scope = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    {
      read: async (reference) => {
        const retained = promoted.retainedArtifacts.get(reference.artifactId);
        if (!retained) throw new Error('Missing retained fixture bytes.');
        return retained.bytes;
      },
    }
  );
  const approve = async (subjectType: string, subjectId: string, evidence: unknown) => {
    const decisionId = `synthetic-review:${subjectId}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Combined proof lifecycle fixture',$4::jsonb,'fixture-reviewer',$5)`,
      [decisionId, subjectType, subjectId, JSON.stringify(evidence), await at()]
    );
    return decisionId;
  };
  const entry = promoted.draftEntries[0]!;
  const window = entry.entry.eventDate === null;
  const rule = (
    window
      ? createAflTradeWindowAcquisitionSpellRegistrationRule
      : createAflTradeAcquisitionSpellRegistrationRule
  )({
    ...scope,
    ruleVersion: 'combined-session-public-path-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await at(),
  });
  await repository.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const spellInput = {
    ...scope,
    playerId: entry.player_id,
    clubId: promoted.clubId,
    entry: entry.entry,
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2025-09-27',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await at(),
  };
  const spell =
    entry.entry.eventDate === null
      ? createAflTradeWindowAcquisitionSpellRegistration(spellInput)
      : createAflTradeAcquisitionSpellRegistration({ ...spellInput, entry: entry.entry });
  const spellApprovalId = await approve(
    'acquisition_spell_registration',
    spell.spellVersionId,
    spell
  );
  expect(
    (
      await pool.query(
        `SELECT outcome_acquisition_registration_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,$4,clock_timestamp()) AS valid`,
        [
          JSON.stringify(spell.content.entry),
          spell.content.playerId,
          spell.content.clubId,
          spell.content.createdAt,
        ]
      )
    ).rows[0].valid,
    'Promoted acquisition entry must retain current authority'
  ).toBe(true);
  await expect(repository.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(
    spell
  );
  await expect(repository.registerReviewedSpell(spell, spellApprovalId, scope)).resolves.toEqual(
    spell
  );
  expect(
    (
      await pool.query<{ count: string }>(
        'SELECT count(*)::TEXT AS count FROM outcome_acquisition_spell_version WHERE spell_version_id=$1',
        [spell.spellVersionId]
      )
    ).rows[0]!.count
  ).toBe('1');
  expect((await repository.loadCurrentExact(spell.spellVersionId, scope)).spellVersionId).toBe(
    spell.spellVersionId
  );

  if (window) {
    expect(
      (
        await pool.query(
          `SELECT start_date,end_date,end_reason,
      outcome_acquisition_possible_membership(spell)::TEXT AS possible
      FROM outcome_acquisition_spell_version spell WHERE spell_version_id=$1`,
          [spell.spellVersionId]
        )
      ).rows
    ).toEqual([
      {
        start_date: null,
        end_date: null,
        end_reason: null,
        possible: `[${spell.content.entry.eventDate === null ? spell.content.entry.datePrecision.earliestDate : spell.content.entry.eventDate},)`,
      },
    ]);
    const duplicate = createAflTradeWindowAcquisitionSpellRegistration({
      ...spell.content,
      createdAt: await at(),
    });
    await expect(
      repository.registerReviewedSpell(
        duplicate,
        await approve('acquisition_spell_registration', duplicate.spellVersionId, duplicate),
        scope
      )
    ).rejects.toThrow('cannot overlap');
    if (spell.content.entry.eventDate !== null) throw new Error('Expected explicit window entry');
    const altered = createAflTradeWindowAcquisitionSpellRegistration({
      ...spell.content,
      version: 2,
      supersedesSpellVersionId: spell.spellVersionId,
      entry: {
        ...spell.content.entry,
        datePrecision: {
          ...spell.content.entry.datePrecision,
          latestDate: new Date(
            Date.parse(spell.content.entry.datePrecision.latestDate + 'T00:00:00Z') + 86400000
          )
            .toISOString()
            .slice(0, 10),
        },
      },
      createdAt: await at(),
    });
    await expect(
      repository.registerReviewedSpell(
        altered,
        await approve('acquisition_spell_registration', altered.spellVersionId, altered),
        scope
      )
    ).rejects.toThrow('exact current review');
    await expect(
      pool.query('INSERT INTO outcome_acquisition_spell_metric(spell_version_id) VALUES($1)', [
        spell.spellVersionId,
      ])
    ).rejects.toThrow('interval-aware metric and release qualification');
  }

  const requiredCaptures = (
    await pool.query<{ capture_id: string }>(
      `SELECT DISTINCT capture.capture_id
       FROM outcome_external_reconciliation_source_batch source
       JOIN outcome_external_evidence_row row USING(batch_id)
       JOIN outcome_external_evidence_batch batch USING(batch_id)
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       WHERE source.candidate_id=$1 AND row.claim_kind IN
         ('draft_session','draft_session_date','draft_session_window','draft_session_completion','draft_session_boundary','draft_completed_total')
       ORDER BY capture.capture_id`,
      [promoted.candidate.candidateId]
    )
  ).rows.map(({ capture_id }) => capture_id);
  const setStatus = async (captureId: string, status: 'approved' | 'rejected') => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query('UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
        captureId,
        status,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  expect(requiredCaptures.length).toBeGreaterThan(0);
  for (const captureId of requiredCaptures) {
    await setStatus(captureId, 'rejected');
    await expect(repository.loadCurrentExact(spell.spellVersionId, scope)).rejects.toThrow();
    await setStatus(captureId, 'approved');
    expect((await repository.loadCurrentExact(spell.spellVersionId, scope)).spellVersionId).toBe(
      spell.spellVersionId
    );
  }
}
