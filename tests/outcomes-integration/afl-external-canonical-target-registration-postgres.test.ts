import { createAflTradeExternalIdentityReviewWorkItem } from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  aflTradeExternalCanonicalTargetSnapshotSchema,
  aflTradeExternalCanonicalTargetRegistrationSchema,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `external_target_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN; END IF; END $$`
  );
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schema}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT ON "${schema}".outcome_review_decision,"${schema}".outcome_governed_evidence_reference TO afl_trade_nonproduction_governance_registry_writer`
  );
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('registers an explicitly reviewed absent native person, then replays and reuses the canonical target', async () => {
  const fixture = await createRetainedExternalCaptureFixture(sql, false, 'non_production');
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'non_production',
    competition: 'AFLM',
    plannedAt: new Date().toISOString(),
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
  const work = buildAflTradeExternalIdentityReviewPackage({
    environment: source.environment,
    competition: source.competition,
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  });
  const player = work.content.items.find(
    (i) => i.workItem.content.subject.content.entityKind === 'player'
  )!.workItem;
  const at = new Date().toISOString();
  async function govern(document: Record<string, unknown>, prefix: string) {
    const ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    const referenceId = address(prefix, document);
    const digest = sha(document);
    await fixture.metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
    const readback = await verifyAflTradeArtifactReadback(
      fixture.metadata,
      ref,
      new Date().toISOString(),
      2097152
    );
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
    VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic evidence review',$3::jsonb,'synthetic-reviewer',$4)`,
        [approvalId, referenceId, canonical({ referenceSha256: digest }), at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference
    (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json)
    VALUES($1,$2,$3,$4,'non_production','approved',$5,$6,$7::text,($7::text)::jsonb)`,
        [
          referenceId,
          digest,
          document.evidenceKind,
          ref.artifactId,
          approvalId,
          at,
          canonical(document),
        ]
      );
      await tx.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
      await tx.query('SET CONSTRAINTS outcome_governed_evidence_requires_registry_role IMMEDIATE');
      await tx.query('RESET ROLE');
      await tx.query('SET CONSTRAINTS outcome_governed_evidence_requires_registry_role DEFERRED');
    });
    return { id: referenceId, sha256: digest };
  }
  const authority = await govern(
    {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'non_production',
      principalRef: 'synthetic-reviewer',
      role: 'afl_trade_external_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: 'draftguru',
      capabilityId: 'external_identity_resolution',
      competition: 'AFLM',
      validFromSeason: 2024,
      validThroughSeason: 2024,
    },
    'reviewer-authority-evidence'
  );
  await pool.query(
    `INSERT INTO outcome_operational_principal_authority
  (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through)
  VALUES($1,'synthetic-reviewer','afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes','draftguru','external_identity_resolution','AFLM',2024,2024,$2,NULL)`,
    [authority.id, at]
  );
  const snapshot = {
    evidenceKind: 'canonical_target_snapshot',
    schemaVersion: 'afl-trade-canonical-target-snapshot/v2',
    environment: 'non_production',
    source: { historicalCompletionId: completion.completionId, workItem: player },
    record: {
      entityKind: 'player',
      canonicalId: 'player:synthetic-new',
      displayName: 'Synthetic Player',
      birthDate: null,
    },
  };
  const snapshotRef = await govern(snapshot, 'canonical-target-snapshot');
  async function retain(
    action: 'create' | 'reuse',
    inputSnapshot: unknown = snapshot,
    selectedAuthority = authority
  ) {
    const selected = aflTradeExternalCanonicalTargetSnapshotSchema.parse(inputSnapshot);
    const selectedRef =
      canonical(selected) === canonical(snapshot)
        ? snapshotRef
        : await govern(selected, 'canonical-target-snapshot');
    const content = {
      schemaVersion: 'afl-trade-canonical-target-registration/v2',
      authorityBoundary: 'reviewed_canonical_creation_no_provider_assignment',
      action,
      targetSnapshot: selected,
      targetSnapshotReferenceId: selectedRef.id,
      reviewerAuthority: {
        principalRef: 'synthetic-reviewer',
        authorityEvidence: selectedAuthority,
      },
      supportingEvidence: fixture.scopeEvidence,
      rationale: 'Synthetic source native ID reviewed; no existing matching person.',
      decidedAt: new Date().toISOString(),
    };
    const registration = aflTradeExternalCanonicalTargetRegistrationSchema.parse({
      registrationDecisionId: address('canonical-target-registration', content),
      content,
    });
    await pool.query(
      `INSERT INTO outcome_review_decision
   (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,rationale,evidence_json,decided_by,decided_at)
   VALUES($1,'canonical_target_creation',$2,'approved',$6,$7,$3,$4::jsonb,'synthetic-reviewer',$5)`,
      [
        registration.registrationDecisionId,
        selectedRef.id,
        content.rationale,
        canonical(registration),
        content.decidedAt,
        selected.record.entityKind,
        selected.record.canonicalId,
      ]
    );
    return {
      registrationDecisionId: registration.registrationDecisionId,
      targetSnapshotReferenceId: selectedRef.id,
    };
  }
  const owner = new PostgresAflTradeProviderResolutionRepository(sql);
  const execution = { principalRef: 'synthetic-reviewer', environment: 'non_production' as const };
  const create = await retain('create');
  await expect(owner.registerCanonicalTarget(create, execution)).resolves.toEqual({
    entityKind: 'player',
    canonicalId: 'player:synthetic-new',
    idempotentReplay: false,
  });
  await expect(owner.registerCanonicalTarget(create, execution)).resolves.toEqual({
    entityKind: 'player',
    canonicalId: 'player:synthetic-new',
    idempotentReplay: true,
  });
  await expect(
    owner.registerCanonicalTarget(await retain('reuse'), execution)
  ).resolves.toMatchObject({ canonicalId: 'player:synthetic-new', idempotentReplay: true });
  await expect(
    owner.registerCanonicalTarget(create, { ...execution, principalRef: 'another-reviewer' })
  ).rejects.toThrow();
  const wrongSeasonAuthority = await govern(
    {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'non_production',
      principalRef: 'synthetic-reviewer',
      role: 'afl_trade_external_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: 'draftguru',
      capabilityId: 'external_identity_resolution',
      competition: 'AFLM',
      validFromSeason: 2023,
      validThroughSeason: 2023,
    },
    'reviewer-authority-evidence'
  );
  await pool.query(
    `INSERT INTO outcome_operational_principal_authority
    (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through)
    VALUES($1,'synthetic-reviewer','afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes','draftguru','external_identity_resolution','AFLM',2023,2023,$2,NULL)`,
    [wrongSeasonAuthority.id, at]
  );
  const wrongScope = await retain('reuse', snapshot, wrongSeasonAuthority);
  await expect(owner.registerCanonicalTarget(wrongScope, execution)).rejects.toThrow(
    'source scope'
  );
  await expect(
    pool.query('SELECT * FROM register_outcome_reviewed_canonical_target($1,$2,$3,$4)', [
      wrongScope.registrationDecisionId,
      wrongScope.targetSnapshotReferenceId,
      execution.principalRef,
      execution.environment,
    ])
  ).rejects.toThrow('source scope');
  const substitutedWork = createAflTradeExternalIdentityReviewWorkItem({
    subject: player.content.subject,
    observations: player.content.observations.map((observation) => ({
      ...observation,
      evidenceId: address('external-evidence', { fabricated: observation.evidenceId }),
    })),
  });
  const substituted = await retain('reuse', {
    ...snapshot,
    source: { ...snapshot.source, workItem: substitutedWork },
  });
  await expect(owner.registerCanonicalTarget(substituted, execution)).rejects.toThrow(
    'complete exact'
  );
  await expect(
    pool.query('SELECT * FROM register_outcome_reviewed_canonical_target($1,$2,$3,$4)', [
      substituted.registrationDecisionId,
      substituted.targetSnapshotReferenceId,
      execution.principalRef,
      execution.environment,
    ])
  ).rejects.toThrow();
  const club = work.content.items.find(
    (i) => i.workItem.content.subject.content.entityKind === 'club'
  )!.workItem;
  const absentClub = await retain('reuse', {
    ...snapshot,
    source: { ...snapshot.source, workItem: club },
    record: {
      entityKind: 'club',
      canonicalId: 'club:absent',
      currentName: 'Synthetic Club',
      abbreviation: null,
      activeFromYear: null,
      activeThroughYear: null,
    },
  });
  await expect(owner.registerCanonicalTarget(absentClub, execution)).rejects.toThrow();
  expect(
    (await pool.query("SELECT count(*)::int n FROM outcome_club WHERE club_id='club:absent'"))
      .rows[0].n
  ).toBe(0);
  const conflict = await retain('create', {
    ...snapshot,
    record: { ...snapshot.record, canonicalId: 'player:duplicate' },
  });
  await expect(owner.registerCanonicalTarget(conflict, execution)).rejects.toThrow();
  await expect(
    pool.query('SELECT * FROM register_outcome_reviewed_canonical_target($1,$2,$3,$4)', [
      conflict.registrationDecisionId,
      conflict.targetSnapshotReferenceId,
      execution.principalRef,
      execution.environment,
    ])
  ).rejects.toThrow();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM outcome_player WHERE player_id='player:duplicate'"
      )
    ).rows[0].n
  ).toBe(0);
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
    VALUES($1,'canonical_target_creation',$2,'withdrawn','Withdraw deliberately conflicting synthetic review','{}'::jsonb,'synthetic-reviewer',clock_timestamp(),$3)`,
    [
      address('review-decision', { withdraw: conflict.registrationDecisionId }),
      conflict.targetSnapshotReferenceId,
      conflict.registrationDecisionId,
    ]
  );
  await expect(owner.registerCanonicalTarget(create, execution)).resolves.toMatchObject({
    idempotentReplay: true,
  });
  // A canonical-target waiter must not retain Gate and obstruct a queued withdrawal.
  const blocker = await pool.connect();
  const gateProbe = await pool.connect();
  let pendingRegistration: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'outcome-canonical-target:player:player:synthetic-new',
    ]);
    pendingRegistration = owner.registerCanonicalTarget(create, execution);
    // Consume rejection immediately while retaining it for the assertion below.
    void pendingRegistration.catch(() => undefined);
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (
        await pool.query<{ waiting: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
          [blockerPid]
        )
      ).rows[0].waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await gateProbe.query('BEGIN');
    await expect(
      gateProbe.query(
        'SELECT singleton_id FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR UPDATE NOWAIT'
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await gateProbe.query('ROLLBACK');
    await blocker.query('ROLLBACK');
    await expect(pendingRegistration).resolves.toMatchObject({ idempotentReplay: true });
  } finally {
    await gateProbe.query('ROLLBACK');
    await blocker.query('ROLLBACK');
    await pendingRegistration?.catch(() => undefined);
    gateProbe.release();
    blocker.release();
  }
  const withdrawnAt = new Date().toISOString();
  const proposalContent = {
    ...fixture.proposal.content,
    version: 2,
    proposedAt: withdrawnAt,
    proposal: 'Withdraw synthetic source use',
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: address('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    ...fixture.decision.content,
    proposalId: proposal.proposalId,
    version: 2,
    state: 'withdrawn',
    decidedAt: withdrawnAt,
    effectiveAt: withdrawnAt,
    revalidateAt: null,
    supersedesDecisionId: fixture.decision.decisionId,
    withdrawalActions: ['Stop synthetic source use'],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: address('gate-decision', decisionContent),
    content: decisionContent,
  });
  await fixture.ledger.append({
    expectedRevision: (await fixture.ledger.load()).revision,
    sourceRights: fixture.rights,
    proposal,
    decision,
  });
  await expect(owner.registerCanonicalTarget(create, execution)).rejects.toThrow();
  await expect(
    pool.query('SELECT * FROM register_outcome_reviewed_canonical_target($1,$2,$3,$4)', [
      create.registrationDecisionId,
      create.targetSnapshotReferenceId,
      execution.principalRef,
      execution.environment,
    ])
  ).rejects.toThrow();
  await expect(
    new PostgresAflTradeExternalIdentityReviewRepository(sql).loadCanonicalTargetSnapshot({
      entityKind: 'player',
      canonicalId: 'player:synthetic-new',
    })
  ).resolves.toMatchObject({ recordedLabel: 'Synthetic Player', status: 'approved' });
  expect(
    (await pool.query('SELECT count(*)::int n FROM outcome_provider_normalization_run')).rows[0].n
  ).toBe(0);
  expect(
    (await pool.query('SELECT count(*)::int n FROM outcome_external_identity_review_decision'))
      .rows[0].n
  ).toBe(0);
});
