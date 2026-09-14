import { verifySessionAcquisitionCurrentness } from '../testUtils/sessionAcquisitionCurrentness';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeAcquisitionSpellRegistration,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { createAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import { Pool } from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `draft_sessions_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120_000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('promotes two evidenced sessions of one draft with separate exact dates and stable replay', async () => {
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, { draftSessions: true });
  expect(promoted.draftAssets.map((asset) => asset.event_date)).toEqual([
    '2024-11-20',
    '2024-11-21',
  ]);
  expect(new Set(promoted.draftAssets.map((asset) => asset.event_id)).size).toBe(2);
  const at = async () =>
    (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString();
  const evidenceAt = await at();
  const document = { syntheticDraftContinuity: true };
  const reference = createAflTradeCanonicalJsonArtifactRef(document, evidenceAt);
  promoted.retainedArtifacts.set(reference.artifactId, {
    reference,
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
  });
  await pool.query(
    `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
    VALUES($1,$2,$3,$4,$5,'derived_private','test_fixture',$6,$6,'{}')`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      evidenceAt,
    ]
  );
  const approve = async (type: string, id: string, proposal: unknown) => {
    const decisionId = `synthetic-review:${id}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic exact review',$4::jsonb,'synthetic-reviewer',$5)`,
      [decisionId, type, id, canonicalizeAflTradeJson(proposal), await at()]
    );
    return decisionId;
  };
  const scope = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
  const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    createPgAflOutcomeSqlClient(pool),
    {
      read: async (ref) => {
        const retained = promoted.retainedArtifacts.get(ref.artifactId);
        if (!retained) throw new Error('Missing synthetic retained bytes.');
        return retained.bytes;
      },
    }
  );
  const rule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-draft-sessions-v1',
    evidence: [reference],
    createdAt: await at(),
  });
  await repository.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  for (const draft of promoted.draftEntries) {
    const spell = createAflTradeAcquisitionSpellRegistration({
      ...scope,
      playerId: draft.player_id,
      clubId: 'club-western-bulldogs',
      entry: draft.entry,
      departure: null,
      ruleId: rule.ruleId,
      version: 1,
      supersedesSpellVersionId: null,
      observedThrough: '2025-09-27',
      continuityEvidence: [reference],
      createdAt: await at(),
    });
    await repository.registerReviewedSpell(
      spell,
      await approve('acquisition_spell_registration', spell.spellVersionId, spell),
      scope
    );
    expect(
      (await repository.loadCurrentExact(spell.spellVersionId, scope)).content.entry.eventDate
    ).toBe(draft.event_date);
  }
  const exact = async (content: unknown) =>
    (
      await pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [promoted.candidate.candidateId, JSON.stringify(content)]
      )
    ).rows[0]!.valid;
  expect(await exact(promoted.proposal.content)).toBe(true);
  expect(await exact({ ...promoted.proposal.content, proposedAt: undefined })).toBe(false);
  for (const mutate of [
    (sessions: Array<Record<string, unknown>>) => {
      sessions[1]!.eventDate = '2024-11-22';
    },
    (sessions: Array<Record<string, unknown>>) => {
      sessions[1]!.selectionIds = sessions[0]!.selectionIds;
    },
    (sessions: Array<Record<string, unknown>>) => {
      sessions[1]!.evidenceIds = sessions[0]!.evidenceIds;
    },
    (sessions: Array<Record<string, unknown>>) => {
      sessions.pop();
    },
  ]) {
    const forged = JSON.parse(JSON.stringify(promoted.proposal.content));
    mutate(forged.draftEventCoverage);
    expect(await exact(forged)).toBe(false);
  }
  // A newly reviewed reconciliation appends versions without changing either session root.
  const sql = createPgAflOutcomeSqlClient(pool);
  const correctedCandidate = createAflTradeExternalReconciliationCandidate({
    ...promoted.candidate.content,
    reconciledAt: await at(),
  });
  await new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
    candidate: correctedCandidate,
    identityResolutions: promoted.identityResolutions,
  });
  const correctedProposal = createAflTradeExternalCanonicalPromotionProposal({
    ...promoted.proposal.content,
    candidateId: correctedCandidate.candidateId,
    candidateSha256: correctedCandidate.candidateId.split(':')[1]!,
    proposedAt: await at(),
  });
  const authority = (
    await pool.query<{ authority_evidence_id: string; decided_by: string }>(
      `SELECT authority_evidence_id,decided_by FROM outcome_external_canonical_promotion_review_decision
     JOIN outcome_review_decision USING(decision_id) WHERE decision_id=$1`,
      [promoted.approvalDecisionId]
    )
  ).rows[0]!;
  const correctionDecision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId: correctedCandidate.candidateId,
    proposalId: correctedProposal.proposalId,
    proposalSha256: correctedProposal.proposalId.split(':')[1]!,
    proposal: correctedProposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    rationale: 'Synthetic reviewed reconciliation revision retains exact sessions',
    authorityEvidenceId: authority.authority_evidence_id,
    decidedBy: authority.decided_by,
    decidedAt: await at(),
  });
  await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql).persistDecision({
    candidate: correctedCandidate,
    proposal: correctedProposal,
    decision: correctionDecision,
  });
  const promotions = new PostgresAflTradeExternalCanonicalPromotionRepository(sql);
  // Fault injection changes SQL-bound values after public review. Real database guards must
  // reject the materialized drift and roll back every row before a clean retry can succeed.
  for (const fault of ['event_date', 'selection_number'] as const) {
    let injected = false;
    const faultySql: AflOutcomeSqlClient = {
      query: sql.query.bind(sql),
      transaction: (work) =>
        sql.transaction((transaction) =>
          work({
            async query(statement, parameters) {
              const changed = [...(parameters ?? [])];
              if (
                fault === 'event_date' &&
                statement.includes('INSERT INTO outcome_event_version') &&
                changed[3] === 'national_draft'
              ) {
                changed[5] = '2024-11-22';
                injected = true;
              }
              if (
                fault === 'selection_number' &&
                statement.includes('INSERT INTO outcome_draft_selection')
              ) {
                changed[2] = Number(changed[2]) + 100;
                injected = true;
              }
              return transaction.query(statement, changed);
            },
          })
        ),
    };
    await expect(
      new PostgresAflTradeExternalCanonicalPromotionRepository(faultySql).promote({
        candidateId: correctedCandidate.candidateId,
        approvalDecisionId: correctionDecision.decisionId,
      })
    ).rejects.toThrow(/Draft session/);
    expect(injected).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM outcome_external_canonical_promotion WHERE candidate_id=$1',
          [correctedCandidate.candidateId]
        )
      ).rows[0]!.count
    ).toBe(0);
    for (const original of promoted.draftAssets) {
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM outcome_event_version WHERE event_id=$1',
            [original.event_id]
          )
        ).rows[0]!.count
      ).toBe(1);
    }
  }
  const correctionReceipt = await promotions.promote({
    candidateId: correctedCandidate.candidateId,
    approvalDecisionId: correctionDecision.decisionId,
  });
  expect(correctionReceipt.idempotentReplay).toBe(false);
  for (const original of promoted.draftAssets) {
    const versions = (
      await pool.query<{
        event_version_id: string;
        version: number;
        supersedes_version_id: string | null;
      }>(
        'SELECT event_version_id,version,supersedes_version_id FROM outcome_event_version WHERE event_id=$1 ORDER BY version',
        [original.event_id]
      )
    ).rows;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.event_version_id).toBe(original.event_version_id);
    expect(versions[1]!.version).toBe(2);
    expect(versions[1]!.supersedes_version_id).toBe(original.event_version_id);
  }
  expect(
    (
      await promotions.promote({
        candidateId: correctedCandidate.candidateId,
        approvalDecisionId: correctionDecision.decisionId,
      })
    ).idempotentReplay
  ).toBe(true);
  expect(
    (
      await promotions.promote({
        candidateId: promoted.candidate.candidateId,
        approvalDecisionId: promoted.approvalDecisionId,
      })
    ).idempotentReplay
  ).toBe(true);
});

it.each(['direct', 'combined', 'mixed'] as const)(
  'promotes v5 session proof with year-only trades through review, finalization and replay (combined=%s)',
  async (profile) => {
    const combined = profile !== 'direct';
    const scopedName = `${schema}_v5_${profile}`;
    await admin.query(`CREATE SCHEMA "${scopedName}"`);
    const scopedUrl = new URL(url!);
    scopedUrl.searchParams.set('schema', scopedName);
    const isolated = new Pool({ connectionString: url, options: `-c search_path=${scopedName}` });
    try {
      runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedUrl.toString() });
      const promoted = await createSyntheticAcquisitionPlayerPromotion(isolated, {
        draftSessions: !combined,
        combinedDraftSessions: combined,
        sessionProposalV5: true,
        mixedDraftSessionProofs: profile === 'mixed',
        partialTransactionDates: true,
      });
      expect(promoted.proposal.content.schemaVersion).toBe(
        'afl-trade-external-canonical-promotion-proposal/v5'
      );
      expect(promoted.draftAssets).toHaveLength(profile === 'mixed' ? 3 : 2);
      if (profile === 'mixed')
        expect(
          new Set(
            promoted.proposal.content.draftEventCoverage.map((coverage) =>
              'proofKind' in coverage ? coverage.proofKind : null
            )
          )
        ).toEqual(new Set(['direct_session_claim', 'combined_session_facts']));
      expect(
        promoted.proposal.content.transactionDateCoverage.every((date) => date.occurredOn === null)
      ).toBe(true);
      const trade = await isolated.query(
        `SELECT event.event_date,root.season_year FROM outcome_event_version event JOIN outcome_event root USING(event_id) WHERE event.event_version_id=$1`,
        [promoted.entry.eventVersionId]
      );
      expect(trade.rows).toEqual([{ event_date: null, season_year: 2024 }]);
      expect(() => promoted.entry.eventDate).toThrow('no exact-day');

      const replay = await new PostgresAflTradeExternalCanonicalPromotionRepository(
        createPgAflOutcomeSqlClient(isolated)
      ).promote({
        candidateId: promoted.candidate.candidateId,
        approvalDecisionId: promoted.approvalDecisionId,
      });
      expect(replay.promotionId).toBe(promoted.entry.promotionId);
      expect(
        (
          await isolated.query(
            'SELECT status FROM outcome_external_canonical_promotion WHERE promotion_id=$1',
            [replay.promotionId]
          )
        ).rows[0].status
      ).toBe('finalized');
      await verifySessionAcquisitionCurrentness(isolated, promoted);
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${scopedName}" CASCADE`);
    }
  },
  120_000
);
