import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PostgresAflTradePromotionBackedCorpusRepository } from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradePostseasonMaterializationReview } from '@/server/aflTradeIntelligence/modeling/postseasonMaterializationReview';
import { loadCurrentAflTradePostseasonContext } from '@/server/aflTradeIntelligence/modeling/postgresPostseasonContextAuthority';
import {
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradePromotionBackedGate2AffectedArtifacts,
  createAflTradePromotionBackedGate2DecisionKey,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedGate2AdmissionContracts';
import { parseAflTradePromotionBackedFactualLineage } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { PostgresAflTradePromotionBackedFactualReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedFactualReleaseRepository';
import { PostgresAflTradePromotionBackedGate2Repository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';
import {
  AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
  AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  PostgresAflTradePrivateValuationCohortBinding,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCohortBinding';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { PostgresAflTradePrivateValuationTradeEvidence } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationTradeEvidence';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL outcomes PostgreSQL database is required.');
const schemaName = `historical_pilot_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sql = createPgAflOutcomeSqlClient(pool);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
      CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
    END IF;
  END $$`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT ON "${schemaName}".outcome_review_decision,
                     "${schemaName}".outcome_governed_evidence_reference
       TO afl_trade_nonproduction_governance_registry_writer`
  );
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
});

async function now() {
  return (
    await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
  ).rows[0]!.at.toISOString();
}

async function approve(id: string, type: string, subject: string, document: unknown) {
  const decidedAt = await now();
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Exact historical pilot fixture',$4::jsonb,
            'historical-pilot-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(document), decidedAt]
  );
  return decidedAt;
}

async function admitGate2(candidateId: string) {
  const gates = new PostgresAflTradePromotionBackedGate2Repository(sql);
  const staged = await gates.stage({ factualCandidateId: candidateId, createdAt: await now() });
  const stored = await pool.query<{ lineage_json: unknown }>(
    'SELECT lineage_json FROM outcome_corpus_factual_lineage WHERE lineage_id=$1',
    [staged.lineageId]
  );
  const lineage = parseAflTradePromotionBackedFactualLineage(stored.rows[0]!.lineage_json);
  const decisionKey = createAflTradePromotionBackedGate2DecisionKey(lineage);
  const affectedArtifacts = createAflTradePromotionBackedGate2AffectedArtifacts(lineage);
  const dimensions = [
    { name: 'competition', values: [lineage.content.competition] },
    { name: 'valid_from_season', values: [String(lineage.content.validFromSeason)] },
    { name: 'valid_through_season', values: [String(lineage.content.validThroughSeason)] },
  ];
  const scope = {
    scopeKey: lineage.content.scopeKey,
    description: 'Approve only the exact retained historical pilot lineage.',
    dimensions,
    exclusions: ['Model, valuation, grading, publication and activation authority'],
  };
  const proposedAt = await now();
  const evidenceId = createAflTradeContentAddress('artifact', {
    historicalPilot: lineage.lineageId,
  });
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    proposal: 'Approve this exact factual lineage for private historical evaluation.',
    alternativesConsidered: ['Keep the factual candidate unavailable.'],
    accountableOwner: 'historical-pilot-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidenceId],
    affectedArtifacts,
    proposedAt,
    proposedBy: 'historical-pilot-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decidedAt = await now();
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'historical-pilot-owner',
    decidedBy: 'historical-pilot-owner',
    reviewers: [],
    authorityEvidenceIds: [evidenceId],
    conditionResults: [],
    rationale: 'The exact historical factual lineage has been reviewed.',
    limitations: ['No numerical, grading, publication or activation authority.'],
    decidedAt,
    effectiveAt: decidedAt,
    revalidateAt: new Date(Date.parse(decidedAt) + 86_400_000).toISOString(),
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  await ledger.appendDecision({
    expectedRevision: (await ledger.load()).revision,
    proposal,
    decision,
  });
  const admitted = await gates.admit({ lineageId: lineage.lineageId, evaluatedAt: await now() });
  return admitted.admissionId;
}

it('binds and reads the exact 2020 historical pilot through real retained authority owners', async () => {
  await pool.query(
    `INSERT INTO outcome_player(player_id,display_name,status)
       VALUES ('afl-player:jeremy-cameron','Jeremy Cameron','approved');
       INSERT INTO outcome_club(club_id,current_name,status) VALUES
         ('afl-club:greater-western-sydney','Greater Western Sydney','approved'),
         ('afl-club:geelong','Geelong','approved')`
  );
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    tradeSeasonYear: 2020,
    candidateAnchorSeasonYear: 2021,
    reciprocalFuturePickYearOffset: 1,
    promoterThroughSeason: 2021,
    providerEventId: '2020-jeremy-cameron',
    sessionProposalV5: true,
    partialTransactionDates: true,
    existingTargets: {
      playerId: 'afl-player:jeremy-cameron',
      playerName: 'Jeremy Cameron',
      fromClubId: 'afl-club:greater-western-sydney',
      fromClubName: 'Greater Western Sydney',
      toClubId: 'afl-club:geelong',
      toClubName: 'Geelong',
    },
  });
  const event = (
    await pool.query<{ event_id: string; season_year: number; event_date: string | null }>(
      `SELECT root.event_id,root.season_year,to_char(version.event_date,'YYYY-MM-DD') event_date
           FROM outcome_event_version version JOIN outcome_event root USING(event_id)
          WHERE version.event_version_id=$1`,
      [promoted.entry.eventVersionId]
    )
  ).rows[0]!;
  expect(event).toEqual({
    event_id: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
    season_year: 2020,
    event_date: null,
  });
  const evidence = {
    read: async (reference: { artifactId: string }) => {
      const retained = promoted.retainedArtifacts.get(reference.artifactId);
      if (!retained) throw new Error('Missing retained historical pilot evidence.');
      return retained.bytes;
    },
  };
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(sql, evidence);
  const rule = createAflTradeWindowAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'historical-pilot-2020-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await now(),
  });
  const ruleDecisionId = 'historical-pilot-rule-review';
  await approve(ruleDecisionId, 'acquisition_spell_rule', rule.ruleId, rule);
  await spells.registerReviewedRule(rule, ruleDecisionId, scope);
  const spell = createAflTradeWindowAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: {
      promotionId: promoted.entry.promotionId,
      eventVersionId: promoted.entry.eventVersionId,
      assetVersionId: promoted.entry.assetVersionId,
      eventDate: null,
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2020-01-01',
        latestDate: '2020-12-31',
      },
      evidence: [promoted.sourceArtifact],
    },
    departure: null,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: '2020-12-31',
    continuityEvidence: [promoted.sourceArtifact],
    createdAt: await now(),
  });
  const spellDecisionId = 'historical-pilot-spell-review';
  await approve(spellDecisionId, 'acquisition_spell_registration', spell.spellVersionId, spell);
  await spells.registerReviewedSpell(spell, spellDecisionId, scope);
  const corpus = await new PostgresAflTradePromotionBackedCorpusRepository(sql).build({
    ...scope,
    knowledgeCutoffAt: await now(),
    createdAt: await now(),
  });
  expect(
    (
      await pool.query<{ anchor_season_range: unknown }>(
        `SELECT corpus_json#>'{content,anchorSeasonRange}' anchor_season_range
           FROM outcome_promotion_backed_corpus WHERE corpus_id=$1`,
        [corpus.corpusId]
      )
    ).rows[0]!.anchor_season_range
  ).toEqual({ from: 2021, through: 2021 });
  const release = await new PostgresAflTradePromotionBackedFactualReleaseRepository(sql).build({
    corpusId: corpus.corpusId,
    scopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
    createdAt: await now(),
  });
  const admissionId = await admitGate2(release.candidateId);
  const review = createAflTradePostseasonMaterializationReview({
    schemaVersion: 'afl-trade-postseason-materialization-review/v1',
    authorityBoundary: 'private_factual_materialization_no_numerical_admission',
    ...scope,
    scopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
    releaseId: release.releaseId,
    spellVersionId: spell.spellVersionId,
    tradeId: event.event_id,
    promotionId: promoted.entry.promotionId,
    eventVersionId: promoted.entry.eventVersionId,
    tradeYear: 2020,
    tradeDate: null,
    period: 'established_postseason',
    reviewEvidence: promoted.sourceArtifact,
    createdAt: await now(),
  });
  const reviewDecisionId = 'historical-pilot-postseason-review';
  await approve(reviewDecisionId, 'postseason_materialization', review.reviewId, review);
  const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
  const requestId = await sql.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const scheduled = await transaction.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch(
          $1,'ad_hoc',date_trunc('milliseconds',clock_timestamp()),$2) request_id`,
      [AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY, 'historical-pilot-positive-path']
    );
    return scheduled.rows[0]!.request_id;
  });
  const claim = await schedule.claim('system:historical-pilot', requestId);
  if (claim === null) throw new Error('Historical pilot dispatch was not claimable.');
  const selection = {
    requestId,
    claim: { claimId: claim.claimId, leaseToken: claim.leaseToken },
    lineageAdmissionId: admissionId,
    reviewDecisionId,
    knowledgeCutoffAt: await now(),
  };
  const postseason = await sql.transaction((transaction) =>
    loadCurrentAflTradePostseasonContext(
      transaction,
      {
        reviewDecisionId,
        environment: 'non_production',
        knowledgeCutoffAt: selection.knowledgeCutoffAt,
      },
      evidence
    )
  );
  await expect(
    sql.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await transaction.query(
        `SELECT bind_outcome_private_valuation_historical_cohort_input(
          $1,$2,$3,$4,$5::jsonb)`,
        [requestId, claim.claimId, '0'.repeat(64), admissionId, JSON.stringify(postseason.context)]
      );
    })
  ).rejects.toThrow(/dispatch|claim|lease/i);
  await expect(
    sql.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await transaction.query(
        'SELECT authenticate_outcome_private_valuation_historical_cohort_input($1,$2,$3::jsonb)',
        [requestId, admissionId, JSON.stringify(postseason.context)]
      );
    })
  ).rejects.toThrow(/permission denied/i);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int count FROM outcome_private_valuation_cohort_binding WHERE request_id=$1',
        [requestId]
      )
    ).rows
  ).toEqual([{ count: 0 }]);

  const nullCutoffContent = { ...postseason.context.content, knowledgeCutoffAt: null };
  const nullCutoffContext = {
    contextId: createAflTradeContentAddress('postseason-year-context', nullCutoffContent),
    content: nullCutoffContent,
  };
  await expect(
    sql.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await transaction.query(
        `SELECT bind_outcome_private_valuation_historical_cohort_input(
          $1,$2,$3,$4,$5::jsonb)`,
        [
          requestId,
          claim.claimId,
          createHash('sha256').update(claim.leaseToken, 'utf8').digest('hex'),
          admissionId,
          JSON.stringify(nullCutoffContext),
        ]
      );
    })
  ).rejects.toThrow(/outside the exact pilot/i);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int count FROM outcome_private_valuation_cohort_binding WHERE request_id=$1',
        [requestId]
      )
    ).rows
  ).toEqual([{ count: 0 }]);
  const releaseChecks = await pool.query<Record<string, boolean>>(
    `SELECT corpus.knowledge_cutoff_at IS NOT DISTINCT FROM release.effective_through same_cutoff,
              release.effective_through<=$2::timestamptz effective_before_context,
              release.created_at<=$2::timestamptz release_before_context,
              candidate.finalized_at<=$2::timestamptz candidate_before_context,
              release.manifest_json#>>'{content,corpusId}'=lineage.corpus_id corpus_matches,
              release.manifest_json#>>'{content,sourceMemberSetSha256}'=
                lineage.source_member_set_sha256::text source_set_matches,
              release.manifest_json#>>'{content,canonicalMemberSetSha256}'=
                lineage.canonical_member_set_sha256::text canonical_set_matches,
              'outcome-release:'||encode(sha256(convert_to(
                release.manifest_canonical_json,'UTF8')),'hex')=lineage.release_id address_matches,
              release.manifest_canonical_json::jsonb=release.manifest_json->'content' bytes_match,
              NOT EXISTS(SELECT 1 FROM outcome_active_release active
                WHERE active.release_id=lineage.release_id) inactive,
              NOT EXISTS(SELECT 1 FROM outcome_record_state_commitment state
                WHERE state.release_id=lineage.release_id AND state.event_revision=(
                  SELECT max(latest.event_revision) FROM outcome_record_state_commitment latest
                  WHERE latest.release_id=lineage.release_id)
                AND state.record_state_json->>'state'<>'approved') not_revoked
         FROM outcome_corpus_factual_lineage_admission admission
         JOIN outcome_corpus_factual_lineage lineage USING(lineage_id)
         JOIN outcome_factual_release_candidate candidate USING(candidate_id)
         JOIN outcome_release_manifest release ON release.release_id=lineage.release_id
         JOIN outcome_promotion_backed_corpus corpus USING(corpus_id)
        WHERE admission.admission_id=$1`,
    [admissionId, selection.knowledgeCutoffAt]
  );
  expect(releaseChecks.rows).toEqual([
    {
      same_cutoff: true,
      effective_before_context: true,
      release_before_context: true,
      candidate_before_context: true,
      corpus_matches: true,
      source_set_matches: true,
      canonical_set_matches: true,
      address_matches: true,
      bytes_match: true,
      inactive: true,
      not_revoked: true,
    },
  ]);
  const bindingOwner = new PostgresAflTradePrivateValuationCohortBinding(sql, evidence);
  const binding = await bindingOwner.bindHistoricalPilot(selection);
  expect(binding.cohortTransactionId).toBe(AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID);
  expect(binding.cohortTradeIds).toEqual([promoted.entry.eventVersionId]);
  expect(await bindingOwner.loadHistoricalPilot(selection)).toEqual(binding);
  const tradeEvidence = new PostgresAflTradePrivateValuationTradeEvidence(sql, evidence);
  const evidenceSelection = {
    requestId: selection.requestId,
    claim: selection.claim,
    reviewDecisionId: selection.reviewDecisionId,
    knowledgeCutoffAt: selection.knowledgeCutoffAt,
  };
  const first = await tradeEvidence.loadHistoricalPilot(evidenceSelection);
  expect(first.trades).toEqual([
    {
      eventId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
      eventVersionId: promoted.entry.eventVersionId,
    },
  ]);
  expect(await tradeEvidence.loadHistoricalPilot(evidenceSelection)).toEqual(first);
  expect((await pool.query('SELECT count(*)::int count FROM outcome_active_release')).rows).toEqual(
    [{ count: 0 }]
  );
}, 180_000);
