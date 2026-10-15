import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0283 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
 * "Repairing promoted draftees"): a combined-session proof joins each session boundary claim to the
 * candidate selection at that number through the candidate's identity resolutions. A later reviewed
 * re-target of a boundary draftee used to void the proof for the whole draft, and with it every
 * arrival on that promotion (the 2018 nights after Will Hayes's re-target). Now a chain of approved
 * same-subject revisions keeps it; a withdrawal or rejection still voids it.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0283_boundary_identity_reviewed_successors';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  /** Applies 0283 and every later migration. */
  migrate: () => Promise<void>;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/** One disposable schema per case at the history just before 0283; `migrate` applies the rest. */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_boundary_identity_${process.pid}_${Date.now()}_${ordinal++}`;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'prisma',
    'afl-trade-outcomes',
    'migrations'
  );
  const built: Workspace = {
    pool,
    migrate: async () => {
      await pool.query(history.migrationSql);
      const later = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name > MIGRATION)
        .map((entry) => entry.name)
        .sort();
      for (const name of later)
        await pool.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    },
    dispose: async () => {
      await history.cleanup();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
  };
  workspaces.push(built);
  return built;
}

afterAll(async () => {
  try {
    for (const built of workspaces) await built.dispose();
  } finally {
    await admin.end();
  }
});

/**
 * A combined-session promotion of the 2024 national draft (v3 proposal): selection 1 opens session 1,
 * selection 2 opens and closes session 2, so both draftees are boundary draftees.
 */
async function promoted(ws: Workspace) {
  const promotion = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    combinedDraftSessions: true,
  });
  expect(promotion.proposal.content.schemaVersion).toBe(
    'afl-trade-external-canonical-promotion-proposal/v3'
  );
  const bySelection = (number: number) => {
    const selection = promotion.candidate.content.draftSelections.find(
      ({ draftType, selectionNumber }) => draftType === 'national' && selectionNumber === number
    )!;
    const entry = promotion.draftEntries.find(({ player_id }) => player_id === selection.playerId)!;
    return { selection, entry };
  };
  const identities = new PostgresAflTradeExternalIdentityReviewRepository(
    createPgAflOutcomeSqlClient(ws.pool)
  );
  const { reviewPackage, decision: base } = promotion.identityReview;
  /** Records the next revision of the Draftguru subject that resolved `playerId`. */
  const revise = async (
    playerId: string,
    next:
      | { decision: 'approved'; target: { playerId: string; playerName: string } }
      | {
          decision: 'withdrawn';
        }
  ) => {
    const resolution = promotion.identityResolutions.find(
      ({ content }) =>
        content.provider === 'draftguru' &&
        content.entityKind === 'player' &&
        content.canonicalId === playerId
    )!;
    const item = reviewPackage.content.items.find(
      ({ workItem }) =>
        workItem.content.subject.content.entityKind === 'player' &&
        workItem.content.subject.content.identityScope.kind === 'provider_native_id' &&
        workItem.content.subject.content.identityScope.nativeId ===
          resolution.content.sourceIdentity.nativeId
    )!.workItem;
    const head = (
      await ws.pool.query<{ decision_id: string; revision: number }>(
        'SELECT decision_id,revision FROM outcome_external_identity_resolution_head WHERE subject_id=$1',
        [item.content.subject.subjectId]
      )
    ).rows[0]!;
    if (next.decision === 'approved')
      await ws.pool.query(
        `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')
         ON CONFLICT (player_id) DO NOTHING`,
        [next.target.playerId, next.target.playerName]
      );
    const decision = createAflTradeExternalIdentityReviewDecision({
      ...base.content,
      revision: Number(head.revision) + 1,
      supersedesDecisionId: head.decision_id,
      subject: item.content.subject,
      workItemId: item.workItemId,
      workItemSha256: item.workItemId.split(':')[1]!,
      workItem: item,
      decision: next.decision,
      canonicalTarget:
        next.decision === 'approved'
          ? createAflTradeExternalCanonicalIdentityTargetSnapshot({
              entityKind: 'player',
              canonicalId: next.target.playerId,
              recordedLabel: next.target.playerName,
            })
          : null,
      rationale: 'Synthetic identity repair of a boundary draftee',
      decidedAt: (
        await ws.pool.query<{ at: Date }>(
          "SELECT date_trunc('milliseconds',clock_timestamp()) AS at"
        )
      ).rows[0]!.at.toISOString(),
    });
    await identities.persistDecision({ reviewPackage, decision });
    return decision.decisionId;
  };
  const sessionsExact = async () =>
    (
      await ws.pool.query<{ valid: boolean }>(
        'SELECT outcome_external_draft_sessions_exact($1,$2::jsonb) AS valid',
        [promotion.candidate.candidateId, JSON.stringify(promotion.proposal.content)]
      )
    ).rows[0]!.valid;
  const arrivalCurrent = async (number: number) => {
    const { entry } = bySelection(number);
    return (
      await ws.pool.query<{ current: boolean }>(
        `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,
                  clock_timestamp(),clock_timestamp()) AS current`,
        [JSON.stringify(entry.entry), entry.player_id, promotion.clubId]
      )
    ).rows[0]!.current;
  };
  return { promotion, bySelection, revise, sessionsExact, arrivalCurrent };
}

/** Runs one statement with the row guards off, as a reviewer's in-place correction would not. */
async function replica(ws: Workspace, query: string, parameters: unknown[]) {
  const client = await ws.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query(query, parameters);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const TWIN = { playerId: 'afl-tables-twin', playerName: 'Synthetic Boundary Draftee (AFL Tables)' };

describe('a reviewed re-target of a session boundary draftee (migration 0283)', () => {
  it('keeps the session proof and the other draftees arrivals; a withdrawal still voids them', async () => {
    const ws = await workspace();
    const subject = await promoted(ws);
    const last = subject.bySelection(2).selection;
    expect(await subject.sessionsExact()).toBe(true);
    expect(await subject.arrivalCurrent(1)).toBe(true);

    // Before 0283: re-targeting the closing draftee of session 2 voids the whole draft's proof, so
    // selection 1's arrival, whose player never changed, stops being current (the 2018 case).
    await subject.revise(last.playerId!, { decision: 'approved', target: TWIN });
    expect(await subject.sessionsExact()).toBe(false);
    expect(await subject.arrivalCurrent(1)).toBe(false);

    // With 0283 the reviewed re-target keeps the proof: which selections bound each session is
    // unchanged. The re-targeted draftee's own old arrival stays refused by the 0254 chain.
    await ws.migrate();
    expect(await subject.sessionsExact()).toBe(true);
    expect(await subject.arrivalCurrent(1)).toBe(true);
    expect(await subject.arrivalCurrent(2)).toBe(false);

    // Withdrawing the repaired review removes the identity the join relied on.
    await subject.revise(last.playerId!, { decision: 'withdrawn' });
    expect(await subject.sessionsExact()).toBe(false);
    expect(await subject.arrivalCurrent(1)).toBe(false);
  }, 600_000);

  it('still fails an unapproved boundary decision and every other exit as before', async () => {
    const ws = await workspace();
    await ws.migrate();
    const subject = await promoted(ws);
    const first = subject.bySelection(1).selection;
    const firstDecision = subject.promotion.identityResolutions.find(
      ({ content }) =>
        content.provider === 'official_afl' &&
        content.entityKind === 'player' &&
        content.canonicalId === first.playerId
    )!.content.reviewDecisionId;
    expect(await subject.sessionsExact()).toBe(true);

    // A boundary decision that is no longer approved voids the proof.
    await replica(ws, 'UPDATE outcome_review_decision SET decision=$2 WHERE decision_id=$1', [
      firstDecision,
      'rejected',
    ]);
    expect(await subject.sessionsExact()).toBe(false);
    expect(await subject.arrivalCurrent(2)).toBe(false);
    await replica(ws, 'UPDATE outcome_review_decision SET decision=$2 WHERE decision_id=$1', [
      firstDecision,
      'approved',
    ]);
    expect(await subject.sessionsExact()).toBe(true);

    // A successor that is not a typed identity revision (a bare generic decision) voids it too.
    const bare = `review-decision:${'b'.repeat(64)}`;
    await replica(
      ws,
      `INSERT INTO outcome_review_decision
         (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,
          supersedes_decision_id)
       SELECT $2,subject_type,subject_id,'approved','Untyped successor','{}'::jsonb,decided_by,
              clock_timestamp(),decision_id
         FROM outcome_review_decision WHERE decision_id=$1`,
      [firstDecision, bare]
    );
    expect(await subject.sessionsExact()).toBe(false);
    await replica(ws, 'DELETE FROM outcome_review_decision WHERE decision_id=$1', [bare]);
    expect(await subject.sessionsExact()).toBe(true);

    // Another exit: a revoked boundary capture still voids the proof.
    const boundaryCapture = (
      await ws.pool.query<{ capture_id: string }>(
        `SELECT DISTINCT batch.capture_id
           FROM outcome_external_reconciliation_source_batch source
           JOIN outcome_external_evidence_row row USING(batch_id)
           JOIN outcome_external_evidence_batch batch USING(batch_id)
          WHERE source.candidate_id=$1 AND row.claim_kind='draft_session_boundary'
          ORDER BY batch.capture_id LIMIT 1`,
        [subject.promotion.candidate.candidateId]
      )
    ).rows[0]!.capture_id;
    await replica(ws, 'UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
      boundaryCapture,
      'rejected',
    ]);
    expect(await subject.sessionsExact()).toBe(false);
    await replica(ws, 'UPDATE outcome_source_capture SET status=$2 WHERE capture_id=$1', [
      boundaryCapture,
      'approved',
    ]);
    expect(await subject.sessionsExact()).toBe(true);
  }, 600_000);
});
