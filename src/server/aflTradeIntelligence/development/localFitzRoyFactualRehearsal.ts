import { Buffer } from 'node:buffer';

import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { createAflTradeFactualReconciliationFinalization } from '../outcomes/acquisitionSpellMetricContracts';
import {
  AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION,
  createAflTradeFactualReconciliationPolicy,
} from '../outcomes/factualReconciliationContracts';
import { reconcileAflTradeFactualFacts } from '../outcomes/factualReconciliationService';
import {
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
} from '../outcomes/factualObservationContracts';
import {
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
  createAflTradeFactualReleaseCandidate,
} from '../outcomes/factualReleaseCandidateContracts';
import { PostgresAflTradeFactualObservationRepository } from '../outcomes/postgresFactualObservationRepository';
import { PostgresAflTradeFactualReconciliationRepository } from '../outcomes/postgresFactualReconciliationRepository';
import {
  createAflDraftTradeOutcomeFactualReleaseManifest,
  type AflDraftTradeOutcomeFactualReleaseManifest,
} from '../outcomes/outcomeReleaseContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '../outcomes/outcomeReadService';
import { createAflTradeFitzRoyFieldMapSha256 } from '../source/fitzRoyObservationContracts';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import {
  AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
  type AflTradeProviderResolutionDecision,
  type AflTradeProviderResolutionProposal,
} from '../source/providerResolutionContracts';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeProviderResolutionRepository } from '../source/postgresProviderResolutionRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
} from './localFitzRoyFactualRehearsalFixture';

const ENVIRONMENT = 'non_production' as const;
const PROVIDER = 'footywire';
const CAPABILITY_ID = 'footywire-player-stats';
const COMPETITION = 'AFLM' as const;
const SEASON_YEAR = 2026;
const GOVERNANCE_ROLE = 'afl_trade_nonproduction_governance_registry_writer';
const FACTUAL_POLICY_ROLE = 'afl_trade_nonproduction_factual_policy_reviewer';
const PRINCIPAL_REF = 'operator:local-fitzroy-factual-rehearsal';

type GovernedEvidenceKind =
  | 'provider_resolution_method'
  | 'canonical_target_snapshot'
  | 'provider_resolution_evidence'
  | 'reviewer_authority_evidence';

const governedEvidencePrefix: Record<GovernedEvidenceKind, string> = {
  provider_resolution_method: 'provider-resolution-method',
  canonical_target_snapshot: 'canonical-target-snapshot',
  provider_resolution_evidence: 'provider-resolution-evidence',
  reviewer_authority_evidence: 'reviewer-authority-evidence',
};

interface StagedProviderRow {
  normalization_run_id: string;
  staging_sha256: string;
  finalized_at: string | Date;
  field_map_sha256: string;
  provider_decoded_row_id: string;
  source_row_number: number;
  source_row_sha256: string;
  row_status: 'staged' | 'needs_review';
  competition: 'AFLM';
  season_year: number;
  identity_candidate_id: string;
  native_entity_id: string;
  recorded_name: string;
  recorded_club_id: string;
  recorded_club_name: string;
  identity_candidate_sha256: string;
  metric_candidate_json: {
    metricCode: 'goals';
    definitionVersion: string;
    availability: 'exact';
    numericValue: string;
    unit: string;
    sourceField: string;
    missingReason: null;
  };
}

interface NativeNamespaceEvidence {
  namespaceId: string;
  definitionSha256: string;
  environment: typeof ENVIRONMENT;
  provider: string;
  capabilityId: string;
  entityKind: 'player' | 'club';
  namespaceVersion: string;
  identityScope: { kind: 'competition'; competition: 'AFLM' };
  validFromSeason: number;
  validThroughSeason: number;
  approvalDecision: { id: string; sha256: string };
}

export interface LocalAflTradeFitzRoyFactualRehearsalReceipt {
  environment: typeof ENVIRONMENT;
  publicationEligible: false;
  captureId: string;
  normalizationRunId: string;
  factBatchId: string;
  factualRunId: string;
  candidateId: string;
  counts: {
    sourceRows: number;
    sourceIssues: number;
    factualRuns: 1;
    candidates: 1;
  };
  idempotentReplay: boolean;
}

function reference(prefix: string, content: unknown) {
  const id = createAflTradeContentAddress(prefix, content);
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

async function ensureRole(client: AflOutcomeSqlClient, role: string): Promise<void> {
  if (![GOVERNANCE_ROLE, FACTUAL_POLICY_ROLE].includes(role)) {
    throw new TypeError('The local rehearsal refused an unreviewed database role.');
  }
  await client.query(
    `DO $role$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${role} NOLOGIN;
       END IF;
     END $role$`
  );
  const current = await client.query<{ schema_name: string }>(
    `SELECT current_schema() AS schema_name`
  );
  const schema = current.rows[0]?.schema_name;
  if (!schema || !/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new TypeError('The local rehearsal requires one safe disposable PostgreSQL schema.');
  }
  await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schema}" TO ${role}`);
}

async function withRole<T>(
  client: AflOutcomeSqlClient,
  role: string,
  work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
): Promise<T> {
  await ensureRole(client, role);
  return client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL ROLE ${role}`);
    return work(transaction);
  });
}

async function ensureFieldMapReview(
  client: AflOutcomeSqlClient,
  fieldMap: ReturnType<
    typeof createLocalAflTradeFitzRoyFactualRehearsalFixture
  >['command']['fieldMap'],
  fieldMapSha256: string
): Promise<void> {
  const existing = await client.query(
    `SELECT decision_id FROM outcome_review_decision WHERE decision_id=$1`,
    ['local-rehearsal-field-map-review']
  );
  if (existing.rows.length === 0) {
    await client.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',$3,
             jsonb_build_object('fieldMapSha256',$4::text),$5,$6)`,
      [
        'local-rehearsal-field-map-review',
        fieldMap.mapId,
        'Source-independent local rehearsal field map.',
        fieldMapSha256,
        'local-rehearsal-reviewer',
        fieldMap.approvedAt,
      ]
    );
  }
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
}

async function ensureGovernedEvidence(
  client: AflOutcomeSqlClient,
  evidenceKind: GovernedEvidenceKind,
  evidence: Readonly<Record<string, unknown>>
) {
  const payload = { evidenceKind, environment: ENVIRONMENT, ...evidence } as const;
  const referenceId = createAflTradeContentAddress(governedEvidencePrefix[evidenceKind], payload);
  const referenceSha256 = referenceId.slice(referenceId.indexOf(':') + 1);
  const existing = await client.query(
    `SELECT reference_id FROM outcome_governed_evidence_reference WHERE reference_id=$1`,
    [referenceId]
  );
  if (existing.rows.length > 0) return { id: referenceId, sha256: referenceSha256 };
  const artifactId = createAflTradeContentAddress('governed-evidence-artifact', { referenceId });
  const approvalDecisionId = createAflTradeContentAddress('governed-evidence-approval-decision', {
    referenceId,
  });
  const custodyProfileId = createAflTradeContentAddress('artifact-custody-profile', {
    environment: ENVIRONMENT,
    artifactClass: 'derived_private',
    fixture: 'local-fitzroy-factual-rehearsal',
  });
  const canonicalPayload = canonicalizeAflTradeJson(payload);
  await withRole(client, GOVERNANCE_ROLE, async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'application/json',$4,'derived_private',$5,$6,$7,$8,'{}'::jsonb)`,
      [
        artifactId,
        referenceSha256,
        `artifact://sha256/${referenceSha256}`,
        Buffer.byteLength(canonicalPayload),
        ENVIRONMENT,
        custodyProfileId,
        '2026-08-12T00:02:05.000Z',
        '2026-08-12T00:02:06.000Z',
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved',$3,
               jsonb_build_object('referenceSha256',$4::text),$5,$6)`,
      [
        approvalDecisionId,
        referenceId,
        'Disposable non-production rehearsal evidence approval.',
        referenceSha256,
        'local-rehearsal-governance-reviewer',
        '2026-08-12T00:02:07.000Z',
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,$3,$4,$5,'approved',$6,$7,$8::text,$8::jsonb)`,
      [
        referenceId,
        referenceSha256,
        evidenceKind,
        artifactId,
        ENVIRONMENT,
        approvalDecisionId,
        '2026-08-12T00:02:07.000Z',
        canonicalPayload,
      ]
    );
  });
  return { id: referenceId, sha256: referenceSha256 };
}

async function ensureNativeNamespace(
  client: AflOutcomeSqlClient,
  entityKind: 'player' | 'club'
): Promise<NativeNamespaceEvidence> {
  const definitionSha256 = sha256AflTradeCanonicalJson({
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    entityKind,
    kind: 'local-rehearsal-namespace',
  });
  const namespaceVersion = `${PROVIDER}-${entityKind}/local-rehearsal-v1`;
  const definition = {
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    entityKind,
    namespaceVersion,
    identityScope: { kind: 'competition', competition: COMPETITION },
    definitionSha256,
  } as const;
  const namespaceId = createAflTradeContentAddress('provider-native-id-namespace', definition);
  const approvalDecision = reference('provider-namespace-approval-decision', { namespaceId });
  const existing = await client.query(
    `SELECT namespace_id FROM outcome_provider_native_id_namespace WHERE namespace_id=$1`,
    [namespaceId]
  );
  if (existing.rows.length === 0) {
    await withRole(client, GOVERNANCE_ROLE, async (transaction) => {
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,
           decided_by,decided_at)
         VALUES ($1,'provider_native_id_namespace',$2,'approved',$3,'{}'::jsonb,$4,$5)`,
        [
          approvalDecision.id,
          namespaceId,
          'Approve one disposable non-production native-ID namespace.',
          'local-rehearsal-governance-reviewer',
          '2026-08-12T00:02:08.000Z',
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_provider_native_id_namespace
          (namespace_id,environment,provider,entity_kind,capability_id,namespace_version,
           identity_scope,competition,definition_sha256,definition_json,status,
           approval_decision_id,approval_decision_sha256,valid_from_season,
           valid_through_season,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'competition',$7,$8,$9::jsonb,'approved',$10,$11,
                 $12,$12,$13)`,
        [
          namespaceId,
          ENVIRONMENT,
          PROVIDER,
          entityKind,
          CAPABILITY_ID,
          namespaceVersion,
          COMPETITION,
          definitionSha256,
          canonicalizeAflTradeJson(definition),
          approvalDecision.id,
          approvalDecision.sha256,
          SEASON_YEAR,
          '2026-08-12T00:02:08.000Z',
        ]
      );
    });
  }
  return {
    namespaceId,
    definitionSha256,
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    entityKind,
    namespaceVersion,
    identityScope: { kind: 'competition', competition: COMPETITION },
    validFromSeason: SEASON_YEAR,
    validThroughSeason: SEASON_YEAR,
    approvalDecision,
  };
}

async function loadStagedProviderRow(
  client: AflOutcomeSqlClient,
  normalizationRunId: string
): Promise<StagedProviderRow> {
  const result = await client.query<StagedProviderRow>(
    `SELECT run.normalization_run_id,run.staging_sha256,run.finalized_at,
            field_map.field_map_sha256,row.provider_decoded_row_id,row.source_row_number,
            row.source_row_sha256,row.row_status::text,row.competition,row.season_year,
            identity.identity_candidate_id,identity.native_entity_id,identity.recorded_name,
            identity.recorded_club_id,identity.recorded_club_name,
            identity.candidate_sha256 AS identity_candidate_sha256,
            metric.candidate_json AS metric_candidate_json
       FROM outcome_provider_normalization_run run
       JOIN outcome_provider_field_map field_map USING (field_map_id)
       JOIN outcome_provider_decoded_row row USING (normalization_run_id)
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
      WHERE run.normalization_run_id=$1 AND metric.metric_code='goals'`,
    [normalizationRunId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    !row ||
    row.row_status !== 'staged' ||
    !row.native_entity_id ||
    !row.recorded_club_id ||
    !row.recorded_club_name ||
    row.metric_candidate_json.availability !== 'exact'
  ) {
    throw new TypeError('The local rehearsal staging row is not exactly promotable.');
  }
  return row;
}

function resolutionStaging(
  row: StagedProviderRow,
  namespace: NativeNamespaceEvidence,
  issueSet: { id: string; sha256: string },
  normalizationFinalization: { id: string; sha256: string }
) {
  return {
    normalizationRunId: row.normalization_run_id,
    stagingSha256: row.staging_sha256,
    providerDecodedRowId: row.provider_decoded_row_id,
    sourceRowSha256: row.source_row_sha256,
    candidateSha256: row.identity_candidate_sha256,
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    fieldMapSha256: row.field_map_sha256,
    normalizationFinalization,
    rowStatus: row.row_status,
    issueSet,
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    nativeIdNamespace: namespace,
    competition: COMPETITION,
    seasonYear: SEASON_YEAR,
  } as const;
}

function resolutionDecision(
  proposal: AflTradeProviderResolutionProposal,
  entityKind: 'player' | 'club',
  identityId: string,
  assignmentCaseId: string,
  reviewerAuthority: AflTradeProviderResolutionDecision['content']['reviewerAuthority']
) {
  return createAflTradeProviderResolutionDecision({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
    proposal,
    expectedRevision: 0,
    supersedesDecisionId: null,
    assignmentRevision: {
      assignmentCaseId,
      entityKind,
      identityId,
      expectedRevision: 0,
      supersedesDecisionId: null,
      nextStatus: 'active',
    },
    outcome: 'approved',
    rationale: 'The exact staged fixture identity matches its canonical local target.',
    reviewerAuthority,
    effectiveAt: '2026-08-12T00:03:10.000Z',
    decidedAt: '2026-08-12T00:03:10.000Z',
  });
}

async function resolveProviderIdentities(client: AflOutcomeSqlClient, row: StagedProviderRow) {
  const normalizationFinalizedAt = new Date(row.finalized_at).toISOString();
  const normalizationFinalization = reference('provider-normalization-finalization', {
    normalizationRunId: row.normalization_run_id,
    stagingSha256: row.staging_sha256,
    finalizedAt: normalizationFinalizedAt,
  });
  const issueSet = reference('provider-resolution-issue-set', {
    normalizationRunId: row.normalization_run_id,
    providerDecodedRowId: row.provider_decoded_row_id,
    issues: [],
  });
  const playerNamespace = await ensureNativeNamespace(client, 'player');
  const clubNamespace = await ensureNativeNamespace(client, 'club');
  const method = await ensureGovernedEvidence(client, 'provider_resolution_method', {
    methodVersion: 'local-fitzroy-rehearsal/v1',
  });
  const playerSnapshot = await ensureGovernedEvidence(client, 'canonical_target_snapshot', {
    playerId: 'afl-player:local-rehearsal',
    displayName: 'Player One',
  });
  const clubSnapshot = await ensureGovernedEvidence(client, 'canonical_target_snapshot', {
    clubId: 'afl-club:local-rehearsal',
    displayName: row.recorded_club_name,
  });
  const supportingEvidence = await ensureGovernedEvidence(client, 'provider_resolution_evidence', {
    source: 'local-fitzroy-rehearsal',
    candidateId: row.identity_candidate_id,
  });
  const reviewerAuthorityEvidence = await ensureGovernedEvidence(
    client,
    'reviewer_authority_evidence',
    {
      principalRef: PRINCIPAL_REF,
      role: 'afl_trade_identity_reviewer',
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      provider: PROVIDER,
      capabilityId: CAPABILITY_ID,
      competition: COMPETITION,
      validFromSeason: SEASON_YEAR,
      validThroughSeason: SEASON_YEAR,
    }
  );
  await client.query(
    `INSERT INTO outcome_operational_principal_authority
      (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,
       competition,valid_from_season,valid_through_season,valid_from,valid_through)
     VALUES ($1,$2,'afl_trade_identity_reviewer',$3,$4,$5,$6,$7,$7,$8,NULL)
     ON CONFLICT (authority_evidence_id) DO NOTHING`,
    [
      reviewerAuthorityEvidence.id,
      PRINCIPAL_REF,
      AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      PROVIDER,
      CAPABILITY_ID,
      COMPETITION,
      SEASON_YEAR,
      '2026-01-01T00:00:00.000Z',
    ]
  );
  await client.query(
    `INSERT INTO outcome_player (player_id,display_name,status)
     VALUES ('afl-player:local-rehearsal','Player One','approved') ON CONFLICT DO NOTHING`
  );
  await client.query(
    `INSERT INTO outcome_club (club_id,current_name,status)
     VALUES ('afl-club:local-rehearsal',$1,'approved') ON CONFLICT DO NOTHING`,
    [row.recorded_club_name]
  );
  const reviewerAuthority = {
    principalRef: PRINCIPAL_REF,
    authorityEvidence: reviewerAuthorityEvidence,
    role: 'afl_trade_identity_reviewer' as const,
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    competition: COMPETITION,
    validFromSeason: SEASON_YEAR,
    validThroughSeason: SEASON_YEAR,
  };
  const playerIdentityId = createAflTradeContentAddress('provider-player-identity', {
    nativeIdNamespaceId: playerNamespace.namespaceId,
    nativePlayerId: row.native_entity_id,
  });
  const playerAssignmentCaseId = createAflTradeContentAddress('provider-identity-assignment-case', {
    entityKind: 'player',
    identityId: playerIdentityId,
  });
  const playerProposal = createAflTradeProviderResolutionProposal({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      subjectType: 'provider_player_candidate',
      identityCandidateId: row.identity_candidate_id,
    }),
    subjectType: 'provider_player_candidate',
    identityCandidateId: row.identity_candidate_id,
    candidate: {
      nativePlayerId: row.native_entity_id,
      recordedName: row.recorded_name,
      recordedClubId: row.recorded_club_id,
      recordedClubName: row.recorded_club_name,
    },
    proposedTarget: {
      scope: 'provider_identity',
      playerIdentityId,
      assignmentCaseId: playerAssignmentCaseId,
      playerId: 'afl-player:local-rehearsal',
    },
    alternativePlayerIds: [],
    method,
    staging: resolutionStaging(row, playerNamespace, issueSet, normalizationFinalization),
    canonicalTargetSnapshot: playerSnapshot,
    supportingEvidence: [supportingEvidence],
    proposedAt: '2026-08-12T00:03:00.000Z',
  });
  const playerDecision = resolutionDecision(
    playerProposal,
    'player',
    playerIdentityId,
    playerAssignmentCaseId,
    reviewerAuthority
  );
  const clubIdentityId = createAflTradeContentAddress('provider-club-identity', {
    nativeIdNamespaceId: clubNamespace.namespaceId,
    nativeClubId: row.recorded_club_id,
  });
  const clubAssignmentCaseId = createAflTradeContentAddress('provider-identity-assignment-case', {
    entityKind: 'club',
    identityId: clubIdentityId,
  });
  const occurrence = {
    source: 'player_affiliation' as const,
    identityCandidateId: row.identity_candidate_id,
  };
  const clubProposal = createAflTradeProviderResolutionProposal({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      subjectType: 'provider_club_candidate',
      occurrence,
    }),
    subjectType: 'provider_club_candidate',
    occurrence,
    candidate: { nativeClubId: row.recorded_club_id, recordedName: row.recorded_club_name },
    proposedTarget: {
      scope: 'provider_identity',
      clubIdentityId,
      assignmentCaseId: clubAssignmentCaseId,
      clubId: 'afl-club:local-rehearsal',
    },
    alternativeClubIds: [],
    method,
    staging: resolutionStaging(row, clubNamespace, issueSet, normalizationFinalization),
    canonicalTargetSnapshot: clubSnapshot,
    supportingEvidence: [supportingEvidence],
    proposedAt: '2026-08-12T00:03:01.000Z',
  });
  const clubDecision = resolutionDecision(
    clubProposal,
    'club',
    clubIdentityId,
    clubAssignmentCaseId,
    reviewerAuthority
  );
  const repository = new PostgresAflTradeProviderResolutionRepository(client);
  const execution = { principalRef: PRINCIPAL_REF, environment: ENVIRONMENT } as const;
  const playerPersistence = await repository.persistDecision(playerDecision, execution);
  const clubPersistence = await repository.persistDecision(clubDecision, execution);
  return {
    normalizationFinalizedAt,
    normalizationFinalization,
    issueSet,
    player: {
      mappingScope: 'provider_identity' as const,
      resolutionCaseId: playerProposal.content.resolutionCaseId,
      revision: playerPersistence.revision,
      decision: { id: playerDecision.decisionId, sha256: playerDecision.decisionSha256 },
      canonicalTargetSnapshot: playerSnapshot,
      identityCandidateId: row.identity_candidate_id,
      playerIdentityId,
      playerId: 'afl-player:local-rehearsal',
      assignment: {
        assignmentCaseId: playerAssignmentCaseId,
        entityKind: 'player' as const,
        revision: 1,
        decisionId: playerDecision.decisionId,
        status: 'active' as const,
      },
    },
    club: {
      mappingScope: 'provider_identity' as const,
      resolutionCaseId: clubProposal.content.resolutionCaseId,
      revision: clubPersistence.revision,
      decision: { id: clubDecision.decisionId, sha256: clubDecision.decisionSha256 },
      canonicalTargetSnapshot: clubSnapshot,
      occurrence,
      clubIdentityId,
      clubId: 'afl-club:local-rehearsal',
      assignment: {
        assignmentCaseId: clubAssignmentCaseId,
        entityKind: 'club' as const,
        revision: 1,
        decisionId: clubDecision.decisionId,
        status: 'active' as const,
      },
    },
    reviewDecisionId: playerDecision.decisionId,
    idempotentReplay: playerPersistence.idempotentReplay && clubPersistence.idempotentReplay,
  };
}

async function createAndPersistFactBatch(
  client: AflOutcomeSqlClient,
  captureId: string,
  row: StagedProviderRow,
  resolutions: Awaited<ReturnType<typeof resolveProviderIdentities>>
) {
  const goalsDefinition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.find(
    ({ metric }) => metric === 'goals'
  );
  if (!goalsDefinition) throw new TypeError('The governed goals metric definition is missing.');
  const metricDefinition = {
    id: goalsDefinition.metricDefinitionId,
    sha256: goalsDefinition.metricDefinitionId.slice('metric-definition:'.length),
  };
  const source = {
    captureId,
    normalizationRunId: row.normalization_run_id,
    normalizationFinalization: resolutions.normalizationFinalization,
    normalizationFinalizedAt: resolutions.normalizationFinalizedAt,
    stagingSha256: row.staging_sha256,
    providerDecodedRowId: row.provider_decoded_row_id,
    sourceRowNumber: row.source_row_number,
    sourceRowSha256: row.source_row_sha256,
    semanticNaturalKeySha256: sha256AflTradeCanonicalJson({
      matchId: 'provider-match-1',
      playerId: row.native_entity_id,
    }),
    candidateDigests: {
      identity: row.identity_candidate_sha256,
      match: null,
      metric: sha256AflTradeCanonicalJson(row.metric_candidate_json),
      achievement: null,
      appearance: null,
    },
    rowStatus: row.row_status,
    issueSet: resolutions.issueSet,
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    consumedSourceFields: ['goals', 'player_id'],
  } as const;
  const fact = createAflTradeSourceFact({
    schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    competition: COMPETITION,
    seasonYear: SEASON_YEAR,
    fieldMapSha256: row.field_map_sha256,
    effectiveAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.effectiveAt,
    recordedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.factBatchCreatedAt,
    source,
    factKind: 'player_season_metric',
    player: resolutions.player,
    seasonClubScope: { kind: 'resolved_single_club', club: resolutions.club },
    metricCode: 'goals',
    definitionVersion: 'goals/v1',
    definition: metricDefinition,
    unit: 'goals',
    availability: {
      state: 'measured',
      numericValue: row.metric_candidate_json.numericValue,
      reasonCode: null,
    },
  });
  const rowAccounting = [
    {
      providerDecodedRowId: row.provider_decoded_row_id,
      sourceRowSha256: row.source_row_sha256,
      disposition: 'normalized' as const,
      factIds: [fact.factId],
      issueSet: resolutions.issueSet,
      issueIds: [],
      blockingIssueIds: [],
      blockingIssueClosures: [],
      reasonCode: null,
    },
  ];
  const batch = createAflTradeSourceFactBatch({
    schemaVersion: AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: ENVIRONMENT,
    provider: PROVIDER,
    capabilityId: CAPABILITY_ID,
    competition: COMPETITION,
    seasonYear: SEASON_YEAR,
    captureId,
    normalizationRunId: row.normalization_run_id,
    normalizationFinalization: resolutions.normalizationFinalization,
    normalizationFinalizedAt: resolutions.normalizationFinalizedAt,
    fieldMapSha256: row.field_map_sha256,
    stagingSha256: row.staging_sha256,
    sourceRowSetSha256: sha256AflTradeCanonicalJson(
      rowAccounting.map(({ providerDecodedRowId, sourceRowSha256 }) => ({
        providerDecodedRowId,
        sourceRowSha256,
      }))
    ),
    sourceIssueSetSha256: sha256AflTradeCanonicalJson(
      rowAccounting.map(
        ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        }) => ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        })
      )
    ),
    createdAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.factBatchCreatedAt,
    sourceRowCount: 1,
    sourceIssueCount: 0,
    facts: [fact],
    rowAccounting,
    counts: {
      matchUniverse: 0,
      playerAppearances: 0,
      playerMatchMetrics: 0,
      playerSeasonMetrics: 1,
      playerAchievements: 0,
      normalizedRows: 1,
      nonNormalizedRows: 0,
    },
  });
  const persisted = await new PostgresAflTradeFactualObservationRepository(client).persistBatch(
    batch,
    { environment: ENVIRONMENT }
  );
  return { batch, fact, metricDefinition, persisted };
}

async function ensureFactualPolicyReview(
  client: AflOutcomeSqlClient,
  policyId: string,
  approval: { id: string; sha256: string }
): Promise<void> {
  const existing = await client.query(
    `SELECT decision_id FROM outcome_review_decision WHERE decision_id=$1`,
    [approval.id]
  );
  if (existing.rows.length > 0) return;
  await withRole(client, FACTUAL_POLICY_ROLE, async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,
         decided_by,decided_at)
       VALUES ($1,'factual_reconciliation_policy',$2,'approved',$3,
               jsonb_build_object('environment',$4::text),$5,$6)`,
      [
        approval.id,
        policyId,
        'Approve the exact local non-production factual reconciliation policy.',
        ENVIRONMENT,
        'local-rehearsal-factual-reviewer',
        '2026-08-12T00:03:35.000Z',
      ]
    );
  });
}

async function createAndPersistFactualRun(
  client: AflOutcomeSqlClient,
  batch: Awaited<ReturnType<typeof createAndPersistFactBatch>>
) {
  const gamesDefinition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.find(
    ({ metric }) => metric === 'games'
  );
  if (!gamesDefinition) throw new TypeError('The governed games metric definition is missing.');
  const approval = reference('factual-reconciliation-policy-approval', {
    environment: ENVIRONMENT,
    policyVersion: 'local-fitzroy-rehearsal/v1',
  });
  const policy = createAflTradeFactualReconciliationPolicy({
    schemaVersion: AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: ENVIRONMENT,
    competition: COMPETITION,
    validFromSeason: SEASON_YEAR,
    validThroughSeason: SEASON_YEAR,
    policyVersion: 'local-fitzroy-rehearsal/v1',
    approval,
    sourceMetricRules: [
      {
        ruleKind: 'source_metric',
        metricCode: 'goals',
        definitionVersion: 'goals/v1',
        definition: batch.metricDefinition,
        grain: 'season',
        unit: 'goals',
        comparison: 'exact_non_negative_integer',
        missingValueSemantics: 'never_zero_and_never_did_not_play',
        fallback: 'next_priority_only_when_higher_priority_has_no_measured_value',
        conflict: 'same_priority_distinct_measured_values_are_conflicting',
        sources: [{ priority: 1, provider: PROVIDER, capabilityId: CAPABILITY_ID }],
      },
    ],
    gamesRule: {
      ruleKind: 'derived_games',
      metricCode: 'games',
      definitionVersion: 'games/v1',
      definition: {
        id: gamesDefinition.metricDefinitionId,
        sha256: gamesDefinition.metricDefinitionId.slice('metric-definition:'.length),
      },
      grain: 'match',
      unit: 'games',
      derivation: 'one_only_for_completed_match_and_authenticated_observed_appearance',
      absenceSemantics: 'absence_is_unknown_never_zero_or_did_not_play',
      completionConflict: 'distinct_preferred_completion_states_are_conflicting',
      appearanceSources: [{ priority: 1, provider: PROVIDER, capabilityId: CAPABILITY_ID }],
      matchUniverseSources: [
        { priority: 1, provider: 'official_afl', capabilityId: 'official-afl-results' },
      ],
    },
    createdAt: '2026-08-12T00:03:40.000Z',
  });
  await ensureFactualPolicyReview(client, policy.policyId, approval);
  const repository = new PostgresAflTradeFactualReconciliationRepository(client);
  await repository.persistPolicy(policy, { environment: ENVIRONMENT });
  const run = reconcileAflTradeFactualFacts({
    policy,
    sourceMemberships: [
      {
        factBatchId: batch.batch.batchId,
        factBatchSha256: batch.batch.batchSha256,
        fact: batch.fact,
      },
    ],
    currentHeadRevisions: [],
    startedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.reconciliationStartedAt,
    completedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.reconciliationCompletedAt,
  });
  const persisted = await repository.persistRun(run, { environment: ENVIRONMENT });
  return { run, persisted };
}

function createPrivateCandidate(input: {
  captureId: string;
  sourceSnapshotId: string;
  gateDecisionId: string;
  sourceRights: ReturnType<
    typeof createLocalAflTradeFitzRoyFactualRehearsalFixture
  >['command']['capture']['sourceRights'];
  gate0aReceipt: AflDraftTradeOutcomeFactualReleaseManifest['content']['sourceRightsBindings'][number]['gate0aReceipt'];
  factual: Awaited<ReturnType<typeof createAndPersistFactualRun>>;
  factBatch: Awaited<ReturnType<typeof createAndPersistFactBatch>>;
  reviewDecisionId: string;
}) {
  const result = input.factual.run.content.results[0];
  const head = input.factual.run.content.headAdvances[0];
  if (
    !result ||
    !head ||
    result.content.resultKind !== 'source_metric' ||
    result.content.metricCode !== 'goals'
  ) {
    throw new TypeError('The local rehearsal requires one reconciled source metric.');
  }
  const recordedAt = LOCAL_FITZROY_REHEARSAL_INSTANTS.candidateCreatedAt;
  const consumedSourceFields = input.gate0aReceipt.content.request.fieldUses
    .map(({ sourceField }) => sourceField)
    .sort();
  const finalization = createAflTradeFactualReconciliationFinalization({
    factualRunId: input.factual.run.factualRunId,
    runSha256: input.factual.run.runSha256,
    finalizedAt: input.factual.run.content.completedAt,
  });
  const members = {
    sourceCaptures: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({ captureId: input.captureId }),
        recordedAt,
        captureId: input.captureId,
        sourceSnapshotId: input.sourceSnapshotId,
        gate0aDecisionId: input.gateDecisionId,
        consumedFieldSetSha256: sha256AflTradeCanonicalJson(consumedSourceFields),
      },
    ],
    eventVersions: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({ event: 'local-rehearsal-event-v1' }),
        recordedAt,
        eventVersionId: 'local-rehearsal-event-v1',
        eventId: 'local-rehearsal-event',
      },
    ],
    lineageEdges: [],
    acquisitionSpells: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({ spell: 'local-rehearsal-spell-v1' }),
        recordedAt,
        spellVersionId: reference('acquisition-spell-version', {
          fixture: 'local-fitzroy-rehearsal',
        }).id,
        spellId: 'local-rehearsal-spell',
        playerId: 'afl-player:local-rehearsal',
        clubId: 'afl-club:local-rehearsal',
        startDate: '2026-01-01',
        endDate: null,
      },
    ],
    factualRuns: [
      {
        ordinal: 1,
        recordSha256: input.factual.run.runSha256,
        recordedAt,
        factualRunId: input.factual.run.factualRunId,
        finalization,
        competition: COMPETITION,
        seasonYear: SEASON_YEAR,
      },
    ],
    reconciledMetrics: [
      {
        ordinal: 1,
        recordSha256: result.factSha256,
        recordedAt,
        reconciledFactId: result.reconciledFactId,
        factualRunId: input.factual.run.factualRunId,
        subjectKey: head.subjectKey,
        headRevision: head.nextRevision,
        playerId: result.content.playerId,
        clubId:
          result.content.clubScope.kind === 'resolved_single_club'
            ? result.content.clubScope.clubId
            : null,
        competition: result.content.competition,
        seasonYear: result.content.seasonYear,
        metricCode: 'goals' as const,
        definition: result.content.definition,
        state: result.content.availability.state,
        effectiveThrough: result.content.effectiveThrough,
      },
    ],
    achievementRuns: [],
    reconciledAchievements: [],
    spellMetrics: [],
    reviewDecisions: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({ decisionId: input.reviewDecisionId }),
        recordedAt,
        decisionId: input.reviewDecisionId,
        subjectType: 'provider_identity',
      },
    ],
  };
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const archiveDataset = reference('archive-dataset', { fixture: 'local-fitzroy-rehearsal' });
  const sourceSnapshotSet = reference('source-snapshot-set', {
    sourceSnapshotId: input.sourceSnapshotId,
  });
  const acquisitionSpellRule = reference('acquisition-spell-rule', {
    fixture: 'local-fitzroy-rehearsal',
  });
  const release = createAflDraftTradeOutcomeFactualReleaseManifest({
    schemaVersion: 'afl-draft-trade-outcome-release/v2',
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    environment: ENVIRONMENT,
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    createdAt: recordedAt,
    effectiveThrough: LOCAL_FITZROY_REHEARSAL_INSTANTS.effectiveAt,
    archiveDatasetId: archiveDataset.id,
    sourceSnapshotSetId: sourceSnapshotSet.id,
    outcomeEvaluationSetId: reference('outcome-evaluation', {
      fixture: 'local-fitzroy-rehearsal',
    }).id,
    acquisitionSpellRuleId: acquisitionSpellRule.id,
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metricDefinitions: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.filter(
      ({ metric }) => metric === 'goals'
    ),
    sourceRightsBindings: [
      {
        sourceSnapshotId: input.sourceSnapshotId,
        sourceRightsArtifactId: input.sourceRights.rightsArtifactId,
        gateDecisionId: input.gateDecisionId,
        sourceRightsProposal: input.sourceRights,
        gate0aReceipt: input.gate0aReceipt,
        consumedSourceFields,
      },
    ],
    reconciliationReportArtifact: createAflTradeCanonicalJsonArtifactRef(
      { factualRunId: input.factual.run.factualRunId },
      recordedAt
    ),
    exceptionReportArtifact: createAflTradeCanonicalJsonArtifactRef({ exceptions: [] }, recordedAt),
    supportedScope: ['One source-independent non-production fitzRoy goals observation'],
    excludedScope: ['Live source access', 'Public activation', 'Valuation and fantasy ownership'],
    outcomeRecordCount: 1,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
    factualCandidateSchemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    sourceMemberSetSha256: memberSetSha256,
  });
  const counts = Object.fromEntries(
    Object.entries(members).map(([kind, values]) => [kind, values.length])
  ) as { [Kind in keyof typeof members]: number };
  return createAflTradeFactualReleaseCandidate({
    schemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: ENVIRONMENT,
    scopeKey: release.content.scopeKey,
    competition: COMPETITION,
    validFromSeason: SEASON_YEAR,
    validThroughSeason: SEASON_YEAR,
    createdAt: recordedAt,
    effectiveThrough: release.content.effectiveThrough,
    targetRelease: {
      id: release.releaseId,
      sha256: release.releaseId.slice('outcome-release:'.length),
    },
    targetReleaseManifest: release,
    archiveDataset,
    sourceSnapshotSet,
    metricRegistryVersion: release.content.metricRegistryVersion,
    acquisitionSpellRule,
    members,
    memberSetSha256,
    counts,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  });
}

export async function runLocalAflTradeFitzRoyFactualRehearsal(
  client: AflOutcomeSqlClient,
  options?: { goals?: string }
): Promise<LocalAflTradeFitzRoyFactualRehearsalReceipt> {
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [COMPETITION, SEASON_YEAR]
  );
  await client.query(
    `INSERT INTO outcome_metric_definition
      (metric_code,definition_version,display_name,value_type,canonical_unit,
       non_negative,definition_json,status)
     VALUES
       ('goals','goals/v1','Goals','numeric','goals',true,'{}'::jsonb,'approved'),
       ('games','games/v1','Games','numeric','games',true,'{}'::jsonb,'approved')
     ON CONFLICT DO NOTHING`
  );
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fixture.command.fieldMap);
  await ensureFieldMapReview(client, fixture.command.fieldMap, fieldMapSha256);
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);
  const normalizationTimes = [
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationStartedAt,
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
  ];
  const ingestion = await ingestAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    staging: {
      rawArtifactRepository: fixture.rawArtifactRepository,
      sourceCaptureRepository,
      providerObservationRepository,
      decoderExecutor: fixture.decoderExecutor,
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
  const row = await loadStagedProviderRow(
    client,
    ingestion.staging.normalization.normalizationRunId
  );
  const resolutions = await resolveProviderIdentities(client, row);
  const factBatch = await createAndPersistFactBatch(
    client,
    ingestion.staging.capture.captureId,
    row,
    resolutions
  );
  const factual = await createAndPersistFactualRun(client, factBatch);
  const candidate = createPrivateCandidate({
    captureId: ingestion.staging.capture.captureId,
    sourceSnapshotId: ingestion.snapshotId,
    gateDecisionId: fixture.gateDecisionId,
    sourceRights: fixture.command.capture.sourceRights,
    gate0aReceipt: ingestion.receipt.content.authorizationReceipt,
    factual,
    factBatch,
    reviewDecisionId: resolutions.reviewDecisionId,
  });
  return {
    environment: ENVIRONMENT,
    publicationEligible: false,
    captureId: ingestion.staging.capture.captureId,
    normalizationRunId: ingestion.staging.normalization.normalizationRunId,
    factBatchId: factBatch.batch.batchId,
    factualRunId: factual.run.factualRunId,
    candidateId: candidate.candidateId,
    counts: { sourceRows: 1, sourceIssues: 0, factualRuns: 1, candidates: 1 },
    idempotentReplay:
      ingestion.staging.capture.idempotentReplay &&
      ingestion.staging.normalization.idempotentReplay &&
      resolutions.idempotentReplay &&
      factBatch.persisted.idempotentReplay &&
      factual.persisted.idempotentReplay,
  };
}
