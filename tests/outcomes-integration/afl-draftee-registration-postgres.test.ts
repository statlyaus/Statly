import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { draftguruDrafteePlayerId } from '@/server/aflTradeIntelligence/development/drafteeRegistrationPlan';
import {
  registerDraftees,
  type RegisterDrafteesOptions,
} from '@/server/aflTradeIntelligence/development/drafteeRegistrationRun';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `draftee_registration_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
const WRITER = 'afl_trade_nonproduction_governance_registry_writer';
const dbNow = async () =>
  (
    await pool.query<{ at: string }>(
      `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
const count = async (query: string) => (await pool.query(query)).rows[0].n as number;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${WRITER}') THEN CREATE ROLE ${WRITER} NOLOGIN; END IF; END $$`
  );
  await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${WRITER}`);
  await admin.query(
    `GRANT SELECT ON "${schema}".outcome_review_decision,"${schema}".outcome_governed_evidence_reference TO ${WRITER}`
  );
}, 120000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('holds a same-name draftee, refuses an expired reviewer and an unobserved draftee, then creates, links and skips on rerun', async () => {
  const fixture = await createRetainedExternalCaptureFixture(sql, false, 'non_production');
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'non_production',
    competition: 'AFLM',
    plannedAt: await dbNow(),
    scopeEvidence: fixture.scopeEvidence,
    targets: [fixture.target],
  });
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, {
    read: async (ref) => {
      const result =
        (await fixture.raw.loadExact(ref, 2097152)) ??
        (await fixture.metadata.loadExact(ref, 2097152));
      if (!result) throw new Error('Fixture bytes missing');
      return result.bytes;
    },
  });
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  const source = await new PostgresAflTradeExternalHistoricalReconciliationSource(sql).load(
    completion.completionId
  );
  const subject = buildAflTradeExternalIdentityReviewPackage({
    environment: source.environment,
    competition: source.competition,
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  }).content.items.find((i) => i.workItem.content.subject.content.entityKind === 'player')!;
  const scope = subject.workItem.content.subject.content.identityScope;
  if (scope.kind !== 'provider_native_id') throw new Error('Expected a native Draftguru subject');
  const at = await dbNow();

  // Reviewer grants: a current Draftguru grant and one that expired in 2020.
  async function grant(principalRef: string, validFrom: string, validThrough: string | null) {
    const document = {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'non_production',
      principalRef,
      role: 'afl_trade_external_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: 'draftguru',
      capabilityId: 'external_identity_resolution',
      competition: 'AFLM',
      validFromSeason: 2024,
      validThroughSeason: 2024,
    };
    const ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    const referenceId = address('reviewer-authority-evidence', document);
    await fixture.metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
    const readback = await verifyAflTradeArtifactReadback(fixture.metadata, ref, at, 2097152);
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
         VALUES($1,$2,$3,$4,$5,'capture_metadata','non_production',$6,$7,$8::jsonb)`,
        [
          ref.artifactId,
          ref.contentSha256,
          ref.storageUri,
          ref.mediaType,
          ref.byteLength,
          ref.createdAt,
          readback.content.verifiedAt,
          canonical(readback),
        ]
      );
      const approvalId = address('governed-evidence-approval-decision', { referenceId });
      await tx.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic grant review',$3::jsonb,$4,$5)`,
        [approvalId, referenceId, canonical({ referenceSha256: sha(document) }), principalRef, at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference
          (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json)
         VALUES($1,$2,'reviewer_authority_evidence',$3,'non_production','approved',$4,$5,$6::text,($6::text)::jsonb)`,
        [referenceId, sha(document), ref.artifactId, approvalId, at, canonical(document)]
      );
      await tx.query(`SET LOCAL ROLE ${WRITER}`);
      await tx.query('SET CONSTRAINTS outcome_governed_evidence_requires_registry_role IMMEDIATE');
      await tx.query('RESET ROLE');
    });
    await pool.query(
      `INSERT INTO outcome_operational_principal_authority
        (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES($1,$2,'afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes','draftguru','external_identity_resolution','AFLM',2024,2024,$3,$4)`,
      [referenceId, principalRef, validFrom, validThrough]
    );
  }
  await grant('synthetic-reviewer', at, null);
  await grant('expired-reviewer', '2020-01-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z');

  // The snapshot store, and the stored owner approval cited as supporting evidence, located in it.
  const storeId = 'draftee-test-store';
  await registerLocalAflTradeArtifactStore(sql, {
    storeId,
    rootDirectory: await mkdtemp(join(tmpdir(), 'statly-draftee-store-')),
  });
  const approval = fixture.scopeEvidence[0]!;
  await pool.query(
    `INSERT INTO outcome_artifact_custody_location(artifact_id,store_id,object_key) VALUES($1,$2,$3)`,
    [
      approval.artifactId,
      storeId,
      `approvals/sha256/${approval.contentSha256.slice(0, 2)}/${approval.contentSha256.slice(2, 4)}/${approval.contentSha256}`,
    ]
  );
  // The same person already minted from another source, under the same normalised name.
  const displayName = subject.workItem.content.observedNames[0]!;
  await pool.query(
    `INSERT INTO outcome_player(player_id,display_name,birth_date,status)
     VALUES('player:afl-tables-same',$1,'2001-02-03','approved')`,
    [` ${displayName.toUpperCase()}.`]
  );

  const directory = await mkdtemp(join(tmpdir(), 'statly-draftee-plan-'));
  const draftee = {
    draftguruNativeId: scope.nativeId,
    displayName,
    draftingClub: 'Synthetic Club',
    season: 2024,
    pick: 1,
  };
  async function run(
    lines: object[],
    principalRef: string,
    apply: boolean
  ): Promise<{ outcome: Awaited<ReturnType<typeof registerDraftees>>; output: string[] }> {
    const planPath = join(directory, `plan-${Date.now()}-${Math.random()}.jsonl`);
    await writeFile(planPath, lines.map((line) => JSON.stringify(line)).join('\n'));
    const options: RegisterDrafteesOptions = {
      completionId: completion.completionId,
      planPath,
      approvalArtifactId: approval.artifactId,
      principalRef,
      storeId,
      apply,
    };
    const output: string[] = [];
    const outcome = await registerDraftees({ client: sql, options, write: (l) => output.push(l) });
    return { outcome, output };
  }
  const playerId = draftguruDrafteePlayerId(scope.nativeId);
  const creations = () =>
    count(
      "SELECT count(*)::int n FROM outcome_review_decision WHERE subject_type='canonical_target_creation'"
    );

  const dry = await run(
    [draftee, { ...draftee, draftguruNativeId: 'not-in-completion' }],
    'synthetic-reviewer',
    false
  );
  expect(dry.outcome.status).toBe('refused');
  expect(dry.outcome.draftees).toMatchObject([
    { playerId, status: 'hold', unreviewedSameNamePlayerIds: ['player:afl-tables-same'] },
    { status: 'refused', reasons: ['no_draftguru_subject'] },
  ]);
  expect(JSON.parse(dry.output.at(-1)!)).toMatchObject({ mode: 'dry_run', holds: 1, refused: 1 });

  const reviewed = { ...draftee, distinctFromPlayerIds: ['player:afl-tables-same'] };
  const expired = await run([reviewed], 'expired-reviewer', true);
  expect(expired.outcome.draftees).toMatchObject([
    { status: 'refused', reasons: ['no_current_reviewer_grant:draftguru'] },
  ]);
  expect(await creations()).toBe(0);

  const applied = await run([reviewed], 'synthetic-reviewer', true);
  expect(applied.outcome.status).toBe('applied');
  expect(applied.outcome.draftees).toMatchObject([
    { playerId, status: 'created', links: [{ provider: 'draftguru', action: 'linked' }] },
  ]);
  expect(
    (
      await pool.query('SELECT display_name,birth_date FROM outcome_player WHERE player_id=$1', [
        playerId,
      ])
    ).rows
  ).toEqual([{ display_name: displayName, birth_date: null }]);
  const head = await new PostgresAflTradeExternalIdentityReviewRepository(sql).loadCurrentDecision(
    subject.subjectId
  );
  expect(head?.content).toMatchObject({
    decision: 'approved',
    revision: 1,
    canonicalTarget: { canonicalId: playerId },
  });
  // The snapshot bytes are in the store, located, and governed.
  expect(
    await count(`SELECT count(*)::int n FROM outcome_governed_evidence_reference e
      JOIN outcome_artifact_custody_location l ON l.artifact_id=e.artifact_id
      WHERE e.evidence_kind='canonical_target_snapshot' AND l.store_id='${storeId}'`)
  ).toBe(1);

  const rerun = await run([reviewed], 'synthetic-reviewer', true);
  expect(rerun.outcome.status).toBe('applied');
  expect(rerun.outcome.draftees).toMatchObject([
    { status: 'already_registered', links: [{ provider: 'draftguru', action: 'already_linked' }] },
  ]);
  expect(await creations()).toBe(1);
  expect(await count('SELECT count(*)::int n FROM outcome_external_identity_review_decision')).toBe(
    1
  );
});
