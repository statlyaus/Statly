import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { aflTradeSourceSnapshotManifestContentSchema } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { AflDraftTradeOutcomeReleaseRepositoryError } from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseRepository';
import { createAflTradeFactualProjectionItemSet } from '@/server/aflTradeIntelligence/outcomes/factualProjectionItemSetContracts';
import {
  createPostgresAflDraftTradeOutcomeReleaseRepository,
  type AflOutcomeSqlClient,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  createAflTradeFitzRoyFieldMapSha256,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyDecodedTable,
  parseAflTradeFitzRoyFieldMap,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { normalizeAflTradeFitzRoyDecodedTable } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import {
  AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
  type AflTradeProviderResolutionProposal,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';
import {
  aflDraftTradeOutcomeFixtureHash,
  createAflDraftTradeOutcomeReleaseFixture,
} from '../fixtures/aflDraftTradeOutcomeReleaseFixture';
import { OUTCOMES_PRISMA_SCHEMA_PATH, runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

interface QueryResultLike<Row = Record<string, unknown>> {
  rows: readonly Row[];
  rowCount: number | null;
}

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error(
      'AFL_OUTCOMES_TEST_DATABASE_URL must identify an explicitly provisioned disposable PostgreSQL database.'
    );
  })();

const schemaName = `afl_outcomes_test_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});

async function query<Row = Record<string, unknown>>(
  sql: string,
  parameters: readonly unknown[] = []
): Promise<QueryResultLike<Row>> {
  return (await outcomesPool.query(sql, [...parameters])) as QueryResultLike<Row>;
}

function scopedDatabaseUrl(targetSchema: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', targetSchema);
  return scoped.toString();
}

function deployOutcomeMigrations(targetSchema: string) {
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(targetSchema),
  });
}

function createTwoPartyBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await opened;
  };
}

const providerDigest = (character: string) => character.repeat(64);
const providerFields = [
  { name: 'season', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
  {
    name: 'match_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_name',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  { name: 'home', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'away', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'round', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'goals', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
];

function providerStagingFixture() {
  const invocationArguments = { season: 2026, roundNumber: null };
  const captureReceipt = {
    captureReceiptId: 'fitzroy-capture:fixture',
    content: {
      invocation: {
        capabilityId: 'official-afl-player-stats',
        fitzRoyVersion: '1.7.0',
        provider: 'official_afl',
        arguments: invocationArguments,
      },
      authorizationReceipt: {
        content: { request: { competition: 'AFLM', season: 2026 } },
      },
      invocationCustody: { artifact: { contentSha256: providerDigest('b') } },
      diagnosticsCustody: { artifact: { contentSha256: providerDigest('d') } },
      sourceCustody: { artifact: { contentSha256: providerDigest('e') } },
      schemaFingerprint: `sha256:${createDecodedFieldSchemaSha256(providerFields)}`,
    },
  };
  const captureReceiptSha256 = sha256AflTradeCanonicalJson(captureReceipt);
  const invocationArgumentsSha256 = sha256AflTradeCanonicalJson(invocationArguments);
  const table = parseAflTradeFitzRoyDecodedTable({
    schemaVersion: AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
    captureReceiptSha256,
    capabilityId: 'official-afl-player-stats',
    fitzRoyVersion: '1.7.0',
    authorizationCompetition: 'AFLM',
    authorizationSeason: 2026,
    invocationSha256: providerDigest('b'),
    invocationArgumentsSha256,
    diagnosticsSha256: providerDigest('d'),
    sourceRdsSha256: providerDigest('e'),
    sourceSchemaSha256: createDecodedFieldSchemaSha256(providerFields),
    decoderRuntime: {
      decoderVersion: 'afl-trade-fitzroy-rds-decoder/v1',
      rVersion: '4.5.1',
      dependencyLockSha256: providerDigest('f'),
      imageDigest: `sha256:${providerDigest('1')}`,
    },
    frame: { classes: ['data.frame'], rowNames: ['1'] },
    fields: providerFields,
    rows: [
      [
        { kind: 'integer', value: '2026' },
        { kind: 'text', value: 'match-1' },
        { kind: 'text', value: 'player-1' },
        { kind: 'text', value: 'Player One' },
        { kind: 'text', value: 'Carlton' },
        { kind: 'text', value: 'Fremantle' },
        { kind: 'text', value: 'Round 1' },
        { kind: 'integer', value: '2' },
      ],
    ],
  });
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: 'provider-field-map-integration',
    capabilityId: 'official-afl-player-stats',
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: table.sourceSchemaSha256,
    exactOrderedFields: providerFields.map(({ name }) => name),
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256,
    validFromSeason: 2026,
    validThroughSeason: 2026,
    seasonField: { sourceField: 'season', required: true },
    roundLabelField: { sourceField: 'round', required: true },
    observedDateField: null,
    naturalKeyFields: ['match_id', 'player_id'],
    approvedAt: '2026-08-07T00:00:00.000Z',
    approvalDecisionId: 'provider-field-map-review-integration',
    identity: {
      nativeId: { sourceField: 'player_id', required: true },
      recordedName: { sourceField: 'player_name', required: true },
      recordedClubNativeId: null,
      recordedClubName: null,
    },
    match: {
      nativeMatchId: { sourceField: 'match_id', required: true },
      season: { sourceField: 'season', required: true },
      roundLabel: { sourceField: 'round', required: true },
      matchDate: null,
      homeClubNativeId: null,
      homeClubName: { sourceField: 'home', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'away', required: true },
      status: null,
    },
    metrics: [
      {
        metricCode: 'goals',
        sourceField: 'goals',
        definitionVersion: 'goals/v1',
        unit: 'goals',
        zeroSemantics: 'measured_zero',
      },
    ],
    achievement: null,
  });
  return {
    captureReceipt,
    captureReceiptSha256,
    fieldMap,
    batch: normalizeAflTradeFitzRoyDecodedTable({
      table,
      fieldMap,
      decodedSha256: providerDigest('8'),
    }),
    parsedManifest: {
      capture: { kind: 'fitzroy', upstreamProvider: 'official_afl', packageVersion: '1.7.0' },
      fitzRoyCaptureReceipt: captureReceipt,
    },
  };
}

type GovernedEvidenceKind =
  | 'provider_resolution_method'
  | 'canonical_target_snapshot'
  | 'provider_resolution_evidence'
  | 'reviewer_authority_evidence'
  | 'provider_resolution_policy';

const governedEvidencePrefix: Record<GovernedEvidenceKind, string> = {
  provider_resolution_method: 'provider-resolution-method',
  canonical_target_snapshot: 'canonical-target-snapshot',
  provider_resolution_evidence: 'provider-resolution-evidence',
  reviewer_authority_evidence: 'reviewer-authority-evidence',
  provider_resolution_policy: 'provider-resolution-policy',
};

async function seedFixtureGovernedEvidence(
  evidenceKind: GovernedEvidenceKind,
  evidence: Readonly<Record<string, unknown>>
) {
  const payload = { evidenceKind, environment: 'test_fixture', ...evidence } as const;
  const referenceId = createAflTradeContentAddress(governedEvidencePrefix[evidenceKind], payload);
  const referenceSha256 = referenceId.slice(referenceId.indexOf(':') + 1);
  const artifactId = createAflTradeContentAddress('governed-evidence-artifact', { referenceId });
  const approvalDecisionId = createAflTradeContentAddress('governed-evidence-approval-decision', {
    referenceId,
  });
  const canonicalPayload = canonicalizeAflTradeJson(payload);
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
         environment, created_at, verified_at, custody_json)
       VALUES ($1, $2, $3, 'application/json', $4, 'derived_private', 'test_fixture',
               '2026-08-07T00:00:10.000Z', '2026-08-07T00:00:11.000Z', '{}'::jsonb)`,
      [
        artifactId,
        referenceSha256,
        `artifact://sha256/${referenceSha256}`,
        Buffer.byteLength(canonicalPayload),
      ]
    );
    await connection.query(
      `INSERT INTO outcome_review_decision
        (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
         decided_by, decided_at)
       VALUES ($1, 'governed_evidence_reference', $2, 'approved',
               'Disposable integration evidence approval',
               jsonb_build_object('referenceSha256', $3::text), 'fixture-governance-reviewer',
               '2026-08-07T00:00:20.000Z')`,
      [approvalDecisionId, referenceId, referenceSha256]
    );
    await connection.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id, reference_sha256, evidence_kind, artifact_id, environment, status,
         approval_decision_id, created_at, evidence_canonical_json, evidence_json)
       VALUES ($1, $2, $3, $4, 'test_fixture', 'approved', $5,
               '2026-08-07T00:00:20.000Z', $6, $7::jsonb)`,
      [
        referenceId,
        referenceSha256,
        evidenceKind,
        artifactId,
        approvalDecisionId,
        canonicalPayload,
        canonicalPayload,
      ]
    );
    await connection.query('COMMIT');
  } finally {
    await connection.query('ROLLBACK').catch(() => undefined);
    connection.release();
  }
  return { id: referenceId, sha256: referenceSha256 };
}

function createPlayerResolutionDecision(input: {
  proposal: AflTradeProviderResolutionProposal;
  expectedRevision: number;
  supersedesDecisionId: string | null;
  expectedAssignmentRevision: number;
  supersedesAssignmentDecisionId: string | null;
  outcome: 'approved' | 'rejected' | 'deferred';
  rationale: string;
  decidedAt: string;
  reviewerAuthority: {
    principalRef: string;
    authorityEvidence: { id: string; sha256: string };
    role: 'afl_trade_identity_reviewer';
    scopeKey: 'public-afl-draft-trade-outcomes';
    provider: string;
    capabilityId: string;
    competition: 'AFLM';
    validFromSeason: number;
    validThroughSeason: number;
  };
}) {
  const content = input.proposal.content;
  if (
    content.subjectType !== 'provider_player_candidate' ||
    content.proposedTarget?.scope !== 'provider_identity'
  ) {
    throw new Error('The integration fixture requires one reusable provider player identity.');
  }
  return createAflTradeProviderResolutionDecision({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
    proposal: input.proposal,
    expectedRevision: input.expectedRevision,
    supersedesDecisionId: input.supersedesDecisionId,
    assignmentRevision: {
      assignmentCaseId: content.proposedTarget.assignmentCaseId,
      entityKind: 'player',
      identityId: content.proposedTarget.playerIdentityId,
      expectedRevision: input.expectedAssignmentRevision,
      supersedesDecisionId: input.supersedesAssignmentDecisionId,
      nextStatus: input.outcome === 'approved' ? 'active' : 'inactive',
    },
    outcome: input.outcome,
    rationale: input.rationale,
    reviewerAuthority: input.reviewerAuthority,
    effectiveAt: input.decidedAt,
    decidedAt: input.decidedAt,
  });
}

async function createProviderResolutionScenario() {
  const staged = await query<{
    normalization_run_id: string;
    staging_sha256: string;
    finalized_at: Date | string;
    field_map_sha256: string;
    provider_decoded_row_id: string;
    source_row_sha256: string;
    row_status: 'staged' | 'needs_review';
    competition: 'AFLM';
    season_year: number;
    identity_candidate_id: string;
    native_entity_id: string;
    recorded_name: string;
    recorded_club_id: string | null;
    recorded_club_name: string | null;
    candidate_sha256: string;
  }>(
    `SELECT run.normalization_run_id, run.staging_sha256, run.finalized_at,
            field_map.field_map_sha256, row.provider_decoded_row_id, row.source_row_sha256,
            row.row_status::text, row.competition, row.season_year,
            identity.identity_candidate_id, identity.native_entity_id, identity.recorded_name,
            identity.recorded_club_id, identity.recorded_club_name, identity.candidate_sha256
       FROM outcome_provider_normalization_run run
       JOIN outcome_provider_field_map field_map USING (field_map_id)
       JOIN outcome_provider_decoded_row row USING (normalization_run_id)
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
      WHERE run.capture_id = 'provider-capture-integration'`
  );
  if (!staged.rows[0]) throw new Error('The finalized provider staging fixture is missing.');

  const namespace = await query<{
    namespace_id: string;
    environment: 'test_fixture';
    provider: string;
    capability_id: string;
    entity_kind: 'player';
    namespace_version: string;
    identity_scope: 'competition';
    competition: 'AFLM';
    definition_sha256: string;
    approval_decision_id: string;
    approval_decision_sha256: string;
    valid_from_season: number;
    valid_through_season: number;
  }>(
    `SELECT namespace_id, environment::text, provider, capability_id, entity_kind,
            namespace_version, identity_scope, competition, definition_sha256,
            approval_decision_id, approval_decision_sha256, valid_from_season,
            valid_through_season
       FROM outcome_provider_native_id_namespace
      WHERE environment = 'test_fixture' AND provider = 'official_afl'
        AND capability_id = 'official-afl-player-stats' AND entity_kind = 'player'
        AND 2026 BETWEEN valid_from_season AND valid_through_season`
  );
  if (!namespace.rows[0]) throw new Error('The fixture player namespace is missing.');

  const method = await seedFixtureGovernedEvidence('provider_resolution_method', {
    methodVersion: 'provider-player-resolution/integration-v1',
  });
  const canonicalTargetSnapshotA = await seedFixtureGovernedEvidence('canonical_target_snapshot', {
    playerId: 'afl-player:provider-resolution-a',
    displayName: 'Provider Resolution A',
  });
  const canonicalTargetSnapshotB = await seedFixtureGovernedEvidence('canonical_target_snapshot', {
    playerId: 'afl-player:provider-resolution-b',
    displayName: 'Provider Resolution B',
  });
  const supportingEvidence = await seedFixtureGovernedEvidence('provider_resolution_evidence', {
    source: 'provider-resolution-integration',
    candidateId: staged.rows[0].identity_candidate_id,
  });
  const principalRef = 'operator:provider-resolution-integration';
  const reviewerAuthorityEvidence = await seedFixtureGovernedEvidence(
    'reviewer_authority_evidence',
    {
      principalRef,
      role: 'afl_trade_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: 'official_afl',
      capabilityId: 'official-afl-player-stats',
      competition: 'AFLM',
      validFromSeason: 2026,
      validThroughSeason: 2026,
    }
  );
  await query(
    `INSERT INTO outcome_operational_principal_authority
      (authority_evidence_id, principal_ref, role, scope_key, provider, capability_id,
       competition, valid_from_season, valid_through_season, valid_from, valid_through)
     VALUES ($1, $2, 'afl_trade_identity_reviewer', 'public-afl-draft-trade-outcomes',
             'official_afl', 'official-afl-player-stats', 'AFLM', 2026, 2026,
             '2026-01-01T00:00:00.000Z', NULL)`,
    [reviewerAuthorityEvidence.id, principalRef]
  );
  await query(
    `INSERT INTO outcome_player (player_id, display_name, status)
     VALUES ('afl-player:provider-resolution-a', 'Provider Resolution A', 'approved'),
            ('afl-player:provider-resolution-b', 'Provider Resolution B', 'approved')`
  );

  const finalizedAt = new Date(staged.rows[0].finalized_at).toISOString();
  const normalizationFinalizationId = createAflTradeContentAddress(
    'provider-normalization-finalization',
    {
      normalizationRunId: staged.rows[0].normalization_run_id,
      stagingSha256: staged.rows[0].staging_sha256,
      finalizedAt,
    }
  );
  const issueSetId = createAflTradeContentAddress('provider-resolution-issue-set', {
    normalizationRunId: staged.rows[0].normalization_run_id,
    providerDecodedRowId: staged.rows[0].provider_decoded_row_id,
    issues: [],
  });
  const namespaceEvidence = {
    namespaceId: namespace.rows[0].namespace_id,
    definitionSha256: namespace.rows[0].definition_sha256,
    environment: namespace.rows[0].environment,
    provider: namespace.rows[0].provider,
    capabilityId: namespace.rows[0].capability_id,
    entityKind: namespace.rows[0].entity_kind,
    namespaceVersion: namespace.rows[0].namespace_version,
    identityScope: { kind: 'competition' as const, competition: namespace.rows[0].competition },
    validFromSeason: namespace.rows[0].valid_from_season,
    validThroughSeason: namespace.rows[0].valid_through_season,
    approvalDecision: {
      id: namespace.rows[0].approval_decision_id,
      sha256: namespace.rows[0].approval_decision_sha256,
    },
  };
  const staging = {
    normalizationRunId: staged.rows[0].normalization_run_id,
    stagingSha256: staged.rows[0].staging_sha256,
    providerDecodedRowId: staged.rows[0].provider_decoded_row_id,
    sourceRowSha256: staged.rows[0].source_row_sha256,
    candidateSha256: staged.rows[0].candidate_sha256,
    environment: 'test_fixture' as const,
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    fieldMapSha256: staged.rows[0].field_map_sha256,
    normalizationFinalization: {
      id: normalizationFinalizationId,
      sha256: normalizationFinalizationId.slice(normalizationFinalizationId.indexOf(':') + 1),
    },
    rowStatus: staged.rows[0].row_status,
    issueSet: {
      id: issueSetId,
      sha256: issueSetId.slice(issueSetId.indexOf(':') + 1),
    },
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    nativeIdNamespace: namespaceEvidence,
    competition: staged.rows[0].competition,
    seasonYear: staged.rows[0].season_year,
  };
  const candidate = {
    nativePlayerId: staged.rows[0].native_entity_id,
    recordedName: staged.rows[0].recorded_name,
    recordedClubId: staged.rows[0].recorded_club_id,
    recordedClubName: staged.rows[0].recorded_club_name,
  };
  const playerIdentityId = createAflTradeContentAddress('provider-player-identity', {
    nativeIdNamespaceId: namespaceEvidence.namespaceId,
    nativePlayerId: candidate.nativePlayerId,
  });
  const assignmentCaseId = createAflTradeContentAddress('provider-identity-assignment-case', {
    entityKind: 'player',
    identityId: playerIdentityId,
  });
  const resolutionCaseId = createAflTradeContentAddress('provider-resolution-case', {
    subjectType: 'provider_player_candidate',
    identityCandidateId: staged.rows[0].identity_candidate_id,
  });
  const reviewerAuthority = {
    principalRef,
    authorityEvidence: reviewerAuthorityEvidence,
    role: 'afl_trade_identity_reviewer' as const,
    scopeKey: 'public-afl-draft-trade-outcomes' as const,
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM' as const,
    validFromSeason: 2026,
    validThroughSeason: 2026,
  };
  const proposal = (
    playerId: string,
    canonicalTargetSnapshot: { id: string; sha256: string },
    proposedAt: string,
    candidateOverride: typeof candidate = candidate
  ) =>
    createAflTradeProviderResolutionProposal({
      schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
      resolutionCaseId,
      subjectType: 'provider_player_candidate',
      identityCandidateId: staged.rows[0].identity_candidate_id,
      candidate: candidateOverride,
      proposedTarget: { scope: 'provider_identity', playerIdentityId, assignmentCaseId, playerId },
      alternativePlayerIds: [],
      method,
      staging,
      canonicalTargetSnapshot,
      supportingEvidence: [supportingEvidence],
      proposedAt,
    });
  const proposalA = proposal(
    'afl-player:provider-resolution-a',
    canonicalTargetSnapshotA,
    '2026-08-07T00:02:00.000Z'
  );
  const decisionA = createPlayerResolutionDecision({
    proposal: proposalA,
    expectedRevision: 0,
    supersedesDecisionId: null,
    expectedAssignmentRevision: 0,
    supersedesAssignmentDecisionId: null,
    outcome: 'approved',
    rationale: 'The fixture candidate exactly matches canonical player A.',
    decidedAt: '2026-08-07T00:03:00.000Z',
    reviewerAuthority,
  });
  return {
    repository: new PostgresAflTradeProviderResolutionRepository(
      createPgAflOutcomeSqlClient(outcomesPool)
    ),
    execution: { principalRef, environment: 'test_fixture' as const },
    staging,
    candidate,
    proposal,
    proposalA,
    decisionA,
    canonicalTargetSnapshotA,
    canonicalTargetSnapshotB,
    playerIdentityId,
    assignmentCaseId,
    resolutionCaseId,
    reviewerAuthority,
  };
}

let providerResolutionScenario:
  Awaited<ReturnType<typeof createProviderResolutionScenario>> | undefined;

async function seedProviderNormalizationIssue(
  environment: 'test_fixture' | 'non_production' | 'production',
  marker: string
) {
  const artifactId = `provider-${marker}-issue-artifact`;
  const attemptId = `provider-${marker}-issue-attempt`;
  const captureId = `provider-${marker}-issue-capture`;
  const runId = `provider-${marker}-issue-run`;
  const rowId = `provider-${marker}-issue-row`;
  const issueId = `provider-${marker}-normalization-issue`;
  const sourceRdsSha256 = sha256AflTradeCanonicalJson({ marker, kind: 'source-rds' });
  const decodedSha256 = sha256AflTradeCanonicalJson({ marker, kind: 'decoded' });
  const custodyProfileId =
    environment === 'test_fixture' ? null : `integration-${environment}-raw-v1`;

  await query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
       environment, custody_profile_id, created_at, verified_at, custody_json)
     VALUES ($1, $2, $3, 'application/x-r-rds', 1, 'raw_source', $4,
             $5, '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:01.000Z', '{}'::jsonb)`,
    [
      artifactId,
      sourceRdsSha256,
      `artifact://sha256/${sourceRdsSha256}`,
      environment,
      custodyProfileId,
    ]
  );
  await query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id, environment, provider, dataset, capability_id, status,
       started_at, completed_at, attempt_json)
     VALUES ($1, $2, 'official_afl', 'player_stats', 'official-afl-player-stats', 'captured',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:01.000Z', '{}'::jsonb)`,
    [attemptId, environment]
  );
  await query(
    `INSERT INTO outcome_source_capture
      (capture_id, attempt_id, source_snapshot_id, source_artifact_id, environment, provider,
       dataset, dataset_version, access_mechanism, capability_id, competition,
       anchor_season_year, effective_at, captured_at, status, manifest_json)
     VALUES ($1, $2, $3, $4, $5, 'official_afl', 'player_stats', 'fixture-v1', 'provider_api',
             'official-afl-player-stats', 'AFLM', 2026, '2026-08-07T00:00:00.000Z',
             '2026-08-07T00:00:01.000Z', 'approved',
             '{"capture":{"kind":"fitzroy","packageVersion":"1.7.0"}}'::jsonb)`,
    [captureId, attemptId, `provider-${marker}-issue-snapshot`, artifactId, environment]
  );

  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `INSERT INTO outcome_provider_normalization_run
        (normalization_run_id, capture_id, field_map_id, decoder_version, normalizer_version,
         source_rds_sha256, decoded_sha256, receipt_sha256, staging_sha256, status,
         source_row_count, accepted_row_count, quarantined_row_count, issue_count,
         identity_candidate_count, match_candidate_count, metric_candidate_count,
         achievement_candidate_count, started_at, completed_at, finalized_at, receipt_json)
       VALUES ($1, $2, 'provider-field-map-integration', $3, $4, $5, $6, $7, $8,
               'needs_review', 1, 0, 1, 1, 0, 0, 0, 0,
               '2026-08-07T00:01:00.000Z', '2026-08-07T00:01:01.000Z', NULL,
               $9::jsonb)`,
      [
        runId,
        captureId,
        `${marker}-decoder/v1`,
        `${marker}-normalizer/v1`,
        sourceRdsSha256,
        decodedSha256,
        sha256AflTradeCanonicalJson({ marker, kind: 'receipt' }),
        sha256AflTradeCanonicalJson({ marker, kind: 'staging' }),
        JSON.stringify({
          normalizerVersion: `${marker}-normalizer/v1`,
          decodedSha256,
          sourceRdsSha256,
          sourceRowCount: 1,
          acceptedRowCount: 0,
          quarantinedRowCount: 1,
          issueCount: 1,
        }),
      ]
    );
    await connection.query(
      `INSERT INTO outcome_provider_decoded_row
        (provider_decoded_row_id, normalization_run_id, capture_id, competition, season_year,
         source_row_number, source_row_sha256, row_status, typed_payload, recorded_at)
       VALUES ($1, $2, $3, 'AFLM', 2026, 1, $4, 'needs_review', '{}'::jsonb,
               '2026-08-07T00:01:01.000Z')`,
      [rowId, runId, captureId, sha256AflTradeCanonicalJson({ marker, kind: 'source-row' })]
    );
    await connection.query(
      `INSERT INTO outcome_provider_normalization_issue
        (issue_id, normalization_run_id, source_row_number, issue_code, source_field,
         details_json, detected_at)
       VALUES ($1, $2, 1, 'identity_ambiguous', 'player_name', '{}'::jsonb,
               '2026-08-07T00:01:01.000Z')`,
      [issueId, runId]
    );
    await connection.query(
      `UPDATE outcome_provider_normalization_run
          SET finalized_at='2026-08-07T00:01:01.000Z'
        WHERE normalization_run_id=$1`,
      [runId]
    );
    await connection.query('COMMIT');
  } finally {
    await connection.query('ROLLBACK').catch(() => undefined);
    connection.release();
  }
  return issueId;
}

async function waitForAdvisoryLockWait(processId: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
          WHERE pid = $1 AND locktype = 'advisory' AND granted = false
       ) AS waiting`,
      [processId]
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Child insert did not reach the release advisory-lock barrier.');
}

function createBarrieredOutcomeSqlClient(
  client: AflOutcomeSqlClient,
  afterHeadLoad: () => Promise<void>,
  beforeHeadLock: () => Promise<void>
): AflOutcomeSqlClient {
  return {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      const result = await client.query<Row>(sql, parameters);
      if (sql.includes('FROM outcome_registry_head') && !sql.includes('FOR UPDATE')) {
        await afterHeadLoad();
      }
      return result;
    },
    transaction(work) {
      return client.transaction((transaction) =>
        work({
          async query<Row>(sql: string, parameters?: readonly unknown[]) {
            if (sql.includes('FROM outcome_registry_head') && sql.includes('FOR UPDATE')) {
              await beforeHeadLock();
            }
            return transaction.query<Row>(sql, parameters);
          },
        })
      );
    },
  };
}

const releaseId = `outcome-release:${'a'.repeat(64)}`;
const projectionId = `outcome-projection:${'b'.repeat(64)}`;
const secondProjectionId = `outcome-projection:${'c'.repeat(64)}`;

async function seedNormalizedEventRelease(
  suffix: string,
  options: {
    competition?: string;
    seasonYear?: number;
    effectiveThrough?: string;
    createdAt?: string;
  } = {}
) {
  const competition = options.competition ?? 'AFL';
  const seasonYear = options.seasonYear ?? 2025;
  const effectiveThrough = options.effectiveThrough ?? '2025-12-31T23:59:59Z';
  const createdAt = options.createdAt ?? '2026-01-01T00:00:00Z';
  const ids = {
    releaseId: `outcome-release:${sha256AflTradeCanonicalJson({ fixture: 'normalized-event-release', suffix })}`,
    artifactId: `artifact-${suffix}`,
    attemptId: `attempt-${suffix}`,
    captureId: `capture-${suffix}`,
    importRunId: `import-run-${suffix}`,
    eventId: `event-${suffix}`,
    eventVersionId: `event-version-${suffix}`,
    assetVersionId: `asset-${suffix}`,
    playerId: `player-${suffix}`,
    identityId: `identity-${suffix}`,
    identityAssignmentId: `identity-assignment-${suffix}`,
    reviewDecisionId: `review-decision-${suffix}`,
    fromClubId: `club-from-${suffix}`,
    toClubId: `club-to-${suffix}`,
    parentRowId: `row-parent-${suffix}`,
    fromPartyRowId: `row-party-from-${suffix}`,
    toPartyRowId: `row-party-to-${suffix}`,
    assetRowId: `row-asset-${suffix}`,
    lateAssetRowId: `row-late-asset-${suffix}`,
  };
  const contentSha256 = sha256AflTradeCanonicalJson({
    fixture: 'normalized-event-artifact',
    suffix,
  });
  await query(
    `INSERT INTO outcome_release_manifest
      (release_id, scope_key, environment, created_at, effective_through, manifest_json)
     VALUES ($1, 'public-afl-draft-trade-outcomes', 'test_fixture', $2, $3, '{}'::jsonb)`,
    [ids.releaseId, createdAt, effectiveThrough]
  );
  await query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
       environment, created_at, verified_at, custody_json)
     VALUES ($1, $2, $3, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             1, 'raw_source', 'test_fixture', '2025-01-01T00:00:00Z',
             '2025-01-01T00:00:01Z', '{}'::jsonb)`,
    [ids.artifactId, contentSha256, `artifact://sha256/${contentSha256}`]
  );
  await query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id, environment, provider, dataset, status, started_at, completed_at, attempt_json)
     VALUES ($1, 'test_fixture', 'fixture-workbook', 'annual-and-trades', 'captured',
             '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z', '{}'::jsonb)`,
    [ids.attemptId]
  );
  await query(
    `INSERT INTO outcome_competition_season (competition, season_year)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [competition, seasonYear]
  );
  await query(
    `INSERT INTO outcome_source_capture
      (capture_id, attempt_id, source_snapshot_id, source_artifact_id, environment, provider,
       dataset, dataset_version, access_mechanism, competition, anchor_season_year, effective_at,
       captured_at, status, manifest_json)
     VALUES ($1, $2, $3, $4, 'test_fixture', 'fixture-workbook', 'annual-and-trades', 'v1',
             'operator_import', $5, $6, '2025-01-01T00:00:00Z',
             '2025-01-01T00:00:01Z', 'approved', '{}'::jsonb)`,
    [ids.captureId, ids.attemptId, `snapshot-${suffix}`, ids.artifactId, competition, seasonYear]
  );
  await query(
    `INSERT INTO outcome_import_run
      (import_run_id, capture_id, import_kind, parser_version, started_at, completed_at, status, manifest_json)
     VALUES ($1, $2, 'workbook', 'v1', '2025-01-01T00:01:00Z',
             '2025-01-01T00:02:00Z', 'approved', '{}'::jsonb)`,
    [ids.importRunId, ids.captureId]
  );
  const importRows = [
    ids.parentRowId,
    ids.fromPartyRowId,
    ids.toPartyRowId,
    ids.assetRowId,
    ids.lateAssetRowId,
  ];
  for (const [ordinal, importRowId] of importRows.entries()) {
    await query(
      `INSERT INTO outcome_import_row
        (import_row_id, import_run_id, source_locator, source_ordinal, record_kind,
         row_sha256, parse_status, raw_payload, recorded_at)
       VALUES ($1, $2, $3, $4, 'fixture', $5, 'approved', '{}'::jsonb,
               '2025-01-01T00:02:00Z')`,
      [importRowId, ids.importRunId, `Fixture!A${ordinal + 1}`, ordinal, contentSha256]
    );
  }
  await query(
    `INSERT INTO outcome_import_partition
      (import_partition_id, import_run_id, partition_key, partition_kind, competition,
       season_year, row_count, rows_sha256, partition_json)
     VALUES ($1, $2, $3, 'workbook_trade_ledger', $4, $5, $6, $7, '{}'::jsonb)`,
    [
      `partition-${suffix}`,
      ids.importRunId,
      `fixture-events:${seasonYear}`,
      competition,
      seasonYear,
      importRows.length,
      contentSha256,
    ]
  );
  for (const [ordinal, importRowId] of importRows.entries()) {
    await query(
      `INSERT INTO outcome_import_partition_row
        (import_partition_id, import_row_id, import_run_id, ordinal)
       VALUES ($1, $2, $3, $4)`,
      [`partition-${suffix}`, importRowId, ids.importRunId, ordinal]
    );
  }
  for (const [clubId, name] of [
    [ids.fromClubId, 'Fixture From'],
    [ids.toClubId, 'Fixture To'],
  ]) {
    await query(
      `INSERT INTO outcome_club (club_id, current_name, status) VALUES ($1, $2, 'approved')`,
      [clubId, name]
    );
  }
  await query(
    `INSERT INTO outcome_player (player_id, display_name, status)
     VALUES ($1, 'Fixture Player', 'approved')`,
    [ids.playerId]
  );
  await query(
    `INSERT INTO outcome_player_identity
      (identity_id, capture_id, provider, native_player_id, recorded_name, identity_sha256,
       first_observed_at)
     VALUES ($1, $2, 'fixture-workbook', $3, 'Fixture Player', $4,
             '2025-01-01T00:00:00Z')`,
    [ids.identityId, ids.captureId, `fixture-player-${suffix}`, contentSha256]
  );
  await query(
    `INSERT INTO outcome_review_decision
      (decision_id, subject_type, subject_id, decision, canonical_record_type,
       canonical_record_id, rationale, evidence_json, decided_by, decided_at)
     VALUES ($1, 'player_identity', $2, 'assign', 'player', $3,
             'Fixture reviewed identity', '{}'::jsonb, 'fixture-reviewer',
             '2025-01-01T00:03:00Z')`,
    [ids.reviewDecisionId, ids.identityId, ids.playerId]
  );
  await query(
    `INSERT INTO outcome_player_identity_assignment
      (assignment_id, identity_id, player_id, version, status, decision_id, effective_at, recorded_at)
     VALUES ($1, $2, $3, 1, 'approved', $4, '2025-01-01T00:03:00Z',
             '2025-01-01T00:03:00Z')`,
    [ids.identityAssignmentId, ids.identityId, ids.playerId, ids.reviewDecisionId]
  );
  await query(
    `INSERT INTO outcome_event (event_id, competition, season_year, stable_key)
     VALUES ($1, $2, $3, $4)`,
    [ids.eventId, competition, seasonYear, `fixture-trade-${suffix}`]
  );
  await query(
    `INSERT INTO outcome_event_version
      (event_version_id, event_id, version, kind, acquisition_mechanism, event_date,
       official_name, status, source_import_row_id, recorded_at)
     VALUES ($1, $2, 1, 'trade', 'trade', '2025-10-01', 'Fixture Trade', 'approved',
             $3, '2025-10-02T00:00:00Z')`,
    [ids.eventVersionId, ids.eventId, ids.parentRowId]
  );
  await query(
    `INSERT INTO outcome_event_party
      (event_version_id, club_id, source_import_row_id, role, ordinal)
     VALUES ($1, $2, $3, 'party', 1), ($1, $4, $5, 'party', 2)`,
    [ids.eventVersionId, ids.fromClubId, ids.fromPartyRowId, ids.toClubId, ids.toPartyRowId]
  );
  await query(
    `INSERT INTO outcome_event_asset
      (asset_version_id, event_version_id, asset_key, kind, player_id, player_identity_id, from_club_id,
       to_club_id, source_import_row_id, raw_description, status)
     VALUES ($1, $2, 'player-1', 'player', $3, $4, $5, $6, $7, 'Fixture Player', 'approved')`,
    [
      ids.assetVersionId,
      ids.eventVersionId,
      ids.playerId,
      ids.identityId,
      ids.fromClubId,
      ids.toClubId,
      ids.assetRowId,
    ]
  );
  await query(
    `INSERT INTO outcome_release_source_capture
      (release_id, capture_id, ordinal, record_sha256, membership_json)
     VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
    [ids.releaseId, ids.captureId, contentSha256]
  );
  await query(
    `INSERT INTO outcome_release_review_decision
      (release_id, decision_id, ordinal, record_sha256, membership_json)
     VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
    [ids.releaseId, ids.reviewDecisionId, contentSha256]
  );
  await query(
    `INSERT INTO outcome_release_identity_assignment
      (release_id, assignment_id, ordinal, record_sha256, membership_json)
     VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
    [ids.releaseId, ids.identityAssignmentId, contentSha256]
  );
  return ids;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  deployOutcomeMigrations(schemaName);
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('isolated AFL outcomes PostgreSQL migration', () => {
  it('deploys the complete ordered migration history and has no structural datamodel drift', () => {
    const applied = runOutcomesPrismaTestCommand(
      [
        'migrate',
        'diff',
        '--from-schema-datasource',
        OUTCOMES_PRISMA_SCHEMA_PATH,
        '--to-schema-datamodel',
        OUTCOMES_PRISMA_SCHEMA_PATH,
        '--script',
      ],
      {
        appendSchemaArgument: false,
        databaseUrl: scopedDatabaseUrl(schemaName),
      }
    );
    expect(applied).not.toMatch(/(?:CREATE|DROP)\s+(?:TABLE|TYPE)|(?:ADD|DROP|ALTER)\s+COLUMN/i);
  });

  it('records both forward migrations and native authority controls', async () => {
    const migrations = await query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'
    );
    expect(migrations.rows.map(({ migration_name }) => migration_name)).toEqual([
      '0001_factual_release_registry',
      '0002_normalized_analytical_authority',
      '0003_provider_observation_staging',
      '0004_governed_provider_resolution',
      '0005_factual_observations',
      '0006_reconciled_achievements',
      '0007_factual_release_v2_candidate',
      '0008_sealed_factual_projection_items',
      '0009_public_runtime_authority',
      '0010_external_draft_trade_staging',
      '0011_external_reconciliation_candidate',
      '0012_external_capture_scheduling',
      '0013_external_capture_circuit_threshold',
      '0014_external_candidate_promotion',
      '0015_external_trade_discovery',
      '0016_external_historical_capture_completion',
      '0017_external_reconciliation_source_authority',
      '0018_external_identity_review_authority',
      '0019_external_canonical_promotion_review',
      '0020_promotion_backed_corpus',
      '0021_promotion_backed_factual_release',
      '0022_promotion_backed_gate2_admission',
      '0023_promotion_backed_public_archive',
      '0024_external_promotion_content_digest',
      '0025_external_canonical_fixture_identity_scope',
      '0026_promotion_backed_corpus_content_digest',
      '0027_release_external_identity_provenance',
      '0028_gate2_corpus_scope_columns',
      '0029_event_party_positive_ordinal',
      '0030_valuation_dataset_admission',
      '0031_durable_model_run_authority',
      '0032_hpn_pav_input_authority',
      '0033_hpn_pav_calculation_authority',
      '0034_pick_pav_observation_authority',
      '0035_external_capture_dispatch_cursor',
      '0036_valuation_output_custody_authority',
      '0037_valuation_publication_custody_index',
      '0038_restore_operational_authority_role_union',
      '0038_valuation_publication_preparation',
      '0039_public_projection_release_chronology',
      '0040_valuation_publication_gate_currentness',
      '0041_valuation_publication_post_lock_time',
      '0042_pick_pav_model_execution_registry',
      '0043_external_identity_clock_skew_tolerance',
      '0044_governed_provider_release_membership',
      '0045_fixture_filesystem_custody_assurance',
      '0046_local_nonproduction_capture_custody',
      '0047_review_decision_current_set_lookup',
      '0048_prepared_valuation_input_sets',
      '0049_workbook_transaction_reviews',
      '0050_private_valuation_evaluation_authority',
      '0051_private_reviewed_evidence_evaluation',
      '0052_hpn_projected_field_map_authority',
      '0053_hpn_reviewed_season_universe',
      '0054_private_reviewed_hpn_calculation',
      '0055_private_reviewed_evidence_currentness',
      '0056_local_workbook_player_identity_review',
      '0057_local_workbook_player_identity_authority',
      '0058_governed_private_evaluation_lifecycle',
      '0059_authenticated_prepared_valuation_inputs',
      '0060_materialization_manifest_prepared_inputs',
      '0061_governed_valuation_component_runs',
      '0062_authenticated_prepared_v3_ancestry',
      '0063_governed_pick_pav_model_execution',
      '0064_automated_model_pair_qualification',
      '0065_automated_private_evaluation_authority',
      '0066_atomic_private_evaluation_batches',
      '0067_private_evaluation_cohort_runner',
      '0068_durable_private_evaluation_execution',
      '0069_private_valuation_dispatch',
      '0070_private_valuation_dispatch_custody',
      '0071_private_valuation_capture_binding',
      '0072_private_valuation_factual_output',
      '0073_automated_nonproduction_source_admission',
      '0074_bind_factual_output_to_source_admission',
      '0075_versioned_release_acquisition_spell_eligibility',
      '0076_role_aware_private_valuation_capture_binding',
      '0077_projected_hpn_pav_input_authority',
      '0078_private_valuation_hpn_source_admission',
    ]);

    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name LIKE 'outcome_%'`
    );
    const tableNames = new Set(tables.rows.map(({ table_name }) => table_name));
    for (const expected of [
      'outcome_artifact_custody',
      'outcome_current_valuation_cohort_operation',
      'outcome_current_valuation_cohort_operation_result',
      'outcome_governed_pick_pav_model_execution',
      'outcome_source_capture_attempt',
      'outcome_source_capture_season',
      'outcome_import_row',
      'outcome_import_partition',
      'outcome_import_partition_row',
      'outcome_player_identity_assignment',
      'outcome_player_stat_observation',
      'outcome_event_version',
      'outcome_event_asset',
      'outcome_pick_lineage_edge',
      'outcome_acquisition_spell_version',
      'outcome_release_event_version',
      'outcome_release_stat_observation',
      'outcome_provider_normalization_run',
      'outcome_provider_decoded_row',
      'outcome_provider_identity_candidate',
      'outcome_provider_match_candidate',
      'outcome_provider_metric_candidate',
      'outcome_provider_native_id_namespace',
      'outcome_provider_resolution_proposal',
      'outcome_provider_player_resolution',
      'outcome_provider_fact_batch',
      'outcome_reconciled_factual_metric',
      'outcome_reconciled_achievement',
      'outcome_acquisition_spell_metric_version',
      'outcome_factual_release_candidate',
      'outcome_factual_projection_item_set',
      'outcome_external_evidence_batch',
      'outcome_external_reconciliation_candidate',
      'outcome_external_capture_schedule',
      'outcome_external_canonical_promotion',
      'outcome_external_trade_discovery_inventory',
      'outcome_external_trade_discovery_link',
      'outcome_external_historical_capture_plan',
      'outcome_external_historical_capture_target',
      'outcome_external_historical_capture_completion',
      'outcome_external_historical_capture_completion_result',
      'outcome_external_identity_subject',
      'outcome_external_identity_review_decision',
      'outcome_external_identity_resolution_head',
      'outcome_external_canonical_promotion_review_decision',
      'outcome_external_canonical_promotion_review_head',
      'outcome_pick_custody_observation',
      'outcome_pick_realization',
      'outcome_promotion_backed_corpus',
      'outcome_promotion_backed_corpus_promotion',
      'outcome_promotion_backed_corpus_member',
      'outcome_release_event_asset',
      'outcome_release_draft_selection',
      'outcome_release_pick_custody',
      'outcome_release_pick_realization',
      'outcome_corpus_factual_lineage',
      'outcome_corpus_factual_lineage_admission',
      'outcome_public_factual_archive',
      'outcome_public_factual_archive_record',
      'outcome_valuation_output_custody_index',
      'outcome_valuation_output_custody_index_entry',
      'outcome_prepared_valuation_input_set',
      'outcome_prepared_valuation_input_entry',
      'outcome_workbook_transaction_review_set',
      'outcome_workbook_transaction_review_subject',
      'outcome_workbook_transaction_review_decision',
      'outcome_workbook_transaction_review_head',
      'outcome_private_reviewed_evidence_bundle',
      'outcome_private_reviewed_evaluation_decision',
      'outcome_private_reviewed_evaluation_head',
      'outcome_hpn_field_map_candidate',
      'outcome_hpn_field_map_review_decision',
      'outcome_hpn_projected_field_map',
      'outcome_hpn_reviewed_season_universe',
      'outcome_hpn_reviewed_season_member',
      'outcome_private_reviewed_hpn_method',
      'outcome_private_reviewed_hpn_calculation',
      'outcome_private_reviewed_hpn_team',
      'outcome_private_reviewed_hpn_allocation',
      'outcome_local_workbook_player_identity_review',
    ]) {
      expect(tableNames).toContain(expected);
    }

    const triggers = await query<{ trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = current_schema()`
    );
    const triggerNames = new Set(triggers.rows.map(({ trigger_name }) => trigger_name));
    for (const expected of [
      'outcome_registry_event_chain_integrity',
      'outcome_active_release_exact_activation',
      'outcome_source_capture_custody_integrity',
      'outcome_source_capture_anchor_scope',
      'outcome_source_capture_season_insert_guard',
      'outcome_import_run_capture_scope_lock',
      'outcome_import_partition_scope_integrity',
      'outcome_event_version_chain_integrity',
      'outcome_release_event_version_eligibility',
      'outcome_release_event_version_registered_release_guard',
      'outcome_release_event_version_append_only',
      'outcome_event_asset_released_parent_insert_guard',
      'outcome_player_stat_metric_released_parent_insert_guard',
      'outcome_provider_normalization_finalize_validate',
      'outcome_provider_decoded_row_finalized_parent_guard',
      'outcome_provider_governance_requires_role',
      'outcome_provider_review_requires_typed_resolution',
      'validate_outcome_provider_fact_batch_trigger',
      'validate_outcome_achievement_run_trigger',
      'validate_outcome_factual_release_candidate_v3_trigger',
      'validate_outcome_factual_projection_item_insert_trigger',
      'validate_outcome_factual_projection_item_set_insert_trigger',
      'ab_validate_outcome_factual_projection_item_set_event',
      'outcome_external_canonical_promotion_insert_guard',
      'outcome_external_canonical_promotion_finalization_guard',
      'outcome_pick_realization_insert_guard',
      'outcome_external_discovery_inventory_finalize_guard',
      'outcome_external_historical_plan_finalize_guard',
      'outcome_external_historical_target_insert_guard',
      'outcome_external_historical_completion_insert_guard',
      'outcome_external_historical_completion_result_insert_guard',
      'outcome_external_historical_completion_finalize_guard',
      'outcome_external_identity_review_insert_guard',
      'outcome_external_identity_review_requires_typed_decision',
      'outcome_external_identity_head_write_guard',
      'outcome_external_promotion_review_insert_guard',
      'outcome_external_promotion_review_requires_typed_decision',
      'outcome_external_promotion_review_head_write_guard',
      'outcome_external_canonical_promotion_current_review_guard',
      'outcome_promotion_backed_corpus_finalization_guard',
      'validate_outcome_promotion_factual_candidate_trigger',
      'outcome_corpus_factual_lineage_validate_insert',
      'outcome_corpus_factual_lineage_append_only',
      'outcome_corpus_factual_lineage_admission_validate_insert',
      'outcome_corpus_factual_lineage_admission_append_only',
      'outcome_public_factual_archive_validate_insert',
      'outcome_public_factual_archive_record_validate_insert',
      'outcome_public_factual_archive_record_append_only',
      'outcome_public_factual_archive_finalize',
      'outcome_public_factual_archive_delete_reject',
      'outcome_projection_manifest_promotion_archive_validate',
      'aa_validate_outcome_factual_release_registry_event',
      'outcome_prepared_valuation_input_set_validate_insert',
      'outcome_prepared_valuation_input_entry_validate_insert',
      'outcome_prepared_valuation_input_set_finalize',
      'outcome_prepared_valuation_input_entry_append_only',
      'outcome_private_reviewed_evidence_bundle_insert_guard',
      'outcome_private_reviewed_evaluation_decision_insert_guard',
      'outcome_private_reviewed_evaluation_head_write_guard',
      'outcome_private_reviewed_evidence_bundle_mutation_guard',
      'outcome_private_reviewed_evaluation_decision_mutation_guard',
      'outcome_private_reviewed_evaluation_head_delete_guard',
    ]) {
      expect(triggerNames).toContain(expected);
    }

    const constraints = await query<{ constraint_name: string }>(
      `SELECT conname AS constraint_name
         FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace`
    );
    const constraintNames = new Set(constraints.rows.map(({ constraint_name }) => constraint_name));
    for (const expected of [
      'outcome_registry_head_exact_event_fkey',
      'outcome_active_release_exact_event_fkey',
      'outcome_player_metric_availability_check',
      'outcome_event_asset_typed_payload_check',
      'outcome_match_id_season_key',
      'outcome_player_stat_observation_match_id_competition_seaso_fkey',
      'outcome_player_stat_observation_capture_scope_fkey',
      'outcome_source_capture_anchor_season_fkey',
      'outcome_acquisition_spell_metric_coverage_check',
      'outcome_provider_normalization_finalized_check',
      'outcome_prepared_valuation_input_set_identity_check',
      'outcome_prepared_valuation_input_entry_trade_key',
    ]) {
      expect(constraintNames).toContain(expected);
    }

    const indexes = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`
    );
    const indexNames = new Set(indexes.rows.map(({ indexname }) => indexname));
    for (const expected of [
      'outcome_match_id_season_key',
      'outcome_player_observation_capture_native_key',
      'outcome_event_version_event_version_key',
      'outcome_capture_season_scope_idx',
      'outcome_import_partition_season_kind_idx',
      'outcome_projection_item_release_event_idx',
      'outcome_projection_item_release_search_idx',
      'outcome_projection_item_release_club_id_folded_idx',
      'outcome_projection_item_release_club_name_folded_idx',
    ]) {
      expect(indexNames).toContain(expected);
    }
  });

  it('admits fixture-filesystem custody only for unprofiled test-fixture operations', async () => {
    const connection = await outcomesPool.connect();
    const insertOperation = (
      suffix: string,
      environment: 'test_fixture' | 'non_production',
      custodyProfileId: string | null
    ) =>
      connection.query(
        `INSERT INTO outcome_valuation_output_custody_operation
          (operation_id,environment,valuation_output_inventory_id,output_set_sha256,
           repository_assurance,custody_profile_id,artifact_count,verified_at,
           operation_content_canonical_json,operation_canonical_json,operation_json,status)
         VALUES ($1,$2,$3,$4,'fixture_filesystem',$5,1,clock_timestamp(),
                 '{}'::text,'{}'::text,'{}'::jsonb,'open')`,
        [
          `valuation-output-custody-operation:${suffix.repeat(64)}`,
          environment,
          `valuation-output-inventory:${suffix.repeat(64)}`,
          suffix.repeat(64),
          custodyProfileId,
        ]
      );
    try {
      await connection.query('BEGIN');
      await connection.query('SET LOCAL session_replication_role = replica');
      await insertOperation('a', 'test_fixture', null);

      await connection.query('SAVEPOINT non_fixture');
      await expect(insertOperation('b', 'non_production', null)).rejects.toThrow(
        /outcome_valuation_output_custody_shape_check/i
      );
      await connection.query('ROLLBACK TO SAVEPOINT non_fixture');

      await connection.query('SAVEPOINT profiled_fixture');
      await expect(
        insertOperation('c', 'test_fixture', `artifact-custody-profile:${'d'.repeat(64)}`)
      ).rejects.toThrow(/outcome_valuation_output_custody_shape_check/i);
      await connection.query('ROLLBACK TO SAVEPOINT profiled_fixture');
      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  });

  it('seals factual projection rows and admits validate, approve, and activate evidence', async () => {
    const connection = await outcomesPool.connect();
    const suffix = '8'.repeat(64);
    const factualReleaseId = `outcome-release:${suffix}`;
    const factualProjectionId = `outcome-projection:${'9'.repeat(64)}`;
    const candidateSha256 = 'a'.repeat(64);
    const candidateId = `factual-release-candidate:${candidateSha256}`;
    const sourceMemberSetSha256 = 'b'.repeat(64);
    const candidateFinalizedAt = '2026-01-02T00:00:00.000Z';
    const projectionCreatedAt = '2026-01-02T00:01:00.000Z';
    const itemSetFinalizedAt = '2026-01-02T00:02:00.000Z';
    const releaseManifest = {
      releaseId: factualReleaseId,
      content: {
        schemaVersion: 'afl-draft-trade-outcome-release/v2',
        sourceMemberSetSha256,
      },
    };
    const candidateJson = {
      schemaVersion: 'afl-trade-factual-release-candidate/v3',
      publicationEligible: false,
      targetRelease: { id: factualReleaseId },
      targetReleaseManifest: releaseManifest,
      memberSetSha256: sourceMemberSetSha256,
    };
    const memberCounts = {
      sourceCaptures: 0,
      eventVersions: 0,
      lineageEdges: 0,
      acquisitionSpells: 0,
      reviewDecisions: 0,
      factualRuns: 0,
      reconciledMetrics: 0,
      achievementRuns: 0,
      reconciledAchievements: 0,
      spellMetrics: 0,
    };
    const publicItem = aflDraftTradeOutcomeListItemSchema.parse({
      eventId: 'event:postgres-sealed-projection',
      tradeId: null,
      assetId: 'asset:postgres-sealed-projection',
      year: 2025,
      acquisitionType: 'National Draft',
      aflClubId: 'club:postgres-sealed-projection',
      clubName: 'PostgreSQL Fixture Club',
      player: {
        aflPlayerId: 'player:postgres-sealed-projection',
        displayName: 'PostgreSQL Fixture Player',
        identityStatus: 'resolved',
      },
      checks: [],
      achievements: [],
    });
    const publicItemSet = createAflTradeFactualProjectionItemSet([
      { ordinal: 0, itemKey: 'postgres-sealed-item', item: publicItem },
    ]);
    const projectionManifest = {
      projectionId: factualProjectionId,
      content: {
        schemaVersion: 'afl-draft-trade-outcome-projection/v2',
        releaseId: factualReleaseId,
        factualCandidateId: candidateId,
        sourceMemberSetSha256,
        publicListItemSetSha256: publicItemSet.itemSetSha256,
        documentCount: publicItemSet.itemCount,
        createdAt: projectionCreatedAt,
      },
    };
    const canonicalItem = canonicalizeAflTradeJson(publicItem);
    const searchText = [
      publicItem.eventId,
      publicItem.tradeId,
      publicItem.assetId,
      publicItem.acquisitionType,
      publicItem.aflClubId,
      publicItem.clubName,
      publicItem.player.aflPlayerId,
      publicItem.player.displayName,
    ]
      .filter((value): value is string => value !== null)
      .join(' ');

    try {
      await connection.query(
        `INSERT INTO outcome_release_manifest
          (release_id, scope_key, environment, created_at, effective_through, manifest_json)
         VALUES ($1, 'public-afl-draft-trade-outcomes', 'test_fixture', $2,
                 '2025-12-31T23:59:59.000Z', $3::jsonb)`,
        [factualReleaseId, candidateFinalizedAt, canonicalizeAflTradeJson(releaseManifest)]
      );
      await connection.query(
        `INSERT INTO outcome_factual_release_candidate
          (candidate_id, candidate_sha256, target_release_id, environment, scope_key, competition,
           valid_from_season, valid_through_season, effective_through, member_set_sha256, status,
           member_counts_json, candidate_json, created_at, finalized_at)
         VALUES ($1,$2,$3,'test_fixture','public-afl-draft-trade-outcomes','AFL',2025,2025,
                 '2025-12-31T23:59:59.000Z',$4,'staged',$5::jsonb,$6::jsonb,$7,NULL)`,
        [
          candidateId,
          candidateSha256,
          factualReleaseId,
          sourceMemberSetSha256,
          canonicalizeAflTradeJson(memberCounts),
          canonicalizeAflTradeJson(candidateJson),
          candidateFinalizedAt,
        ]
      );
      await connection.query(
        `UPDATE outcome_factual_release_candidate
            SET status='approved', finalized_at=$2
          WHERE candidate_id=$1`,
        [candidateId, candidateFinalizedAt]
      );
      await connection.query(
        `INSERT INTO outcome_projection_manifest
          (projection_id, release_id, created_at, manifest_json)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [
          factualProjectionId,
          factualReleaseId,
          projectionCreatedAt,
          canonicalizeAflTradeJson(projectionManifest),
        ]
      );
      await connection.query(
        `INSERT INTO outcome_projection_item
          (release_id,projection_id,ordinal,item_key,event_id,trade_id,asset_id,year,afl_club_id,
           club_name,player_name,search_text,metric_codes,status_codes,item_json,item_canonical_json,
           item_sha256)
         VALUES ($1,$2,0,'postgres-sealed-item',$3,NULL,$4,$5,$6,$7,$8,$9,ARRAY[]::TEXT[],
                 ARRAY[]::TEXT[],$10::jsonb,$11,$12)`,
        [
          factualReleaseId,
          factualProjectionId,
          publicItem.eventId,
          publicItem.assetId,
          publicItem.year,
          publicItem.aflClubId,
          publicItem.clubName,
          publicItem.player.displayName,
          searchText,
          canonicalItem,
          canonicalItem,
          sha256AflTradeCanonicalJson(publicItem),
        ]
      );
      const prefixSearch = await connection.query<{ matched: number }>(
        `SELECT count(*)::INTEGER AS matched
           FROM outcome_projection_item item
          WHERE item.release_id=$1 AND item.projection_id=$2
            AND to_tsvector('simple', item.search_text) @@ to_tsquery('simple', $3)`,
        [factualReleaseId, factualProjectionId, 'postgres:* & fixt:*']
      );
      expect(prefixSearch.rows[0]?.matched).toBe(1);

      await expect(
        connection.query(
          `INSERT INTO outcome_factual_projection_item_set
            (projection_id,release_id,item_count,item_set_sha256,finalized_at)
           VALUES ($1,$2,1,$3,$4)`,
          [factualProjectionId, factualReleaseId, 'c'.repeat(64), itemSetFinalizedAt]
        )
      ).rejects.toThrow(/count or digest mismatch/i);
      await connection.query(
        `INSERT INTO outcome_factual_projection_item_set
          (projection_id,release_id,item_count,item_set_sha256,finalized_at)
         VALUES ($1,$2,1,$3,$4)`,
        [factualProjectionId, factualReleaseId, publicItemSet.itemSetSha256, itemSetFinalizedAt]
      );

      await connection.query(
        `CREATE TEMP TABLE factual_projection_event_probe (
           action TEXT NOT NULL, release_id TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
           event_json JSONB NOT NULL
         ) ON COMMIT PRESERVE ROWS`
      );
      await connection.query(
        `CREATE TRIGGER factual_projection_event_probe_trigger
         BEFORE INSERT ON factual_projection_event_probe
         FOR EACH ROW EXECUTE FUNCTION validate_outcome_factual_projection_item_set_event()`
      );
      const affectedState = canonicalizeAflTradeJson({
        content: {
          affectedRecordStates: [
            {
              releaseId: factualReleaseId,
              recordState: { projectionManifest },
            },
          ],
        },
      });
      for (const [index, action] of ['validate', 'approve', 'activate'].entries()) {
        await connection.query(
          `INSERT INTO factual_projection_event_probe(action,release_id,occurred_at,event_json)
           VALUES ($1,$2,$3,$4::jsonb)`,
          [action, factualReleaseId, `2026-01-02T00:0${index + 3}:00.000Z`, affectedState]
        );
      }
      await expect(
        connection.query(
          `INSERT INTO outcome_projection_item
            (release_id,projection_id,ordinal,item_key,event_id,asset_id,year,afl_club_id,club_name,
             player_name,search_text,metric_codes,status_codes,item_json,item_canonical_json,item_sha256)
           VALUES ($1,$2,1,'late-item',$3,$4,$5,$6,$7,$8,$9,ARRAY[]::TEXT[],ARRAY[]::TEXT[],
                   $10::jsonb,$11,$12)`,
          [
            factualReleaseId,
            factualProjectionId,
            publicItem.eventId,
            publicItem.assetId,
            publicItem.year,
            publicItem.aflClubId,
            publicItem.clubName,
            publicItem.player.displayName,
            searchText,
            canonicalItem,
            canonicalItem,
            sha256AflTradeCanonicalJson(publicItem),
          ]
        )
      ).rejects.toThrow(/immutable/i);
    } finally {
      await connection.query('DROP TABLE IF EXISTS factual_projection_event_probe');
      connection.release();
    }
  });

  it('reapplying the complete migration history is a no-op', () => {
    expect(() => deployOutcomeMigrations(schemaName)).not.toThrow();
  });

  it('backfills populated legacy match keys and permanently freezes the migration bridge', async () => {
    const upgradeSchemaName = `${schemaName}_legacy_upgrade`;
    await adminPool.query(`CREATE SCHEMA "${upgradeSchemaName}"`);
    const upgradePool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${upgradeSchemaName}`,
    });
    const upgradeConnection = await upgradePool.connect();
    const migrations = [
      '0001_factual_release_registry',
      '0002_normalized_analytical_authority',
      '0003_provider_observation_staging',
      '0004_governed_provider_resolution',
    ];
    try {
      await upgradeConnection.query(`SET search_path TO "${upgradeSchemaName}"`);
      for (const migrationName of migrations.slice(0, 3)) {
        await upgradeConnection.query(
          readFileSync(
            join(
              process.cwd(),
              'prisma',
              'afl-trade-outcomes',
              'migrations',
              migrationName,
              'migration.sql'
            ),
            'utf8'
          )
        );
      }
      await upgradeConnection.query(
        `INSERT INTO outcome_competition_season (competition, season_year)
         VALUES ('AFLM', 2026);
         INSERT INTO outcome_club (club_id, current_name, status)
         VALUES ('legacy-club-home', 'Legacy Home', 'approved'),
                ('legacy-club-away', 'Legacy Away', 'approved');
         INSERT INTO outcome_match
          (match_id, competition, season_year, provider, native_match_id, round_label,
           match_date, home_club_id, away_club_id)
         VALUES ('legacy-match-integration', 'AFLM', 2026, 'legacy-provider',
                 'legacy-native-match', 'Round 1', '2026-03-20T08:00:00.000Z',
                 'legacy-club-home', 'legacy-club-away')`
      );
      await upgradeConnection.query(
        readFileSync(
          join(
            process.cwd(),
            'prisma',
            'afl-trade-outcomes',
            'migrations',
            migrations[3],
            'migration.sql'
          ),
          'utf8'
        )
      );

      const migrated = await upgradeConnection.query<{
        provider: string | null;
        native_match_id: string | null;
        legacy_provider: string;
        legacy_native_match_id: string;
      }>(
        `SELECT match.provider, match.native_match_id,
                legacy.provider AS legacy_provider,
                legacy.native_match_id AS legacy_native_match_id
           FROM outcome_match match
           JOIN outcome_legacy_match_provider_key legacy USING (match_id)
          WHERE match.match_id = 'legacy-match-integration'`
      );
      expect(migrated.rows).toEqual([
        {
          provider: null,
          native_match_id: null,
          legacy_provider: 'legacy-provider',
          legacy_native_match_id: 'legacy-native-match',
        },
      ]);
      await expect(
        upgradeConnection.query(
          `INSERT INTO outcome_match
            (match_id, competition, season_year, provider, native_match_id, round_label,
             match_date, home_club_id, away_club_id)
           VALUES ('post-migration-provider-owned-match', 'AFLM', 2026, 'legacy-provider',
                   'new-native-match', 'Round 2', '2026-03-27T08:00:00.000Z',
                   'legacy-club-home', 'legacy-club-away')`
        )
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgradeConnection.query(
          `UPDATE outcome_legacy_match_provider_key SET provider='rewritten-provider'
            WHERE match_id='legacy-match-integration'`
        )
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        upgradeConnection.query(
          `DELETE FROM outcome_legacy_match_provider_key
            WHERE match_id='legacy-match-integration'`
        )
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        upgradeConnection.query(
          `INSERT INTO outcome_legacy_match_provider_key (provider,native_match_id,match_id)
           VALUES ('invented-provider','invented-native','legacy-match-integration')`
        )
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        upgradeConnection.query(
          `UPDATE outcome_match SET provider='rewritten-provider', native_match_id='rewritten-native'
            WHERE match_id='legacy-match-integration'`
        )
      ).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      upgradeConnection.release();
      await upgradePool.end();
      await adminPool.query(`DROP SCHEMA "${upgradeSchemaName}" CASCADE`);
    }
  });

  it('persists and finalizes the complete provider staging package through real pg encoding', async () => {
    const fixture = providerStagingFixture();
    const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fixture.fieldMap);
    await query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
         environment, created_at, verified_at, custody_json)
       VALUES ('provider-artifact-integration', $1, $2, 'application/x-r-rds', 1,
               'raw_source', 'test_fixture', '2026-08-07T00:00:00Z',
               '2026-08-07T00:00:01Z', '{}'::jsonb)`,
      [providerDigest('e'), `artifact://sha256/${providerDigest('e')}`]
    );
    await query(
      `INSERT INTO outcome_source_capture_attempt
        (attempt_id, environment, provider, dataset, capability_id, status,
         started_at, completed_at, attempt_json)
       VALUES ('provider-attempt-integration', 'test_fixture', 'official_afl', 'player_stats',
               'official-afl-player-stats', 'captured', '2026-08-07T00:00:00Z',
               '2026-08-07T00:00:01Z', '{}'::jsonb)`
    );
    await query(
      `INSERT INTO outcome_competition_season (competition, season_year)
       VALUES ('AFLM', 2026), ('AFLM', 2027) ON CONFLICT DO NOTHING`
    );
    await query(
      `INSERT INTO outcome_source_capture
        (capture_id, attempt_id, source_snapshot_id, source_artifact_id, environment, provider,
         dataset, dataset_version, access_mechanism, capability_id, competition,
         anchor_season_year, effective_at, captured_at, status, manifest_json)
       VALUES ('provider-capture-integration', 'provider-attempt-integration',
               'provider-snapshot-integration', 'provider-artifact-integration', 'test_fixture',
               'official_afl', 'player_stats', 'fixture-v1', 'provider_api',
               'official-afl-player-stats', 'AFLM', 2026, '2026-08-07T00:00:00Z',
               '2026-08-07T00:00:01Z', 'approved',
               '{"capture":{"kind":"fitzroy","packageVersion":"1.7.0"}}'::jsonb)`
    );
    await query(
      `INSERT INTO outcome_review_decision
        (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
         decided_by, decided_at)
       VALUES ('provider-field-map-review-integration', 'provider_field_map',
               'provider-field-map-integration', 'approved', 'Fixture approval',
               jsonb_build_object('fieldMapSha256', $1::text), 'fixture-reviewer',
               '2026-08-07T00:00:00Z')`,
      [fieldMapSha256]
    );
    await expect(
      query(
        `INSERT INTO outcome_review_decision
          (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
           decided_by, decided_at)
         VALUES ('provider-field-map-unchained-review-integration', 'provider_field_map',
                 'provider-field-map-integration', 'rejected', 'Unchained fixture rejection',
                 '{}'::jsonb, 'fixture-reviewer', '2026-08-07T00:00:00.000Z')`
      )
    ).rejects.toThrow(/must supersede its sole current decision/);
    await query(
      `INSERT INTO outcome_provider_field_map
        (field_map_id, capability_id, fitzroy_version, source_schema_sha256,
         field_map_sha256, approval_decision_id, approved_at, map_json)
       VALUES ('provider-field-map-integration', 'official-afl-player-stats', '1.7.0',
               $1, $2, 'provider-field-map-review-integration',
               '2026-08-07T00:00:00Z', $3::jsonb)`,
      [fixture.fieldMap.sourceSchemaSha256, fieldMapSha256, JSON.stringify(fixture.fieldMap)]
    );
    const manifestSpy = vi
      .spyOn(aflTradeSourceSnapshotManifestContentSchema, 'safeParse')
      .mockReturnValue({ success: true, data: fixture.parsedManifest } as never);
    try {
      const persisted = await new PostgresAflTradeProviderObservationRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ).persist({
        captureId: 'provider-capture-integration',
        fieldMapId: 'provider-field-map-integration',
        fieldMap: fixture.fieldMap,
        decodedSha256: providerDigest('8'),
        batch: fixture.batch,
        startedAt: '2026-08-07T00:01:00.000Z',
        completedAt: '2026-08-07T00:01:01.000Z',
      });
      expect(persisted).toMatchObject({ rowCount: 1, issueCount: 0, idempotentReplay: false });
    } finally {
      manifestSpy.mockRestore();
    }
    const stored = await query<{
      finalized_at: string;
      rows: string;
      identities: string;
      matches: string;
      metrics: string;
    }>(
      `SELECT run.finalized_at,
              COUNT(DISTINCT row.provider_decoded_row_id)::text AS rows,
              COUNT(DISTINCT identity.identity_candidate_id)::text AS identities,
              COUNT(DISTINCT match.match_candidate_id)::text AS matches,
              COUNT(DISTINCT metric.metric_code)::text AS metrics
         FROM outcome_provider_normalization_run run
         JOIN outcome_provider_decoded_row row USING (normalization_run_id)
         LEFT JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
         LEFT JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
         LEFT JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
        WHERE run.capture_id = 'provider-capture-integration'
        GROUP BY run.finalized_at`
    );
    expect(stored.rows[0]).toMatchObject({
      rows: '1',
      identities: '1',
      matches: '1',
      metrics: '1',
    });
    expect(stored.rows[0]?.finalized_at).toBeTruthy();
    await expect(
      query(
        `INSERT INTO outcome_provider_normalization_issue
          (issue_id, normalization_run_id, source_row_number, issue_code, details_json, detected_at)
         SELECT 'late-provider-issue', normalization_run_id, 1, 'late_issue', '{}'::jsonb, now()
           FROM outcome_provider_normalization_run
          WHERE capture_id = 'provider-capture-integration'`
      )
    ).rejects.toThrow(/Finalized provider normalization runs/);
    await expect(
      query(
        `INSERT INTO outcome_source_capture_season (capture_id, competition, season_year)
         VALUES ('provider-capture-integration', 'AFLM', 2027)`
      )
    ).rejects.toThrow(/scope is frozen/);
  });

  it('atomically rejects nonfixture namespaces self-approved by the ordinary outcomes writer', async () => {
    for (const environment of ['production', 'non_production'] as const) {
      const connection = await outcomesPool.connect();
      const definitionSha256 = sha256AflTradeCanonicalJson({ environment, kind: 'namespace' });
      const namespaceContent = {
        environment,
        provider: 'official_afl',
        capabilityId: 'official-afl-player-stats',
        entityKind: 'player',
        namespaceVersion: `official-afl-player/${environment}-integration-v1`,
        identityScope: { kind: 'competition', competition: 'AFLM' },
        definitionSha256,
      } as const;
      const namespaceId = createAflTradeContentAddress(
        'provider-native-id-namespace',
        namespaceContent
      );
      const approvalDecisionId = createAflTradeContentAddress(
        'provider-namespace-approval-decision',
        { namespaceId, attemptedBy: 'ordinary-outcomes-writer' }
      );
      const approvalDecisionSha256 = approvalDecisionId.slice(approvalDecisionId.indexOf(':') + 1);

      try {
        await connection.query('BEGIN');
        await connection.query(
          `INSERT INTO outcome_review_decision
            (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
             decided_by, decided_at)
           VALUES ($1, 'provider_native_id_namespace', $2, 'approved',
                   'Unprivileged integration attack', '{}'::jsonb, 'attacker',
                   '2026-08-07T00:00:00.000Z')`,
          [approvalDecisionId, namespaceId]
        );
        await connection.query(
          `INSERT INTO outcome_provider_native_id_namespace
            (namespace_id, environment, provider, entity_kind, capability_id,
             namespace_version, identity_scope, competition, definition_sha256,
             definition_json, status, approval_decision_id, approval_decision_sha256,
             valid_from_season, valid_through_season, created_at)
           VALUES ($1, $2, 'official_afl', 'player', 'official-afl-player-stats', $3,
                   'competition', 'AFLM', $4, $5::jsonb, 'approved', $6, $7, 2026, 2026,
                   '2026-08-07T00:00:00.000Z')`,
          [
            namespaceId,
            environment,
            namespaceContent.namespaceVersion,
            definitionSha256,
            JSON.stringify(namespaceContent),
            approvalDecisionId,
            approvalDecisionSha256,
          ]
        );
        await expect(connection.query('COMMIT')).rejects.toThrow(
          /isolated (?:non-production )?governance-registry database role/
        );
      } finally {
        await connection.query('ROLLBACK').catch(() => undefined);
        connection.release();
      }
      const persisted = await query<{ decision_count: string; namespace_count: string }>(
        `SELECT
           (SELECT count(*) FROM outcome_review_decision WHERE decision_id=$1)::text AS decision_count,
           (SELECT count(*) FROM outcome_provider_native_id_namespace WHERE namespace_id=$2)::text AS namespace_count`,
        [approvalDecisionId, namespaceId]
      );
      expect(persisted.rows[0]).toEqual({ decision_count: '0', namespace_count: '0' });
    }
  });

  it('admits an environment-bound fixture namespace without granting production authority', async () => {
    const connection = await outcomesPool.connect();
    const definitionSha256 = providerDigest('6');
    const namespaceContent = {
      environment: 'test_fixture',
      provider: 'official_afl',
      capabilityId: 'official-afl-player-stats',
      entityKind: 'player',
      namespaceVersion: 'official-afl-player/fixture-integration-v1',
      identityScope: { kind: 'competition', competition: 'AFLM' },
      definitionSha256,
    } as const;
    const namespaceId = createAflTradeContentAddress(
      'provider-native-id-namespace',
      namespaceContent
    );
    const approvalDecisionId = createAflTradeContentAddress(
      'provider-namespace-approval-decision',
      { namespaceId, fixture: true }
    );
    const approvalDecisionSha256 = approvalDecisionId.slice(approvalDecisionId.indexOf(':') + 1);

    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO outcome_review_decision
          (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
           decided_by, decided_at)
         VALUES ($1, 'provider_native_id_namespace', $2, 'approved',
                 'Disposable fixture namespace', '{}'::jsonb, 'fixture-reviewer',
                 '2026-08-07T00:00:00.000Z')`,
        [approvalDecisionId, namespaceId]
      );
      await connection.query(
        `INSERT INTO outcome_provider_native_id_namespace
          (namespace_id, environment, provider, entity_kind, capability_id,
           namespace_version, identity_scope, competition, definition_sha256,
           definition_json, status, approval_decision_id, approval_decision_sha256,
           valid_from_season, valid_through_season, created_at)
         VALUES ($1, 'test_fixture', 'official_afl', 'player', 'official-afl-player-stats',
                 'official-afl-player/fixture-integration-v1', 'competition', 'AFLM', $2,
                 $3::jsonb, 'approved', $4, $5, 2026, 2026,
                 '2026-08-07T00:00:00.000Z')`,
        [
          namespaceId,
          definitionSha256,
          JSON.stringify(namespaceContent),
          approvalDecisionId,
          approvalDecisionSha256,
        ]
      );
      await connection.query('COMMIT');
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined);
      connection.release();
    }

    const stored = await query<{ environment: string }>(
      `SELECT environment::text AS environment
         FROM outcome_provider_native_id_namespace
        WHERE namespace_id=$1`,
      [namespaceId]
    );
    expect(stored.rows[0]?.environment).toBe('test_fixture');
  });

  it('persists one governed player resolution atomically and replays only in its exact environment', async () => {
    const scenario = await createProviderResolutionScenario();
    providerResolutionScenario = scenario;
    const tamperedProposal = scenario.proposal(
      'afl-player:provider-resolution-a',
      scenario.canonicalTargetSnapshotA,
      '2026-08-07T00:02:30.000Z',
      { ...scenario.candidate, recordedName: 'Substituted Player Name' }
    );
    const tamperedDecision = createPlayerResolutionDecision({
      proposal: tamperedProposal,
      expectedRevision: 0,
      supersedesDecisionId: null,
      expectedAssignmentRevision: 0,
      supersedesAssignmentDecisionId: null,
      outcome: 'approved',
      rationale: 'This deliberately substituted candidate must fail exact staging validation.',
      decidedAt: '2026-08-07T00:03:00.000Z',
      reviewerAuthority: scenario.reviewerAuthority,
    });

    await expect(
      scenario.repository.persistDecision(tamperedDecision, scenario.execution)
    ).rejects.toMatchObject({ code: 'STAGING_MISMATCH' });
    await expect(
      scenario.repository.persistDecision(scenario.decisionA, {
        ...scenario.execution,
        environment: 'non_production',
      })
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });

    const empty = await query<{
      proposal_count: string;
      review_count: string;
      resolution_count: string;
      identity_count: string;
      occurrence_count: string;
    }>(
      `SELECT
        (SELECT count(*) FROM outcome_provider_resolution_proposal WHERE resolution_case_id=$1)::text AS proposal_count,
        (SELECT count(*) FROM outcome_review_decision WHERE subject_type='provider_resolution_case' AND subject_id=$1)::text AS review_count,
        (SELECT count(*) FROM outcome_provider_player_resolution WHERE resolution_case_id=$1)::text AS resolution_count,
        (SELECT count(*) FROM outcome_player_identity WHERE identity_id=$2)::text AS identity_count,
        (SELECT count(*) FROM outcome_provider_player_identity_occurrence WHERE player_identity_id=$2)::text AS occurrence_count`,
      [scenario.resolutionCaseId, scenario.playerIdentityId]
    );
    expect(empty.rows[0]).toEqual({
      proposal_count: '0',
      review_count: '0',
      resolution_count: '0',
      identity_count: '0',
      occurrence_count: '0',
    });

    await expect(
      scenario.repository.persistDecision(scenario.decisionA, scenario.execution)
    ).resolves.toMatchObject({
      decisionId: scenario.decisionA.decisionId,
      revision: 1,
      idempotentReplay: false,
    });
    await expect(
      scenario.repository.persistDecision(scenario.decisionA, {
        ...scenario.execution,
        environment: 'non_production',
      })
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
    await expect(
      scenario.repository.persistDecision(structuredClone(scenario.decisionA), scenario.execution)
    ).resolves.toMatchObject({
      decisionId: scenario.decisionA.decisionId,
      revision: 1,
      idempotentReplay: true,
    });

    const stored = await query<{
      proposal_count: string;
      review_count: string;
      resolution_count: string;
      resolution_head_revision: number;
      assignment_head_revision: number;
      assignment_status: string;
      identity_count: string;
      occurrence_count: string;
      legacy_assignment_count: string;
      release_membership_count: string;
    }>(
      `SELECT
        (SELECT count(*) FROM outcome_provider_resolution_proposal WHERE resolution_case_id=$1)::text AS proposal_count,
        (SELECT count(*) FROM outcome_review_decision WHERE subject_type='provider_resolution_case' AND subject_id=$1)::text AS review_count,
        (SELECT count(*) FROM outcome_provider_player_resolution WHERE resolution_case_id=$1)::text AS resolution_count,
        (SELECT revision FROM outcome_provider_player_resolution_head WHERE resolution_case_id=$1) AS resolution_head_revision,
        (SELECT revision FROM outcome_provider_identity_assignment_head WHERE assignment_case_id=$2) AS assignment_head_revision,
        (SELECT status FROM outcome_provider_identity_assignment_head WHERE assignment_case_id=$2) AS assignment_status,
        (SELECT count(*) FROM outcome_player_identity WHERE identity_id=$3)::text AS identity_count,
        (SELECT count(*) FROM outcome_provider_player_identity_occurrence WHERE player_identity_id=$3)::text AS occurrence_count,
        (SELECT count(*) FROM outcome_player_identity_assignment WHERE identity_id=$3)::text AS legacy_assignment_count,
        (SELECT count(*) FROM outcome_release_review_decision WHERE decision_id=$4)::text AS release_membership_count`,
      [
        scenario.resolutionCaseId,
        scenario.assignmentCaseId,
        scenario.playerIdentityId,
        scenario.decisionA.decisionId,
      ]
    );
    expect(stored.rows[0]).toEqual({
      proposal_count: '1',
      review_count: '1',
      resolution_count: '1',
      resolution_head_revision: 1,
      assignment_head_revision: 1,
      assignment_status: 'active',
      identity_count: '1',
      occurrence_count: '1',
      legacy_assignment_count: '0',
      release_membership_count: '0',
    });
  });

  it('rejects a governed player resolution sourced outside the factual release', async () => {
    const scenario = providerResolutionScenario;
    if (!scenario) throw new Error('The provider resolution vertical slice did not initialize.');
    const ids = await seedNormalizedEventRelease('provider-resolution-outside-release', {
      competition: 'AFLM',
      seasonYear: 2026,
      effectiveThrough: '2026-12-31T23:59:59Z',
      createdAt: '2027-01-01T00:00:00Z',
    });

    const connection = await outcomesPool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO outcome_event_asset
          (asset_version_id, event_version_id, asset_key, kind, player_id, player_identity_id,
           from_club_id, to_club_id, source_import_row_id, raw_description, status)
         VALUES ('asset-governed-provider-resolution-outside-release', $1, 'provider-player',
                 'player', $2, $3, $4, $5, $6, 'Provider Resolution A', 'approved')`,
        [
          ids.eventVersionId,
          'afl-player:provider-resolution-a',
          scenario.playerIdentityId,
          ids.fromClubId,
          ids.toClubId,
          ids.lateAssetRowId,
        ]
      );
      await connection.query(
        `INSERT INTO outcome_release_review_decision
          (release_id, decision_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
        [ids.releaseId, scenario.decisionA.decisionId, 'a'.repeat(64)]
      );

      await expect(
        connection.query(
          `INSERT INTO outcome_release_event_version
            (release_id, event_version_id, ordinal, record_sha256, membership_json)
           VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
          [ids.releaseId, ids.eventVersionId, 'b'.repeat(64)]
        )
      ).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringMatching(
          /exact current legacy assignment or governed provider resolution/
        ),
      });
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('requires deactivation before remap and admits one concurrent next revision', async () => {
    const scenario = providerResolutionScenario;
    if (!scenario) throw new Error('The provider resolution vertical slice did not initialize.');
    const proposalB = scenario.proposal(
      'afl-player:provider-resolution-b',
      scenario.canonicalTargetSnapshotB,
      '2026-08-07T00:04:00.000Z'
    );
    const directRemap = createPlayerResolutionDecision({
      proposal: proposalB,
      expectedRevision: 1,
      supersedesDecisionId: scenario.decisionA.decisionId,
      expectedAssignmentRevision: 1,
      supersedesAssignmentDecisionId: scenario.decisionA.decisionId,
      outcome: 'approved',
      rationale: 'A direct active remap must be rejected until player A is explicitly deactivated.',
      decidedAt: '2026-08-07T00:05:00.000Z',
      reviewerAuthority: scenario.reviewerAuthority,
    });
    await expect(
      scenario.repository.persistDecision(directRemap, scenario.execution)
    ).rejects.toThrow(/must be deactivated before the resolution can change target/);
    const afterRejectedRemap = await query<{ revision: number; decision_id: string }>(
      `SELECT revision, resolution_id AS decision_id
         FROM outcome_provider_player_resolution_head WHERE resolution_case_id=$1`,
      [scenario.resolutionCaseId]
    );
    expect(afterRejectedRemap.rows[0]).toEqual({
      revision: 1,
      decision_id: scenario.decisionA.decisionId,
    });

    const deactivation = createPlayerResolutionDecision({
      proposal: scenario.proposalA,
      expectedRevision: 1,
      supersedesDecisionId: scenario.decisionA.decisionId,
      expectedAssignmentRevision: 1,
      supersedesAssignmentDecisionId: scenario.decisionA.decisionId,
      outcome: 'rejected',
      rationale: 'Canonical player A is withdrawn before the provider identity is remapped.',
      decidedAt: '2026-08-07T00:06:00.000Z',
      reviewerAuthority: scenario.reviewerAuthority,
    });
    await expect(
      scenario.repository.persistDecision(deactivation, scenario.execution)
    ).resolves.toMatchObject({ revision: 2, idempotentReplay: false });

    const remap = createPlayerResolutionDecision({
      proposal: proposalB,
      expectedRevision: 2,
      supersedesDecisionId: deactivation.decisionId,
      expectedAssignmentRevision: 2,
      supersedesAssignmentDecisionId: deactivation.decisionId,
      outcome: 'approved',
      rationale:
        'The inactive provider identity is now reviewed and assigned to canonical player B.',
      decidedAt: '2026-08-07T00:07:00.000Z',
      reviewerAuthority: scenario.reviewerAuthority,
    });
    await expect(
      scenario.repository.persistDecision(remap, scenario.execution)
    ).resolves.toMatchObject({ revision: 3, idempotentReplay: false });

    const competingDecisions = [
      createPlayerResolutionDecision({
        proposal: proposalB,
        expectedRevision: 3,
        supersedesDecisionId: remap.decisionId,
        expectedAssignmentRevision: 3,
        supersedesAssignmentDecisionId: remap.decisionId,
        outcome: 'rejected',
        rationale: 'Concurrent correction A withdraws the current player B provider assignment.',
        decidedAt: '2026-08-07T00:08:00.000Z',
        reviewerAuthority: scenario.reviewerAuthority,
      }),
      createPlayerResolutionDecision({
        proposal: proposalB,
        expectedRevision: 3,
        supersedesDecisionId: remap.decisionId,
        expectedAssignmentRevision: 3,
        supersedesAssignmentDecisionId: remap.decisionId,
        outcome: 'deferred',
        rationale: 'Concurrent correction B defers the current player B provider assignment.',
        decidedAt: '2026-08-07T00:08:00.000Z',
        reviewerAuthority: scenario.reviewerAuthority,
      }),
    ] as const;
    const blocker = await outcomesPool.connect();
    const firstPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      options: `-c search_path=${schemaName}`,
    });
    const secondPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      options: `-c search_path=${schemaName}`,
    });
    type PersistedResolution = Awaited<
      ReturnType<PostgresAflTradeProviderResolutionRepository['persistDecision']>
    >;
    let outcomes: PromiseSettledResult<PersistedResolution>[];
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `provider-resolution:${scenario.resolutionCaseId}`,
      ]);
      const firstPid = await firstPool.query<{ process_id: number }>(
        'SELECT pg_backend_pid() AS process_id'
      );
      const secondPid = await secondPool.query<{ process_id: number }>(
        'SELECT pg_backend_pid() AS process_id'
      );
      const pending = [
        new PostgresAflTradeProviderResolutionRepository(
          createPgAflOutcomeSqlClient(firstPool)
        ).persistDecision(competingDecisions[0], scenario.execution),
        new PostgresAflTradeProviderResolutionRepository(
          createPgAflOutcomeSqlClient(secondPool)
        ).persistDecision(competingDecisions[1], scenario.execution),
      ];
      await Promise.all([
        waitForAdvisoryLockWait(firstPid.rows[0].process_id),
        waitForAdvisoryLockWait(secondPid.rows[0].process_id),
      ]);
      await blocker.query('COMMIT');
      outcomes = await Promise.allSettled(pending);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<PersistedResolution> =>
        outcome.status === 'fulfilled'
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'STALE_REVISION' });
    const winningDecision = competingDecisions.find(
      ({ decisionId }) => decisionId === fulfilled[0].value.decisionId
    );
    const losingDecision = competingDecisions.find(
      ({ decisionId }) => decisionId !== fulfilled[0].value.decisionId
    );
    expect(winningDecision).toBeDefined();
    expect(losingDecision).toBeDefined();

    const history = await query<{
      revision: number;
      outcome: string;
      player_id: string;
      assignment_status: string;
      decision_id: string;
    }>(
      `SELECT revision, outcome, player_id, assignment_status, decision_id
         FROM outcome_provider_player_resolution
        WHERE resolution_case_id=$1 ORDER BY revision`,
      [scenario.resolutionCaseId]
    );
    expect(history.rows).toEqual([
      {
        revision: 1,
        outcome: 'approved',
        player_id: 'afl-player:provider-resolution-a',
        assignment_status: 'active',
        decision_id: scenario.decisionA.decisionId,
      },
      {
        revision: 2,
        outcome: 'rejected',
        player_id: 'afl-player:provider-resolution-a',
        assignment_status: 'inactive',
        decision_id: deactivation.decisionId,
      },
      {
        revision: 3,
        outcome: 'approved',
        player_id: 'afl-player:provider-resolution-b',
        assignment_status: 'active',
        decision_id: remap.decisionId,
      },
      {
        revision: 4,
        outcome: winningDecision!.content.outcome,
        player_id: 'afl-player:provider-resolution-b',
        assignment_status: 'inactive',
        decision_id: winningDecision!.decisionId,
      },
    ]);
    const finalState = await query<{
      resolution_revision: number;
      resolution_id: string;
      assignment_revision: number;
      assignment_decision_id: string;
      assignment_status: string;
      proposal_count: string;
      review_count: string;
      identity_count: string;
      occurrence_count: string;
      legacy_assignment_count: string;
      losing_decision_count: string;
      release_membership_count: string;
    }>(
      `SELECT
        resolution_head.revision AS resolution_revision,
        resolution_head.resolution_id,
        assignment_head.revision AS assignment_revision,
        assignment_head.decision_id AS assignment_decision_id,
        assignment_head.status AS assignment_status,
        (SELECT count(*) FROM outcome_provider_resolution_proposal WHERE resolution_case_id=$1)::text AS proposal_count,
        (SELECT count(*) FROM outcome_review_decision WHERE subject_type='provider_resolution_case' AND subject_id=$1)::text AS review_count,
        (SELECT count(*) FROM outcome_player_identity WHERE identity_id=$2)::text AS identity_count,
        (SELECT count(*) FROM outcome_provider_player_identity_occurrence WHERE player_identity_id=$2)::text AS occurrence_count,
        (SELECT count(*) FROM outcome_player_identity_assignment WHERE identity_id=$2)::text AS legacy_assignment_count,
        (SELECT count(*) FROM outcome_review_decision WHERE decision_id=$3)::text AS losing_decision_count,
        (SELECT count(*) FROM outcome_release_review_decision release_review
          JOIN outcome_review_decision review USING (decision_id)
         WHERE review.subject_type='provider_resolution_case' AND review.subject_id=$1)::text AS release_membership_count
       FROM outcome_provider_player_resolution_head resolution_head
       CROSS JOIN outcome_provider_identity_assignment_head assignment_head
      WHERE resolution_head.resolution_case_id=$1 AND assignment_head.assignment_case_id=$4`,
      [
        scenario.resolutionCaseId,
        scenario.playerIdentityId,
        losingDecision!.decisionId,
        scenario.assignmentCaseId,
      ]
    );
    expect(finalState.rows[0]).toEqual({
      resolution_revision: 4,
      resolution_id: winningDecision!.decisionId,
      assignment_revision: 4,
      assignment_decision_id: winningDecision!.decisionId,
      assignment_status: 'inactive',
      proposal_count: '2',
      review_count: '4',
      identity_count: '1',
      occurrence_count: '2',
      legacy_assignment_count: '0',
      losing_decision_count: '0',
      release_membership_count: '0',
    });
  });

  it('atomically rejects nonfixture issue decisions from the ordinary outcomes writer', async () => {
    for (const environment of ['production', 'non_production'] as const) {
      const issueId = await seedProviderNormalizationIssue(environment, environment);
      const decisionId = `provider-${environment}-issue-attacker-decision`;
      await expect(
        query(
          `INSERT INTO outcome_review_decision
            (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
             decided_by, decided_at)
           VALUES ($1, 'provider_normalization_issue', $2, 'approved',
                   'Unprivileged issue closure', '{}'::jsonb, 'attacker',
                   '2026-08-07T00:02:00.000Z')`,
          [decisionId, issueId]
        )
      ).rejects.toThrow(/isolated (?:non-production )?identity-issue reviewer database role/);
      const persisted = await query<{ decision_count: string }>(
        `SELECT count(*)::text AS decision_count
           FROM outcome_review_decision WHERE decision_id=$1`,
        [decisionId]
      );
      expect(persisted.rows[0]?.decision_count).toBe('0');
    }
  });

  it('keeps fixture issue decisions linear without granting nonfixture authority', async () => {
    const issueId = await seedProviderNormalizationIssue('test_fixture', 'fixture');

    await query(
      `INSERT INTO outcome_review_decision
        (decision_id, subject_type, subject_id, decision, rationale, evidence_json,
         decided_by, decided_at)
       VALUES ('provider-fixture-issue-approval', 'provider_normalization_issue', $1,
               'approved', 'Disposable fixture closure', '{}'::jsonb, 'fixture-reviewer',
               '2026-08-07T00:04:00.000Z')`,
      [issueId]
    );
    await query(
      `INSERT INTO outcome_review_decision
        (decision_id, subject_type, subject_id, decision, supersedes_decision_id, rationale,
         evidence_json, decided_by, decided_at)
       VALUES ('provider-fixture-issue-withdrawal', 'provider_normalization_issue', $1,
               'rejected', 'provider-fixture-issue-approval', 'Fixture correction',
               '{}'::jsonb, 'fixture-reviewer', '2026-08-07T00:05:00.000Z')`,
      [issueId]
    );
    const current = await query<{ decision: string }>(
      `SELECT decision
         FROM outcome_review_decision current_decision
        WHERE current_decision.subject_type='provider_normalization_issue'
          AND current_decision.subject_id=$1
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=current_decision.decision_id
          )`,
      [issueId]
    );
    expect(current.rows).toEqual([{ decision: 'rejected' }]);
  });

  it('represents one immutable workbook capture with explicit multi-season scope', async () => {
    const digest = '8'.repeat(64);
    await query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id, content_sha256, storage_uri, media_type, byte_length, artifact_class,
         environment, created_at, verified_at, custody_json)
       VALUES ('artifact-multi-season', $1, $2,
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1,
               'raw_source', 'test_fixture', '2025-01-01T00:00:00Z',
               '2025-01-01T00:00:01Z', '{}'::jsonb)`,
      [digest, `artifact://sha256/${digest}`]
    );
    await query(
      `INSERT INTO outcome_source_capture_attempt
        (attempt_id, environment, provider, dataset, status, started_at, completed_at, attempt_json)
       VALUES ('attempt-multi-season', 'test_fixture', 'statly-curated-workbook',
               'afl-drafts-trades', 'captured', '2025-01-01T00:00:00Z',
               '2025-01-01T00:00:01Z', '{}'::jsonb)`
    );
    await query(
      `INSERT INTO outcome_competition_season (competition, season_year)
       VALUES ('AFL', 2024), ('AFL', 2025) ON CONFLICT DO NOTHING`
    );
    await query(
      `INSERT INTO outcome_source_capture
        (capture_id, attempt_id, source_snapshot_id, source_artifact_id, environment, provider,
         dataset, dataset_version, access_mechanism, competition, anchor_season_year, effective_at,
         captured_at, status, manifest_json)
       VALUES ('capture-multi-season', 'attempt-multi-season', 'snapshot-multi-season',
               'artifact-multi-season', 'test_fixture', 'statly-curated-workbook',
               'afl-drafts-trades', 'fixture-v1', 'reviewed_workbook_upload', 'AFL', 2025,
               '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z', 'approved', '{}'::jsonb)`
    );
    await query(
      `INSERT INTO outcome_source_capture_season (capture_id, competition, season_year)
       VALUES ('capture-multi-season', 'AFL', 2024)`
    );

    const scopes = await query<{ competition: string; season_year: number }>(
      `SELECT competition, season_year FROM outcome_source_capture_season
       WHERE capture_id = 'capture-multi-season' ORDER BY season_year`
    );
    expect(scopes.rows).toEqual([
      { competition: 'AFL', season_year: 2024 },
      { competition: 'AFL', season_year: 2025 },
    ]);
    await query(
      `INSERT INTO outcome_import_run
        (import_run_id, capture_id, import_kind, parser_version, started_at, completed_at,
         status, manifest_json)
       VALUES ('import-multi-season', 'capture-multi-season', 'workbook_full_archive',
               'fixture-parser-v1', '2025-01-01T00:01:00Z', '2025-01-01T00:02:00Z',
               'needs_review', '{}'::jsonb)`
    );
    await query(
      `INSERT INTO outcome_import_partition
        (import_partition_id, import_run_id, partition_key, partition_kind, competition,
         season_year, row_count, rows_sha256, partition_json)
       VALUES ('partition-multi-season-2024', 'import-multi-season', 'annual:2024',
               'workbook_annual_acquisitions', 'AFL', 2024, 1, $1, '{}'::jsonb)`,
      [digest]
    );
    await query(
      `INSERT INTO outcome_competition_season (competition, season_year)
       VALUES ('AFL', 2023) ON CONFLICT DO NOTHING`
    );
    await expect(
      query(
        `INSERT INTO outcome_source_capture_season (capture_id, competition, season_year)
         VALUES ('capture-multi-season', 'AFL', 2023)`
      )
    ).rejects.toThrow(/frozen/i);
    await expect(
      query(
        `INSERT INTO outcome_import_partition
          (import_partition_id, import_run_id, partition_key, partition_kind, competition,
           season_year, row_count, rows_sha256, partition_json)
         VALUES ('partition-multi-season-2023', 'import-multi-season', 'annual:2023',
                 'workbook_annual_acquisitions', 'AFL', 2023, 1, $1, '{}'::jsonb)`,
        [digest]
      )
    ).rejects.toThrow(/source-capture competition-season scope/i);
    await expect(
      query(
        `UPDATE outcome_source_capture_season SET season_year = 2023
         WHERE capture_id = 'capture-multi-season' AND season_year = 2024`
      )
    ).rejects.toThrow(/append-only/i);
  });

  it('validates the checked-in isolated Prisma schema', () => {
    expect(() =>
      runOutcomesPrismaTestCommand(['validate'], {
        databaseUrl: scopedDatabaseUrl(schemaName),
      })
    ).not.toThrow();
  });

  it('loads the authenticated initial registry through the real repository boundary', async () => {
    const sqlClient = createPgAflOutcomeSqlClient(outcomesPool);
    const repository = createPostgresAflDraftTradeOutcomeReleaseRepository(sqlClient);

    await expect(repository.loadRegistry()).resolves.toEqual({
      revision: 0,
      releases: {},
      activeByScope: {},
      events: [],
    });
  });

  it('accepts multiple immutable projection versions for one release', async () => {
    await query(
      `INSERT INTO outcome_release_manifest
        (release_id, scope_key, environment, created_at, effective_through, manifest_json)
       VALUES ($1, $2, 'test_fixture', $3, $4, '{}'::jsonb)`,
      [
        releaseId,
        'public-afl-draft-trade-outcomes',
        '2026-08-06T02:00:00.000Z',
        '2026-08-06T01:00:00.000Z',
      ]
    );
    for (const id of [projectionId, secondProjectionId]) {
      await query(
        `INSERT INTO outcome_projection_manifest
          (projection_id, release_id, created_at, manifest_json)
         VALUES ($1, $2, $3, '{}'::jsonb)`,
        [id, releaseId, '2026-08-06T03:00:00.000Z']
      );
    }

    await expect(
      query('UPDATE outcome_projection_manifest SET created_at = CURRENT_TIMESTAMP')
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query('DELETE FROM outcome_projection_manifest WHERE projection_id = $1', [projectionId])
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('enforces release and self-referential event-chain foreign keys', async () => {
    await expect(
      query(
        `INSERT INTO outcome_registry_event
          (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
         VALUES (1, $1, NULL, $2, 'scope', 'register', CURRENT_TIMESTAMP, '{}'::jsonb)`,
        [`outcome-release-event:${'d'.repeat(64)}`, `outcome-release:${'e'.repeat(64)}`]
      )
    ).rejects.toThrow(/Registry event scope must match its release manifest/);

    await query(
      `INSERT INTO outcome_registry_event
        (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
       VALUES (1, $1, NULL, $2, 'public-afl-draft-trade-outcomes', 'register', CURRENT_TIMESTAMP, '{}'::jsonb)`,
      [`outcome-release-event:${'f'.repeat(64)}`, releaseId]
    );
    await expect(
      query(
        `INSERT INTO outcome_registry_event
          (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
         VALUES (2, $1, $2, $3, 'public-afl-draft-trade-outcomes', 'validate', CURRENT_TIMESTAMP, '{}'::jsonb)`,
        [
          `outcome-release-event:${'1'.repeat(64)}`,
          `outcome-release-event:${'2'.repeat(64)}`,
          releaseId,
        ]
      )
    ).rejects.toThrow(/Factual release event requires its exact projection-v2 record state/);
  });

  it('normalizes projection-item identity without nullable-key ambiguity', async () => {
    const insert = (ordinal: number) =>
      query(
        `INSERT INTO outcome_projection_item
          (release_id, projection_id, ordinal, item_key, event_id, year, afl_club_id,
           club_name, player_name, search_text, metric_codes, status_codes, item_json)
         VALUES ($1, $2, $3, 'event-without-asset', 'event-1', 2026, 'club-1',
                 'Fixture Club', 'Fixture Player', 'fixture player', ARRAY['games'], ARRAY[]::TEXT[], '{}'::jsonb)`,
        [releaseId, projectionId, ordinal]
      );

    await insert(0);
    await expect(insert(1)).rejects.toMatchObject({ code: '23505' });
    await expect(
      query(
        `INSERT INTO outcome_projection_item
          (release_id, projection_id, ordinal, item_key, event_id, year, afl_club_id,
           club_name, player_name, search_text, metric_codes, status_codes, item_json)
         VALUES ($1, $2, 2, 'null-array', 'event-2', 2026, 'club-1',
                 'Fixture Club', 'Fixture Player', 'fixture player', NULL, ARRAY[]::TEXT[], '{}'::jsonb)`,
        [releaseId, projectionId]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects staged event children and cross-environment source membership', async () => {
    const ids = await seedNormalizedEventRelease('6');
    await query(
      `INSERT INTO outcome_event_asset
        (asset_version_id, event_version_id, asset_key, kind, player_id, player_identity_id, from_club_id,
         to_club_id, source_import_row_id, raw_description, status)
       VALUES ('staged-asset-6', $1, 'player-staged', 'player', $2, $3, $4, $5, $6,
               'Unreviewed Player Asset', 'staged')`,
      [
        ids.eventVersionId,
        ids.playerId,
        ids.identityId,
        ids.fromClubId,
        ids.toClubId,
        ids.lateAssetRowId,
      ]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_event_version
          (release_id, event_version_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
        [ids.releaseId, ids.eventVersionId, '6'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });

    const productionReleaseId = `outcome-release:${'7'.repeat(64)}`;
    await query(
      `INSERT INTO outcome_release_manifest
        (release_id, scope_key, environment, created_at, effective_through, manifest_json)
       VALUES ($1, 'public-afl-draft-trade-outcomes', 'production',
               '2026-01-01T00:00:00Z', '2025-12-31T23:59:59Z', '{}'::jsonb)`,
      [productionReleaseId]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_source_capture
          (release_id, capture_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
        [productionReleaseId, ids.captureId, '6'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects directionless approved assets at the release boundary', async () => {
    const ids = await seedNormalizedEventRelease('9');
    await query(
      `INSERT INTO outcome_event_asset
        (asset_version_id, event_version_id, asset_key, kind, source_import_row_id,
         raw_description, status)
       VALUES ('directionless-asset-9', $1, 'directionless-cash', 'cash', $2,
               'Directionless consideration', 'approved')`,
      [ids.eventVersionId, ids.lateAssetRowId]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_event_version
          (release_id, event_version_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
        [ids.releaseId, ids.eventVersionId, '9'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('serializes release membership against late child inserts', async () => {
    const ids = await seedNormalizedEventRelease('4');
    const membershipClient = await outcomesPool.connect();
    const childClient = await outcomesPool.connect();
    try {
      await membershipClient.query('BEGIN');
      await membershipClient.query(
        `INSERT INTO outcome_release_event_version
          (release_id, event_version_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
        [ids.releaseId, ids.eventVersionId, '4'.repeat(64)]
      );
      const childProcess = await childClient.query<{ process_id: number }>(
        'SELECT pg_backend_pid() AS process_id'
      );

      const lateInsert = childClient
        .query(
          `INSERT INTO outcome_event_asset
          (asset_version_id, event_version_id, asset_key, kind, player_id, player_identity_id, from_club_id,
           to_club_id, source_import_row_id, raw_description, status)
         VALUES ('late-asset-4', $1, 'late-player', 'player', $2, $3, $4, $5, $6,
                 'Late Player Asset', 'approved')`,
          [
            ids.eventVersionId,
            ids.playerId,
            ids.identityId,
            ids.fromClubId,
            ids.toClubId,
            ids.lateAssetRowId,
          ]
        )
        .then(
          () => ({ error: null }),
          (error: unknown) => ({ error })
        );
      await waitForAdvisoryLockWait(childProcess.rows[0].process_id);
      await membershipClient.query('COMMIT');
      await expect(lateInsert).resolves.toMatchObject({ error: { code: 'P0001' } });
    } finally {
      await membershipClient.query('ROLLBACK').catch(() => undefined);
      membershipClient.release();
      childClient.release();
    }
  });

  it('freezes factual membership when a release enters the registry', async () => {
    const ids = await seedNormalizedEventRelease('8');
    await query(
      `INSERT INTO outcome_registry_event
        (revision, event_id, previous_event_id, release_id, scope_key, action, occurred_at, event_json)
       VALUES (2, $1, $2, $3, 'public-afl-draft-trade-outcomes', 'register',
               CURRENT_TIMESTAMP, '{}'::jsonb)`,
      [
        `outcome-release-event:${'8'.repeat(64)}`,
        `outcome-release-event:${'f'.repeat(64)}`,
        ids.releaseId,
      ]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_event_version
          (release_id, event_version_id, ordinal, record_sha256, membership_json)
         VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
        [ids.releaseId, ids.eventVersionId, '8'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('preserves missing spell metrics as null and freezes versioned definitions', async () => {
    const ids = await seedNormalizedEventRelease('5');
    await query(
      `INSERT INTO outcome_metric_definition
        (metric_code, definition_version, display_name, value_type, canonical_unit,
         non_negative, definition_json, status)
       VALUES ('games', 'v1', 'Games', 'numeric', 'game', true, '{}'::jsonb, 'approved')`
    );
    await expect(
      query(
        `UPDATE outcome_import_run SET manifest_json = '{"tampered":true}'::jsonb
         WHERE import_run_id = $1`,
        [ids.importRunId]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query(`UPDATE outcome_source_capture_attempt SET status = 'failed' WHERE attempt_id = $1`, [
        ids.attemptId,
      ])
    ).rejects.toMatchObject({ code: 'P0001' });
    await query(
      `INSERT INTO outcome_player_identity
        (identity_id, capture_id, provider, native_player_id, recorded_name, identity_sha256,
         first_observed_at)
       VALUES ('unresolved-identity-5', $1, 'fixture-workbook', 'unresolved-player-5',
               'Unresolved Player', $2, '2025-01-01T00:00:00Z')`,
      [ids.captureId, '5'.repeat(64)]
    );
    await query(
      `INSERT INTO outcome_review_decision
        (decision_id, subject_type, subject_id, decision, canonical_record_type,
         canonical_record_id, rationale, evidence_json, decided_by, decided_at)
       VALUES ('bad-review-decision-5', 'unrelated_subject', 'unrelated-5', 'assign',
               'player', $1, 'Wrong subject', '{}'::jsonb, 'fixture-reviewer',
               '2025-01-01T00:03:00Z')`,
      [ids.playerId]
    );
    await query(
      `INSERT INTO outcome_player_identity_assignment
        (assignment_id, identity_id, player_id, version, status, decision_id, effective_at,
         recorded_at)
       VALUES ('bad-identity-assignment-5', 'unresolved-identity-5', $1, 1, 'approved',
               'bad-review-decision-5', '2025-01-01T00:03:00Z',
               '2025-01-01T00:03:00Z')`,
      [ids.playerId]
    );
    await query(
      `INSERT INTO outcome_release_review_decision
        (release_id, decision_id, ordinal, record_sha256, membership_json)
       VALUES ($1, 'bad-review-decision-5', 1, $2, '{}'::jsonb)`,
      [ids.releaseId, '5'.repeat(64)]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_identity_assignment
          (release_id, assignment_id, ordinal, record_sha256, membership_json)
         VALUES ($1, 'bad-identity-assignment-5', 1, $2, '{}'::jsonb)`,
        [ids.releaseId, '5'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await query(
      `INSERT INTO outcome_competition_season (competition, season_year)
       VALUES ('AFL', 2024) ON CONFLICT DO NOTHING`
    );
    await query(
      `INSERT INTO outcome_match
        (match_id, competition, season_year, round_label, match_date, home_club_id, away_club_id)
       VALUES ('match-2024-5', 'AFL', 2024, 'R1', '2024-03-01T00:00:00Z', $1, $2)`,
      [ids.fromClubId, ids.toClubId]
    );
    await expect(
      query(
        `INSERT INTO outcome_player_stat_observation
          (observation_id, capture_id, identity_id, match_id, competition, season_year,
           grain, native_row_key, observation_sha256, completeness, observed_at, source_payload)
         VALUES ('cross-season-observation-5', $1, $2, 'match-2024-5', 'AFL', 2025,
                 'match', 'cross-season-row-5', $3, 'approved',
                 '2025-03-01T00:00:00Z', '{}'::jsonb)`,
        [ids.captureId, ids.identityId, '5'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: '23503' });
    await query(
      `INSERT INTO outcome_player_stat_observation
        (observation_id, capture_id, identity_id, competition, season_year, grain,
         native_row_key, observation_sha256, completeness, observed_at, source_payload)
       VALUES ('unresolved-observation-5', $1, 'unresolved-identity-5', 'AFL', 2025,
               'season', 'unresolved-row-5', $2, 'approved', '2025-12-01T00:00:00Z',
               '{}'::jsonb)`,
      [ids.captureId, '5'.repeat(64)]
    );
    await query(
      `INSERT INTO outcome_player_stat_metric
        (observation_id, metric_code, definition_version, availability, numeric_value, unit)
       VALUES ('unresolved-observation-5', 'games', 'v1', 'exact', 1, 'game')`
    );
    await expect(
      query(
        `INSERT INTO outcome_release_stat_observation
          (release_id, observation_id, ordinal, record_sha256, membership_json)
         VALUES ($1, 'unresolved-observation-5', 0, $2, '{}'::jsonb)`,
        [ids.releaseId, '5'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await query(
      `INSERT INTO outcome_player_stat_observation
        (observation_id, capture_id, identity_id, competition, season_year, grain,
         observed_date, native_row_key, observation_sha256, completeness, observed_at,
         source_payload)
       VALUES ('late-observation-5', $1, $2, 'AFL', 2025, 'season', '2025-01-01',
               'late-row-5', $3, 'approved', '2026-01-01T00:00:00Z', '{}'::jsonb)`,
      [ids.captureId, ids.identityId, '5'.repeat(64)]
    );
    await query(
      `INSERT INTO outcome_player_stat_metric
        (observation_id, metric_code, definition_version, availability, numeric_value, unit)
       VALUES ('late-observation-5', 'games', 'v1', 'exact', 1, 'game')`
    );
    await expect(
      query(
        `INSERT INTO outcome_release_stat_observation
          (release_id, observation_id, ordinal, record_sha256, membership_json)
         VALUES ($1, 'late-observation-5', 1, $2, '{}'::jsonb)`,
        [ids.releaseId, '5'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await query(
      `INSERT INTO outcome_acquisition_spell_rule
        (rule_id, rule_version, definition_json, status, created_at)
       VALUES ('spell-rule-5', 'v1', '{}'::jsonb, 'approved', '2025-10-02T00:00:00Z')`
    );
    await query(
      `INSERT INTO outcome_acquisition_spell_version
        (spell_version_id, spell_id, version, player_id, club_id, start_event_version_id,
         start_asset_version_id, start_date, rule_id, status, recorded_at)
       VALUES ('spell-version-5', 'spell-5', 1, $1, $2, $3, $4, '2025-10-01',
               'spell-rule-5', 'approved', '2025-10-02T00:00:00Z')`,
      [ids.playerId, ids.toClubId, ids.eventVersionId, ids.assetVersionId]
    );
    await expect(
      query(
        `INSERT INTO outcome_acquisition_spell_metric
          (spell_version_id, metric_code, metric_definition_version, numeric_value,
           coverage_state, observation_count, effective_through, evidence_json)
         VALUES ('spell-version-5', 'games', 'v1', 0, 'unavailable', 0,
                 '2025-12-31', '{}'::jsonb)`
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      query(
        `INSERT INTO outcome_acquisition_spell_metric
          (spell_version_id, metric_code, metric_definition_version, numeric_value,
           coverage_state, observation_count, effective_through, evidence_json)
         VALUES ('spell-version-5', 'games', 'v1', NULL, 'unavailable', 0,
                 '2025-12-31', '{}'::jsonb)`
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await query(
      `INSERT INTO outcome_release_event_version
        (release_id, event_version_id, ordinal, record_sha256, membership_json)
       VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
      [ids.releaseId, ids.eventVersionId, '5'.repeat(64)]
    );
    await query(
      `INSERT INTO outcome_draft_pick
        (pick_id, draft_season_year, draft_kind, nominal_pick, status)
       VALUES ('rejected-parent-pick-5', 2025, 'national_draft', 1, 'rejected'),
              ('approved-child-pick-5', 2025, 'national_draft', 2, 'approved')`
    );
    await query(
      `INSERT INTO outcome_pick_lineage_edge
        (edge_id, parent_pick_id, child_pick_id, event_id, source_import_row_id,
         relation_kind, sequence, evidence_json, recorded_at)
       VALUES ('rejected-lineage-5', 'rejected-parent-pick-5', 'approved-child-pick-5',
               $1, $2, 'renumbered_to', 0, '{}'::jsonb, '2025-10-02T00:00:00Z')`,
      [ids.eventId, ids.lateAssetRowId]
    );
    await expect(
      query(
        `INSERT INTO outcome_release_pick_lineage
          (release_id, edge_id, ordinal, record_sha256, membership_json)
         VALUES ($1, 'rejected-lineage-5', 0, $2, '{}'::jsonb)`,
        [ids.releaseId, '5'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id, spell_id, version, player_id, club_id, start_event_version_id,
           start_asset_version_id, start_date, rule_id, status, recorded_at)
         VALUES ('overlapping-spell-version-5', 'overlapping-spell-5', 1, $1, $2, $3, $4,
                 '2025-10-01', 'spell-rule-5', 'approved', '2025-10-02T00:00:00Z')`,
        [ids.playerId, ids.toClubId, ids.eventVersionId, ids.assetVersionId]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id, spell_id, version, player_id, club_id, start_event_version_id,
           start_asset_version_id, start_date, rule_id, status, recorded_at)
         VALUES ('mismatched-spell-version-5', 'mismatched-spell-5', 1, $1, $2, $3, $4,
                 '2025-10-01', 'spell-rule-5', 'approved', '2025-10-02T00:00:00Z')`,
        [ids.playerId, ids.fromClubId, ids.eventVersionId, ids.assetVersionId]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await query(
      `INSERT INTO outcome_reconciliation_run
        (reconciliation_run_id, scope_key, algorithm_version, started_at, completed_at,
         status, report_json)
       VALUES ('reconciliation-5', 'public-afl-draft-trade-outcomes', 'v1',
               '2025-12-01T00:00:00Z', '2025-12-01T00:01:00Z', 'approved', '{}'::jsonb)`
    );
    await expect(
      query(
        `UPDATE outcome_reconciliation_run SET report_json = '{"tampered":true}'::jsonb
         WHERE reconciliation_run_id = 'reconciliation-5'`
      )
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      query(
        `UPDATE outcome_metric_definition SET canonical_unit = 'appearance'
         WHERE metric_code = 'games' AND definition_version = 'v1'`
      )
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rolls back all writes after an injected transaction failure', async () => {
    const transactional = createPgAflOutcomeSqlClient(outcomesPool);
    const rolledBackReleaseId = `outcome-release:${'2'.repeat(64)}`;

    await expect(
      transactional.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO outcome_release_manifest
            (release_id, scope_key, environment, created_at, effective_through, manifest_json)
           VALUES ($1, 'rollback-scope', 'test_fixture', $2, $3, '{}'::jsonb)`,
          [rolledBackReleaseId, '2026-08-06T02:00:00.000Z', '2026-08-06T01:00:00.000Z']
        );
        throw new Error('injected integration failure');
      })
    ).rejects.toThrow('injected integration failure');

    const result = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM outcome_release_manifest WHERE release_id = $1',
      [rolledBackReleaseId]
    );
    expect(result.rows[0].count).toBe('0');
  });

  it('rejects an orphan registry-head revision', async () => {
    await expect(
      query(
        `UPDATE outcome_registry_head
         SET revision = 1, updated_at = CURRENT_TIMESTAMP
         WHERE singleton_id = 1 AND revision = 0`
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('admits one real repository registration and preserves exact head/event/manifest parity', async () => {
    const raceSchemaName = `${schemaName}_repository_race`;
    await adminPool.query(`CREATE SCHEMA "${raceSchemaName}"`);
    const racePool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${raceSchemaName}`,
    });
    try {
      deployOutcomeMigrations(raceSchemaName);
      const afterHeadLoad = createTwoPartyBarrier();
      const beforeHeadLock = createTwoPartyBarrier();
      const firstRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
        createBarrieredOutcomeSqlClient(
          createPgAflOutcomeSqlClient(racePool),
          afterHeadLoad,
          beforeHeadLock
        )
      );
      const secondRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
        createBarrieredOutcomeSqlClient(
          createPgAflOutcomeSqlClient(racePool),
          afterHeadLoad,
          beforeHeadLock
        )
      );
      const first = createAflDraftTradeOutcomeReleaseFixture('3');
      const second = createAflDraftTradeOutcomeReleaseFixture('4');
      const outcomes = await Promise.allSettled([
        firstRepository.register({
          expectedRevision: 0,
          manifest: first.release,
          actor: 'fixture-importer-a',
          evidenceId: `artifact:${aflDraftTradeOutcomeFixtureHash('5')}`,
        }),
        secondRepository.register({
          expectedRevision: 0,
          manifest: second.release,
          actor: 'fixture-importer-b',
          evidenceId: `artifact:${aflDraftTradeOutcomeFixtureHash('6')}`,
        }),
      ]);

      const fulfilled = outcomes.filter(
        (
          outcome
        ): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<typeof firstRepository.register>>
        > => outcome.status === 'fulfilled'
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(AflDraftTradeOutcomeReleaseRepositoryError);
      expect(rejected[0].reason).toMatchObject({ code: 'STALE_REVISION' });

      const winner = fulfilled[0].value;
      const winnerRelease = Object.values(winner.releases)[0];
      const head = await racePool.query<{
        revision: number;
        last_event_id: string;
        registry_json: unknown;
      }>(
        `SELECT revision, last_event_id, registry_json
         FROM outcome_registry_head WHERE singleton_id = 1`
      );
      expect(head.rows[0]).toEqual({
        revision: winner.revision,
        last_event_id: winner.events[0].eventId,
        registry_json: winner,
      });

      const events = await racePool.query<{
        revision: number;
        event_id: string;
        event_json: unknown;
      }>('SELECT revision, event_id, event_json FROM outcome_registry_event ORDER BY revision');
      expect(events.rows).toEqual([
        {
          revision: winner.revision,
          event_id: winner.events[0].eventId,
          event_json: winner.events[0],
        },
      ]);

      const manifests = await racePool.query<{
        release_id: string;
        manifest_json: unknown;
      }>('SELECT release_id, manifest_json FROM outcome_release_manifest');
      expect(manifests.rows).toEqual([
        {
          release_id: winnerRelease.releaseId,
          manifest_json: winnerRelease.releaseManifest,
        },
      ]);
    } finally {
      await racePool.end();
      await adminPool.query(`DROP SCHEMA "${raceSchemaName}" CASCADE`);
    }
  });
});
