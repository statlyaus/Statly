import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeFitzRoyFieldMapSha256 } from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository';
import type { AflTradeProviderMatchCandidate } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import {
  createAflTradeFitzRoyEgressExecutionReceipt,
  aflTradeFitzRoyEgressExecutionReceiptSchema,
} from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';
import { aflTradeFitzRoyCaptureDiagnosticsSchema } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import {
  createAflTradeProviderResolutionProposal,
  createAflTradeProviderResolutionDecision,
  createAflTradeReviewedFixtureFingerprint,
  aflTradeCanonicalTargetRegistrationSchema,
  aflTradeCanonicalTargetRecordSchema,
  aflTradeProviderResolutionDecisionSchema,
  type AflTradeProviderResolutionProposal,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
type AflTradeCanonicalTargetRecord = ReturnType<typeof aflTradeCanonicalTargetRecordSchema.parse>;
type ProposalSubject<Content = AflTradeProviderResolutionProposal['content']> =
  Content extends unknown
    ? Omit<
        Content,
        | 'schemaVersion'
        | 'staging'
        | 'method'
        | 'canonicalTargetSnapshot'
        | 'supportingEvidence'
        | 'proposedAt'
      >
    : never;

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `canonical_match_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sql = createPgAflOutcomeSqlClient(pool);
const repository = new PostgresAflTradeProviderResolutionRepository(sql);
const execution = {
  principalRef: 'synthetic-registration-reviewer',
  environment: 'non_production' as const,
};
const reviewedAt = '2026-08-13T00:00:00.000Z';
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
      CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
    END IF;
  END $$`);
  await pool.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await pool.query(
    `GRANT SELECT,INSERT ON outcome_artifact_custody,outcome_review_decision,outcome_governed_evidence_reference TO afl_trade_nonproduction_governance_registry_writer`
  );
}, 120_000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
});

// Synthetic upstream custody/review evidence only; no registration or resolution guard is replaced.
async function retainEvidence(kind: string, fields: Readonly<Record<string, unknown>>) {
  const payload = { evidenceKind: kind, environment: execution.environment, ...fields };
  const prefix = kind.replaceAll('_', '-');
  const id = createAflTradeContentAddress(prefix, payload);
  const sha256 = sha256AflTradeCanonicalJson(payload);
  const canonical = canonicalizeAflTradeJson(payload);
  const artifact = createAflTradeContentAddress('governed-evidence-artifact', { id });
  const approval = createAflTradeContentAddress('governed-evidence-approval-decision', { id });
  await sql.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_nonproduction_governance_registry_writer');
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
    VALUES($1,$2,$3,'application/json',$4,'derived_private',$5,$6,$6,'{}'::jsonb)`,
      [
        artifact,
        sha256,
        `artifact://sha256/${sha256}`,
        Buffer.byteLength(canonical),
        execution.environment,
        reviewedAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic registration fixture evidence',
    jsonb_build_object('referenceSha256',$3::text),$4,$5)`,
      [approval, id, sha256, execution.principalRef, reviewedAt]
    );
    await transaction.query(
      `INSERT INTO outcome_governed_evidence_reference
    (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json)
    VALUES($1,$2,$3,$4,$5,'approved',$6,$7,$8::text,$8::jsonb)`,
      [id, sha256, kind, artifact, execution.environment, approval, reviewedAt, canonical]
    );
  });
  return { id, sha256 };
}

async function stageDateOnlyFixture(client: AflOutcomeSqlClient) {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const fieldMap = {
    ...fixture.command.fieldMap,
    match: { ...fixture.command.fieldMap.match!, nativeMatchId: null },
  };
  const command = { ...fixture.command, fieldMap };
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2026) ON CONFLICT DO NOTHING`
  );
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',$3,
             jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      fieldMap.approvalDecisionId,
      fieldMap.mapId,
      'Source-independent local staging fixture field map.',
      fieldMapSha256,
      'local-staging-fixture-reviewer',
      fieldMap.approvedAt,
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_field_map
      (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
       field_map_sha256,approval_decision_id,approved_at,map_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (field_map_id) DO NOTHING`,
    [
      fieldMap.mapId,
      fieldMap.capabilityId,
      fieldMap.fitzRoyVersion,
      fieldMap.sourceSchemaSha256,
      fieldMapSha256,
      fieldMap.approvalDecisionId,
      fieldMap.approvedAt,
      canonicalizeAflTradeJson(fieldMap),
    ]
  );

  const normalizationTimes = [
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationStartedAt,
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
  ];
  return ingestAuthorizedAflTradeFitzRoyProviderSeason(command, {
    capture: {
      ...fixture.captureDependencies,
      executor: {
        ...fixture.captureDependencies.executor,
        async execute(invocation, limits) {
          const captured = await fixture.captureDependencies.executor.execute(invocation, limits);
          const diagnostics = {
            ...aflTradeFitzRoyCaptureDiagnosticsSchema.parse(captured.diagnostics),
            rowCount: 2,
          };
          const receipt = aflTradeFitzRoyEgressExecutionReceiptSchema.parse(
            captured.egressExecutionReceipt
          );
          return {
            ...captured,
            diagnostics,
            egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
              content: {
                ...receipt.content,
                diagnosticsOutput: {
                  contentSha256: sha256AflTradeCanonicalJson(diagnostics),
                  byteLength: Buffer.byteLength(canonicalizeAflTradeJson(diagnostics)),
                },
              },
              signature: receipt.signature,
            }),
          };
        },
      },
    },
    staging: {
      rawArtifactRepository: fixture.rawArtifactRepository,
      sourceCaptureRepository: new PostgresAflTradeSourceCaptureRepository(client),
      providerObservationRepository: new PostgresAflTradeProviderObservationRepository(client),
      decoderExecutor: {
        executionBoundary: 'offline_container_no_network',
        async decode(request) {
          const table = JSON.parse(
            new TextDecoder().decode(await fixture.decoderExecutor.decode(request))
          );
          table.rows[0][2] = { kind: 'text', value: '2026-03-20' };
          const secondRow = structuredClone(table.rows[0]);
          secondRow[1] = { kind: 'text', value: 'provider-match-2' };
          secondRow[2] = { kind: 'text', value: '2026-03-21' };
          table.rows.push(secondRow);
          table.frame.rowNames.push('2');
          return new TextEncoder().encode(canonicalizeAflTradeJson(table));
        },
      },
      clock: {
        now: () =>
          normalizationTimes.shift() ?? LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
      },
      dependencyLockSha256: LOCAL_FITZROY_REHEARSAL_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_FITZROY_REHEARSAL_RUNTIME.imageDigest,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumRows: 10,
      maximumFields: 20,
      maximumCells: 200,
      maximumCellBytes: 1_024,
      maximumOutputBytes: 65_536,
      egressExecutionVerifier: fixture.captureDependencies.egressExecutionVerifier,
    },
    clock: { now: () => LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt },
  });
}

it('registers synthetic club parents, then a date-only match and exactly replays its resolution', async () => {
  await stageDateOnlyFixture(sql);
  const result = await pool.query<{
    normalization_run_id: string;
    staging_sha256: string;
    finalized_at: Date;
    field_map_sha256: string;
    provider_decoded_row_id: string;
    source_row_sha256: string;
    row_status: string;
    match_candidate_id: string;
    candidate_json: AflTradeProviderMatchCandidate;
    provider: string;
    capability_id: string;
  }>(`SELECT run.normalization_run_id,run.staging_sha256,run.finalized_at,
    fm.field_map_sha256,r.provider_decoded_row_id,r.source_row_sha256,r.row_status,
    m.match_candidate_id,m.candidate_json,c.provider,c.capability_id
    FROM outcome_provider_normalization_run run JOIN outcome_provider_field_map fm USING(field_map_id)
    JOIN outcome_provider_decoded_row r USING(normalization_run_id)
    JOIN outcome_provider_match_candidate m USING(provider_decoded_row_id)
    JOIN outcome_source_capture c ON c.capture_id=run.capture_id ORDER BY r.source_row_number`);
  expect(result.rows).toHaveLength(2);
  const row = result.rows[0]!;
  const candidate = row.candidate_json;
  const ref = (prefix: string, value: unknown) => ({
    id: createAflTradeContentAddress(prefix, value),
    sha256: sha256AflTradeCanonicalJson(value),
  });
  const staging = {
    normalizationRunId: row.normalization_run_id,
    stagingSha256: row.staging_sha256,
    providerDecodedRowId: row.provider_decoded_row_id,
    sourceRowSha256: row.source_row_sha256,
    candidateSha256: sha256AflTradeCanonicalJson(candidate),
    environment: execution.environment,
    provider: row.provider,
    capabilityId: row.capability_id,
    fieldMapSha256: row.field_map_sha256,
    normalizationFinalization: ref('provider-normalization-finalization', {
      normalizationRunId: row.normalization_run_id,
      stagingSha256: row.staging_sha256,
      finalizedAt: new Date(row.finalized_at).toISOString(),
    }),
    rowStatus: 'staged' as const,
    issueSet: ref('provider-resolution-issue-set', {
      normalizationRunId: row.normalization_run_id,
      providerDecodedRowId: row.provider_decoded_row_id,
      issues: [],
    }),
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    nativeIdNamespace: null,
    competition: 'AFLM' as const,
    seasonYear: 2026,
  };
  const reviewer = {
    principalRef: execution.principalRef,
    role: 'afl_trade_identity_reviewer' as const,
    scopeKey: 'public-afl-draft-trade-outcomes' as const,
    provider: row.provider,
    capabilityId: row.capability_id,
    competition: 'AFLM' as const,
    validFromSeason: 2026,
    validThroughSeason: 2026,
  };
  const authorityEvidence = await retainEvidence('reviewer_authority_evidence', reviewer);
  await pool.query(
    `INSERT INTO outcome_operational_principal_authority
    (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through)
    VALUES($1,$2,$3,$4,$5,$6,'AFLM',2026,2026,'2026-01-01',NULL)`,
    [
      authorityEvidence.id,
      reviewer.principalRef,
      reviewer.role,
      reviewer.scopeKey,
      reviewer.provider,
      reviewer.capabilityId,
    ]
  );
  const method = await retainEvidence('provider_resolution_method', {
    methodVersion: 'synthetic-exact-fixture/v1',
  });
  const evidence = await retainEvidence('provider_resolution_evidence', {
    matchCandidateId: row.match_candidate_id,
  });
  const normalizationPolicy = await retainEvidence('provider_resolution_policy', {
    policy: 'canonical-club-alias/v1',
  });
  const assignment = (entityKind: string, identityId: string) =>
    createAflTradeContentAddress('provider-identity-assignment-case', { entityKind, identityId });

  async function register(
    record: AflTradeCanonicalTargetRecord,
    proposalBody: ProposalSubject,
    identityId: string,
    entityKind: 'club_alias' | 'match',
    sourceStaging: AflTradeProviderResolutionProposal['content']['staging'] = staging,
    creationReplay = false
  ) {
    const snapshot = {
      evidenceKind: 'canonical_target_snapshot',
      schemaVersion: 'afl-trade-canonical-target-snapshot/v1',
      environment: execution.environment,
      staging: sourceStaging,
      record,
    };
    const snapshotReference = await retainEvidence('canonical_target_snapshot', snapshot);
    const proposal = createAflTradeProviderResolutionProposal({
      schemaVersion: 'afl-trade-provider-resolution-proposal/v2',
      staging: sourceStaging,
      method,
      canonicalTargetSnapshot: snapshotReference,
      supportingEvidence: [evidence],
      proposedAt: reviewedAt,
      ...proposalBody,
    });
    const priorAssignment = (
      await pool.query<{ revision: number; decision_id: string }>(
        'SELECT revision,decision_id FROM outcome_provider_identity_assignment_head WHERE assignment_case_id=$1',
        [assignment(entityKind, identityId)]
      )
    ).rows[0];
    const priorResolution = (
      await pool.query<{ revision: number; resolution_id: string }>(
        `SELECT revision,resolution_id FROM outcome_provider_${entityKind === 'match' ? 'match' : 'club'}_resolution_head WHERE resolution_case_id=$1`,
        [proposal.content.resolutionCaseId]
      )
    ).rows[0];
    const decision = createAflTradeProviderResolutionDecision({
      schemaVersion: 'afl-trade-provider-resolution/v2',
      proposal,
      expectedRevision: priorResolution?.revision ?? 0,
      supersedesDecisionId: priorResolution?.resolution_id ?? null,
      assignmentRevision: {
        assignmentCaseId: assignment(entityKind, identityId),
        entityKind,
        identityId,
        expectedRevision: priorAssignment?.revision ?? 0,
        supersedesDecisionId: priorAssignment?.decision_id ?? null,
        nextStatus: 'active',
      },
      outcome: 'approved',
      rationale: 'Synthetic exact source calendar-date and club review.',
      reviewerAuthority: { ...reviewer, authorityEvidence },
      effectiveAt: reviewedAt,
      decidedAt: reviewedAt,
    });
    const content = {
      schemaVersion: 'afl-trade-canonical-target-registration/v1',
      authorityBoundary: 'reviewed_canonical_creation_no_provider_assignment',
      targetSnapshot: snapshot,
      resolutionDecision: decision,
    };
    const registration = aflTradeCanonicalTargetRegistrationSchema.parse({
      registrationDecisionId: createAflTradeContentAddress(
        'canonical-target-registration',
        content
      ),
      content,
    });
    const request = {
      registrationDecisionId: registration.registrationDecisionId,
      targetSnapshotReferenceId: snapshotReference.id,
    };
    if (record.entityKind === 'match') {
      // Readdress every enclosing artifact; only the false claim of an instant is invalid.
      const wrongSnapshot = {
        ...snapshot,
        record: { ...record, dateInterpretation: 'source_instant' },
      };
      const wrongReference = await retainEvidence('canonical_target_snapshot', wrongSnapshot);
      const wrongProposal = createAflTradeProviderResolutionProposal({
        ...proposal.content,
        canonicalTargetSnapshot: wrongReference,
      });
      const wrongDecision = createAflTradeProviderResolutionDecision({
        ...decision.content,
        proposal: wrongProposal,
      });
      const wrongContent = {
        ...content,
        targetSnapshot: wrongSnapshot,
        resolutionDecision: wrongDecision,
      };
      const wrongRegistration = {
        registrationDecisionId: createAflTradeContentAddress(
          'canonical-target-registration',
          wrongContent
        ),
        content: wrongContent,
      };
      await pool.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,rationale,evidence_json,decided_by,decided_at)
        VALUES($1,'canonical_target_creation',$2,'approved','match',$3,'Synthetic invalid date precision review',$4::jsonb,$5,$6)`,
        [
          wrongRegistration.registrationDecisionId,
          wrongReference.id,
          record.canonicalId,
          canonicalizeAflTradeJson(wrongRegistration),
          execution.principalRef,
          reviewedAt,
        ]
      );
      await expect(
        pool.query('SELECT * FROM register_outcome_reviewed_canonical_target($1,$2,$3,$4)', [
          wrongRegistration.registrationDecisionId,
          wrongReference.id,
          execution.principalRef,
          execution.environment,
        ])
      ).rejects.toThrow('Canonical instant interpretation mismatch');
    }
    await pool.query(
      `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,'canonical_target_creation',$2,'approved',$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        request.registrationDecisionId,
        snapshotReference.id,
        record.entityKind,
        record.canonicalId,
        decision.content.rationale,
        canonicalizeAflTradeJson(registration),
        execution.principalRef,
        reviewedAt,
      ]
    );
    await expect(repository.registerCanonicalTarget(request, execution)).resolves.toEqual({
      entityKind: record.entityKind,
      canonicalId: record.canonicalId,
      idempotentReplay: creationReplay,
    });
    await expect(repository.registerCanonicalTarget(request, execution)).resolves.toEqual({
      entityKind: record.entityKind,
      canonicalId: record.canonicalId,
      idempotentReplay: true,
    });
    await expect(repository.persistDecision(decision, execution)).resolves.toMatchObject({
      outcome: 'approved',
      idempotentReplay: false,
    });
    await expect(repository.persistDecision(decision, execution)).resolves.toMatchObject({
      outcome: 'approved',
      idempotentReplay: true,
    });
    return decision.decisionId;
  }
  const decisions: string[] = [];
  for (const side of ['home', 'away'] as const) {
    const currentName = candidate[`${side}ClubName`];
    const normalizedName = currentName.toLowerCase();
    const aliasId = createAflTradeContentAddress('provider-club-alias', {
      provider: row.provider,
      competition: 'AFLM',
      normalizationPolicyId: normalizationPolicy.id,
      normalizedName,
      validFromSeason: 2026,
      validThroughSeason: 2026,
    });
    const occurrence = {
      source: 'match_side' as const,
      matchCandidateId: row.match_candidate_id,
      side,
    };
    decisions.push(
      await register(
        {
          entityKind: 'club',
          canonicalId: `club:synthetic-${side}`,
          currentName,
          abbreviation: null,
          activeFromYear: null,
          activeThroughYear: null,
        },
        {
          subjectType: 'provider_club_candidate',
          occurrence,
          resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
            subjectType: 'provider_club_candidate',
            occurrence,
          }),
          candidate: { nativeClubId: candidate[`${side}ClubNativeId`], recordedName: currentName },
          proposedTarget: {
            scope: 'temporal_alias',
            clubId: `club:synthetic-${side}`,
            validFromSeason: 2026,
            validThroughSeason: 2026,
            normalizedName,
            aliasId,
            assignmentCaseId: assignment('club_alias', aliasId),
            normalizationPolicy,
          },
          alternativeClubIds: [],
        },
        aliasId,
        'club_alias'
      )
    );
    const second = result.rows[1]!;
    const secondOccurrence = { ...occurrence, matchCandidateId: second.match_candidate_id };
    await register(
      {
        entityKind: 'club',
        canonicalId: `club:synthetic-${side}`,
        currentName,
        abbreviation: null,
        activeFromYear: null,
        activeThroughYear: null,
      },
      {
        subjectType: 'provider_club_candidate',
        occurrence: secondOccurrence,
        resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
          subjectType: 'provider_club_candidate',
          occurrence: secondOccurrence,
        }),
        candidate: {
          nativeClubId: second.candidate_json[`${side}ClubNativeId`],
          recordedName: currentName,
        },
        proposedTarget: {
          scope: 'temporal_alias',
          clubId: `club:synthetic-${side}`,
          validFromSeason: 2026,
          validThroughSeason: 2026,
          normalizedName,
          aliasId,
          assignmentCaseId: assignment('club_alias', aliasId),
          normalizationPolicy,
        },
        alternativeClubIds: [],
      },
      aliasId,
      'club_alias',
      {
        ...staging,
        providerDecodedRowId: second.provider_decoded_row_id,
        sourceRowSha256: second.source_row_sha256,
        candidateSha256: sha256AflTradeCanonicalJson(second.candidate_json),
        issueSet: ref('provider-resolution-issue-set', {
          normalizationRunId: second.normalization_run_id,
          providerDecodedRowId: second.provider_decoded_row_id,
          issues: [],
        }),
      },
      true
    );
  }
  expect(candidate.matchDateText).toBe('2026-03-20');
  expect(candidate.nativeMatchId).toBeNull();
  const fixtureFingerprintSha256 = createAflTradeReviewedFixtureFingerprint({
    competition: 'AFLM',
    seasonYear: 2026,
    canonicalRoundLabel: 'Round 1',
    canonicalMatchDate: '2026-03-20T00:00:00.000Z',
    clubIds: ['club:synthetic-home', 'club:synthetic-away'],
  });
  const matchIdentityId = createAflTradeContentAddress('provider-match-identity', {
    provider: row.provider,
    competition: 'AFLM',
    seasonYear: 2026,
    fixtureFingerprintSha256,
  });
  await register(
    {
      entityKind: 'match',
      canonicalId: 'match:synthetic-date-only',
      competition: 'AFLM',
      seasonYear: 2026,
      roundLabel: 'Round 1',
      sourceDateText: '2026-03-20',
      dateInterpretation: 'source_calendar_date_as_utc_midnight',
      matchDate: '2026-03-20T00:00:00.000Z',
      homeClubId: 'club:synthetic-home',
      awayClubId: 'club:synthetic-away',
    },
    {
      subjectType: 'provider_match_candidate',
      matchCandidateId: row.match_candidate_id,
      resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
        subjectType: 'provider_match_candidate',
        matchCandidateId: row.match_candidate_id,
      }),
      candidate: {
        nativeMatchId: candidate.nativeMatchId,
        roundLabel: candidate.roundLabel,
        matchDateText: candidate.matchDateText,
        homeClubNativeId: candidate.homeClubNativeId,
        homeClubName: candidate.homeClubName,
        awayClubNativeId: candidate.awayClubNativeId,
        awayClubName: candidate.awayClubName,
        orderIndependentSha256: candidate.orderIndependentSha256,
      },
      proposedTarget: {
        matchIdentityKind: 'reviewed_fixture_fingerprint',
        matchIdentityId,
        assignmentCaseId: assignment('match', matchIdentityId),
        matchId: 'match:synthetic-date-only',
        canonicalMatchDate: '2026-03-20T00:00:00.000Z',
        canonicalRoundLabel: 'Round 1',
        homeClubId: 'club:synthetic-home',
        awayClubId: 'club:synthetic-away',
        fixtureFingerprintSha256,
        homeClubResolutionDecisionId: decisions[0],
        awayClubResolutionDecisionId: decisions[1],
      },
      alternativeMatchIds: [],
    },
    matchIdentityId,
    'match'
  );
  const originalHomeAuthority = {
    entityKind: 'club',
    canonicalId: 'club:synthetic-home',
    revision: 1,
    status: 'current_approved',
    resolutionDecision: { id: decisions[0], sha256: decisions[0]!.split(':')[1] },
    assignmentDecision: { id: decisions[0], sha256: decisions[0]!.split(':')[1] },
  };
  const originalHomeCurrent = async () =>
    (
      await pool.query<{ current: boolean }>(
        "SELECT outcome_hpn_pav_club_resolution_current($1,$2::jsonb,'home') AS current",
        [row.provider_decoded_row_id, canonicalizeAflTradeJson(originalHomeAuthority)]
      )
    ).rows[0]!.current;
  expect(await originalHomeCurrent()).toBe(true);
  const earlierSecondHome = aflTradeProviderResolutionDecisionSchema.parse(
    (
      await pool.query<{ decision_json: unknown }>(
        "SELECT decision_json FROM outcome_provider_club_resolution WHERE match_candidate_id=$1 AND side='home'",
        [result.rows[1]!.match_candidate_id]
      )
    ).rows[0]!.decision_json
  );
  const secondHome = createAflTradeProviderResolutionDecision({
    ...earlierSecondHome.content,
    expectedRevision: 1,
    supersedesDecisionId: earlierSecondHome.decisionId,
    assignmentRevision: {
      ...earlierSecondHome.content.assignmentRevision!,
      expectedRevision: 2,
      supersedesDecisionId: earlierSecondHome.decisionId,
    },
  });
  await repository.persistDecision(secondHome, execution);
  expect(await originalHomeCurrent()).toBe(true);
  expect(
    (
      await pool.query<{ current: boolean }>(
        "SELECT outcome_hpn_pav_club_resolution_current($1,$2::jsonb,'home') AS current",
        [
          result.rows[1]!.provider_decoded_row_id,
          canonicalizeAflTradeJson({
            ...originalHomeAuthority,
            resolutionDecision: {
              id: earlierSecondHome.decisionId,
              sha256: earlierSecondHome.decisionSha256,
            },
            assignmentDecision: {
              id: earlierSecondHome.decisionId,
              sha256: earlierSecondHome.decisionSha256,
            },
          }),
        ]
      )
    ).rows[0]!.current
  ).toBe(false);
  const secondProposal = secondHome.content.proposal.content;
  // Same relational projection used by dataset authentication: origin remains original,
  // while the actual current head and intervening confirmation are explicitly separate.
  const continuityEvidence = await pool.query<{
    origin: string;
    head: string;
    revision: number;
    confirmations: unknown;
  }>(
    `SELECT resolution.decision_id AS origin,assignment.decision_id AS head,assignment.revision,
      COALESCE((SELECT jsonb_agg(confirmation.decision_json ORDER BY confirmation.assignment_revision)
        FROM outcome_provider_club_resolution confirmation WHERE confirmation.assignment_case_id=resolution.assignment_case_id
          AND confirmation.assignment_revision>resolution.assignment_revision AND confirmation.assignment_revision<=assignment.revision),'[]'::jsonb) AS confirmations
     FROM outcome_provider_club_resolution resolution
     JOIN outcome_provider_club_resolution_head head ON head.resolution_id=resolution.resolution_id
     JOIN outcome_provider_identity_assignment_head assignment ON assignment.assignment_case_id=resolution.assignment_case_id
       AND outcome_provider_assignment_continuity_current(resolution.decision_id)
     WHERE resolution.decision_id=$1`,
    [decisions[0]]
  );
  expect(continuityEvidence.rows).toEqual([
    {
      origin: decisions[0],
      head: secondHome.decisionId,
      revision: 3,
      confirmations: [earlierSecondHome, secondHome],
    },
  ]);
  const contender = await pool.connect();
  try {
    await contender.query('BEGIN');
    await contender.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_resolution_case:'||$1::text,0))",
      [secondProposal.resolutionCaseId]
    );
    expect(await originalHomeCurrent()).toBe(false);
    await contender.query('ROLLBACK');
    expect(await originalHomeCurrent()).toBe(true);
    await contender.query('BEGIN');
    await contender.query(
      'SELECT 1 FROM outcome_provider_identity_assignment_head WHERE decision_id=$1 FOR UPDATE',
      [secondHome.decisionId]
    );
    expect(await originalHomeCurrent()).toBe(false);
    await contender.query('ROLLBACK');
    expect(await originalHomeCurrent()).toBe(true);
  } finally {
    await contender.query('ROLLBACK');
    contender.release();
  }
  if (
    secondProposal.subjectType !== 'provider_club_candidate' ||
    secondProposal.proposedTarget?.scope !== 'temporal_alias'
  )
    throw new Error('Expected reusable home alias');
  const inactiveA = createAflTradeProviderResolutionDecision({
    ...secondHome.content,
    expectedRevision: secondHome.content.expectedRevision + 1,
    supersedesDecisionId: secondHome.decisionId,
    outcome: 'rejected',
    assignmentRevision: {
      ...secondHome.content.assignmentRevision!,
      expectedRevision: secondHome.content.assignmentRevision!.expectedRevision + 1,
      supersedesDecisionId: secondHome.decisionId,
      nextStatus: 'inactive',
    },
  });
  await repository.persistDecision(inactiveA, execution);
  expect(await originalHomeCurrent()).toBe(false);
  const retargetId = await register(
    {
      entityKind: 'club',
      canonicalId: 'club:synthetic-retarget',
      currentName: 'Carlton',
      abbreviation: null,
      activeFromYear: null,
      activeThroughYear: null,
    },
    {
      subjectType: 'provider_club_candidate',
      resolutionCaseId: secondProposal.resolutionCaseId,
      occurrence: secondProposal.occurrence,
      candidate: secondProposal.candidate,
      proposedTarget: { ...secondProposal.proposedTarget, clubId: 'club:synthetic-retarget' },
      alternativeClubIds: [],
    },
    secondProposal.proposedTarget.aliasId,
    'club_alias',
    secondProposal.staging
  );
  expect(await originalHomeCurrent()).toBe(false);
  const retarget = aflTradeProviderResolutionDecisionSchema.parse(
    (
      await pool.query<{ decision_json: unknown }>(
        'SELECT decision_json FROM outcome_provider_club_resolution WHERE decision_id=$1',
        [retargetId]
      )
    ).rows[0]!.decision_json
  );
  const inactiveB = createAflTradeProviderResolutionDecision({
    ...retarget.content,
    expectedRevision: retarget.content.expectedRevision + 1,
    supersedesDecisionId: retargetId,
    outcome: 'rejected',
    assignmentRevision: {
      ...retarget.content.assignmentRevision!,
      expectedRevision: retarget.content.assignmentRevision!.expectedRevision + 1,
      supersedesDecisionId: retargetId,
      nextStatus: 'inactive',
    },
  });
  await repository.persistDecision(inactiveB, execution);
  const backToA = createAflTradeProviderResolutionDecision({
    ...secondHome.content,
    expectedRevision: inactiveB.content.expectedRevision + 1,
    supersedesDecisionId: inactiveB.decisionId,
    assignmentRevision: {
      ...secondHome.content.assignmentRevision!,
      expectedRevision: inactiveB.content.assignmentRevision!.expectedRevision + 1,
      supersedesDecisionId: inactiveB.decisionId,
    },
  });
  await repository.persistDecision(backToA, execution);
  // Returning to the same target cannot resurrect the earlier evidence across the B assignment.
  expect(await originalHomeCurrent()).toBe(false);
  const currentAssignment = async () =>
    (
      await pool.query<{ current: boolean }>(
        'SELECT outcome_provider_assignment_continuity_current($1) AS current',
        [backToA.decisionId]
      )
    ).rows[0]!.current;
  expect(await currentAssignment()).toBe(true);
  await repository.persistDecision(
    createAflTradeProviderResolutionDecision({
      ...backToA.content,
      expectedRevision: backToA.content.expectedRevision + 1,
      supersedesDecisionId: backToA.decisionId,
      outcome: 'rejected',
      assignmentRevision: {
        ...backToA.content.assignmentRevision!,
        expectedRevision: backToA.content.assignmentRevision!.expectedRevision + 1,
        supersedesDecisionId: backToA.decisionId,
        nextStatus: 'inactive',
      },
    }),
    execution
  );
  expect(await currentAssignment()).toBe(false);
}, 120_000);
