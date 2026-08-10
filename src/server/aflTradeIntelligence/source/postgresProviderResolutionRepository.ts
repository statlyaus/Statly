import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeProviderResolutionDecisionSchema,
  type AflTradeProviderResolutionDecision,
  type AflTradeProviderResolutionProposalContent,
} from './providerResolutionContracts';

export interface PersistedAflTradeProviderResolution {
  decisionId: string;
  proposalId: string;
  resolutionCaseId: string;
  revision: number;
  outcome: 'approved' | 'ambiguous' | 'rejected' | 'deferred';
  idempotentReplay: boolean;
}

export interface AflTradeProviderResolutionExecutionContext {
  principalRef: string;
  environment: 'test_fixture' | 'non_production' | 'production';
}

export class AflTradeProviderResolutionPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DECISION'
      | 'STAGING_MISMATCH'
      | 'NAMESPACE_NOT_CURRENT'
      | 'AUTHORITY_MISMATCH'
      | 'EVIDENCE_MISSING'
      | 'TARGET_MISMATCH'
      | 'STALE_REVISION'
      | 'DECISION_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeProviderResolutionPersistenceError';
  }
}

interface StagingRow {
  finalized_at: string | Date | null;
  staging_sha256: string;
  field_map_id: string;
  field_map_sha256: string;
  field_map_approval_current: boolean;
  provider_decoded_row_id: string;
  source_row_sha256: string;
  row_status: string;
  competition: string;
  season_year: number;
  source_row_number: number;
  environment: string;
  provider: string;
  capability_id: string | null;
  identity_candidate_id: string | null;
  match_candidate_id: string | null;
  identity_candidate_json: unknown | null;
  match_candidate_json: unknown | null;
}

interface IssueRow {
  issue_id: string;
  issue_code: string;
  source_field: string | null;
  details_json: unknown;
}

export class PostgresAflTradeProviderResolutionRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistDecision(
    input: unknown,
    execution: AflTradeProviderResolutionExecutionContext
  ): Promise<PersistedAflTradeProviderResolution> {
    let decision: AflTradeProviderResolutionDecision;
    try {
      decision = aflTradeProviderResolutionDecisionSchema.parse(input);
    } catch (error) {
      throw new AflTradeProviderResolutionPersistenceError(
        'INVALID_DECISION',
        error instanceof Error ? error.message : 'Provider resolution decision is invalid.'
      );
    }
    if (
      !execution ||
      !execution.principalRef ||
      !['test_fixture', 'non_production', 'production'].includes(execution.environment) ||
      execution.principalRef !== decision.content.reviewerAuthority.principalRef ||
      execution.environment !== decision.content.proposal.content.staging.environment
    ) {
      throw new AflTradeProviderResolutionPersistenceError(
        'AUTHORITY_MISMATCH',
        'The authenticated operational principal and environment must equal the governed decision.'
      );
    }

    return this.client.transaction(async (transaction) => {
      await acquireDecisionLocks(transaction, decision);
      const replay = await transaction.query<{ decision_json: unknown; revision: number }>(
        `SELECT decision_json, revision FROM (
           SELECT decision_json, revision, decision_id FROM outcome_provider_player_resolution
           UNION ALL SELECT decision_json, revision, decision_id FROM outcome_provider_club_resolution
           UNION ALL SELECT decision_json, revision, decision_id FROM outcome_provider_match_resolution
         ) decisions WHERE decision_id = $1`,
        [decision.decisionId]
      );
      if (replay.rows[0]) {
        if (
          canonicalizeAflTradeJson(replay.rows[0].decision_json) !==
          canonicalizeAflTradeJson(decision)
        ) {
          throw new AflTradeProviderResolutionPersistenceError(
            'DECISION_CONFLICT',
            'The decision ID already exists with different immutable content.'
          );
        }
        return result(decision, replay.rows[0].revision, true);
      }

      await requireExpectedResolutionRevision(transaction, decision);

      const proposal = decision.content.proposal;
      const content = proposal.content;
      const stagingRow = await requireExactStaging(transaction, content, execution.environment);
      await requireGovernedEvidence(transaction, decision, execution);
      await requireCurrentNamespace(transaction, content);
      const issues = await loadIssues(transaction, content.staging.normalizationRunId, stagingRow);
      requireIssueEvidence(content, issues);
      await requireCurrentClosures(transaction, content, issues);
      await requireCanonicalTarget(transaction, content);

      await insertProposal(transaction, proposal);
      for (const closure of content.staging.blockingIssueClosures) {
        await transaction.query(
          `INSERT INTO outcome_provider_resolution_issue_closure
             (proposal_id, issue_id, closure_id, closure_sha256)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (proposal_id, issue_id) DO NOTHING`,
          [proposal.proposalId, closure.issueId, closure.decision.id, closure.decision.sha256]
        );
        const storedClosure = await transaction.query<{
          closure_id: string;
          closure_sha256: string;
        }>(
          `SELECT closure_id, closure_sha256
             FROM outcome_provider_resolution_issue_closure
            WHERE proposal_id = $1 AND issue_id = $2`,
          [proposal.proposalId, closure.issueId]
        );
        if (
          storedClosure.rows[0]?.closure_id !== closure.decision.id ||
          storedClosure.rows[0]?.closure_sha256 !== closure.decision.sha256
        ) {
          throw new AflTradeProviderResolutionPersistenceError(
            'DECISION_CONFLICT',
            'The proposal issue closure already exists with different immutable content.'
          );
        }
      }
      await insertReviewDecision(transaction, decision);
      const revision = decision.content.expectedRevision + 1;
      await insertApprovedIdentityRoot(transaction, decision);
      await insertTypedResolution(transaction, decision, revision);
      await insertApprovedIdentityOccurrence(transaction, decision);
      return result(decision, revision, false);
    });
  }
}

async function requireExpectedResolutionRevision(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision
) {
  const head = await transaction.query<{ revision: number; resolution_id: string }>(
    `SELECT revision, resolution_id FROM (
       SELECT revision, resolution_id, resolution_case_id FROM outcome_provider_player_resolution_head
       UNION ALL SELECT revision, resolution_id, resolution_case_id FROM outcome_provider_club_resolution_head
       UNION ALL SELECT revision, resolution_id, resolution_case_id FROM outcome_provider_match_resolution_head
     ) heads WHERE resolution_case_id = $1`,
    [decision.content.proposal.content.resolutionCaseId]
  );
  const current = head.rows[0];
  const expectedRevision = decision.content.expectedRevision;
  const expectedPredecessor = decision.content.supersedesDecisionId;
  if (
    head.rows.length > 1 ||
    (current === undefined && (expectedRevision !== 0 || expectedPredecessor !== null)) ||
    (current !== undefined &&
      (current.revision !== expectedRevision || current.resolution_id !== expectedPredecessor))
  ) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STALE_REVISION',
      'The provider resolution case has advanced beyond the expected revision.'
    );
  }
}

async function acquireDecisionLocks(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision
) {
  const content = decision.content.proposal.content;
  const lockKeys = [
    `provider-resolution:${content.resolutionCaseId}`,
    `outcome-review-subject:provider_resolution_case:${content.resolutionCaseId}`,
  ];
  const run = await transaction.query<{ field_map_id: string }>(
    `SELECT field_map_id FROM outcome_provider_normalization_run WHERE normalization_run_id = $1`,
    [content.staging.normalizationRunId]
  );
  if (run.rows[0]) {
    lockKeys.push(`outcome-review-subject:provider_field_map:${run.rows[0].field_map_id}`);
  }
  if (decision.content.assignmentRevision !== null) {
    lockKeys.push(`provider-assignment:${decision.content.assignmentRevision.assignmentCaseId}`);
  }
  if (content.staging.nativeIdNamespace !== null) {
    lockKeys.push(
      `outcome-review-subject:provider_native_id_namespace:${content.staging.nativeIdNamespace.namespaceId}`
    );
  }
  for (const reference of governedEvidenceReferences(decision)) {
    lockKeys.push(`outcome-review-subject:governed_evidence_reference:${reference.id}`);
  }
  for (const closure of content.staging.blockingIssueClosures) {
    lockKeys.push(`outcome-review-subject:provider_normalization_issue:${closure.issueId}`);
  }
  if (content.subjectType === 'provider_match_candidate' && content.proposedTarget !== null) {
    for (const decisionId of [
      content.proposedTarget.homeClubResolutionDecisionId,
      content.proposedTarget.awayClubResolutionDecisionId,
    ]) {
      const referenced = await transaction.query<{
        resolution_case_id: string;
        assignment_case_id: string | null;
      }>(
        `SELECT resolution_case_id, assignment_case_id
           FROM outcome_provider_club_resolution WHERE decision_id = $1`,
        [decisionId]
      );
      if (referenced.rows[0]) {
        lockKeys.push(
          `provider-resolution:${referenced.rows[0].resolution_case_id}`,
          `outcome-review-subject:provider_resolution_case:${referenced.rows[0].resolution_case_id}`
        );
        if (referenced.rows[0].assignment_case_id !== null) {
          lockKeys.push(`provider-assignment:${referenced.rows[0].assignment_case_id}`);
        }
      }
    }
  }
  for (const lockKey of [...new Set(lockKeys)].sort()) {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey]);
  }
}

function governedEvidenceReferences(decision: AflTradeProviderResolutionDecision) {
  const proposal = decision.content.proposal.content;
  const references: Array<{
    id: string;
    sha256: string;
    kind: string;
  }> = [
    { ...proposal.method, kind: 'provider_resolution_method' },
    { ...proposal.canonicalTargetSnapshot, kind: 'canonical_target_snapshot' },
    ...proposal.supportingEvidence.map((reference) => ({
      ...reference,
      kind: 'provider_resolution_evidence',
    })),
    {
      ...decision.content.reviewerAuthority.authorityEvidence,
      kind: 'reviewer_authority_evidence',
    },
  ];
  const target = proposal.proposedTarget;
  if (target !== null && 'evidencePolicy' in target) {
    references.push({ ...target.evidencePolicy, kind: 'provider_resolution_policy' });
  }
  if (target !== null && 'normalizationPolicy' in target) {
    references.push({ ...target.normalizationPolicy, kind: 'provider_resolution_policy' });
  }
  return references;
}

async function requireGovernedEvidence(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision,
  execution: AflTradeProviderResolutionExecutionContext
) {
  for (const reference of governedEvidenceReferences(decision)) {
    const found = await transaction.query(
      `SELECT 1
         FROM outcome_governed_evidence_reference evidence
         JOIN outcome_artifact_custody artifact ON artifact.artifact_id = evidence.artifact_id
        WHERE evidence.reference_id = $1 AND evidence.reference_sha256 = $2
          AND evidence.evidence_kind = $3 AND evidence.environment = $4
          AND evidence.status = 'approved' AND artifact.environment = evidence.environment
          AND artifact.artifact_class IN ('capture_metadata','derived_private','public_projection')
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id = evidence.approval_decision_id
          )`,
      [reference.id, reference.sha256, reference.kind, execution.environment]
    );
    if (!found.rows[0]) {
      throw new AflTradeProviderResolutionPersistenceError(
        'EVIDENCE_MISSING',
        `Required governed evidence is absent or no longer approved: ${reference.kind}.`
      );
    }
  }
  const authority = decision.content.reviewerAuthority;
  const currentAuthority = await transaction.query(
    `SELECT 1
       FROM outcome_operational_principal_authority authority
       JOIN outcome_governed_evidence_reference evidence
         ON evidence.reference_id = authority.authority_evidence_id
      WHERE authority.authority_evidence_id = $1 AND authority.principal_ref = $2
        AND authority.role = $3 AND authority.scope_key = $4
        AND authority.provider = $8 AND authority.capability_id = $9
        AND authority.competition = $10
        AND $11::integer BETWEEN authority.valid_from_season AND authority.valid_through_season
        AND authority.valid_from <= statement_timestamp()
        AND (authority.valid_through IS NULL OR authority.valid_through >= statement_timestamp())
        AND $5::timestamptz <= statement_timestamp()
        AND evidence.reference_sha256 = $6 AND evidence.environment = $7
        AND evidence.status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id = evidence.approval_decision_id
        )`,
    [
      authority.authorityEvidence.id,
      execution.principalRef,
      authority.role,
      authority.scopeKey,
      decision.content.decidedAt,
      authority.authorityEvidence.sha256,
      execution.environment,
      decision.content.proposal.content.staging.provider,
      decision.content.proposal.content.staging.capabilityId,
      decision.content.proposal.content.staging.competition,
      decision.content.proposal.content.staging.seasonYear,
    ]
  );
  if (!currentAuthority.rows[0]) {
    throw new AflTradeProviderResolutionPersistenceError(
      'AUTHORITY_MISMATCH',
      'The authenticated principal has no current scoped reviewer authority.'
    );
  }
}

async function requireExactStaging(
  transaction: AflOutcomeSqlTransaction,
  content: AflTradeProviderResolutionProposalContent,
  executionEnvironment: AflTradeProviderResolutionExecutionContext['environment']
): Promise<StagingRow> {
  const result = await transaction.query<StagingRow>(
    `SELECT run.finalized_at, run.staging_sha256, run.field_map_id,
            field_map.field_map_sha256,
            NOT EXISTS (
              SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id = field_map.approval_decision_id
            ) AS field_map_approval_current,
            row.provider_decoded_row_id, row.source_row_sha256, row.row_status,
            row.competition, row.season_year, row.source_row_number,
            capture.environment, capture.provider, capture.capability_id,
            identity.identity_candidate_id, match.match_candidate_id,
            identity.candidate_json AS identity_candidate_json,
            match.candidate_json AS match_candidate_json
       FROM outcome_provider_normalization_run run
       JOIN outcome_provider_field_map field_map ON field_map.field_map_id = run.field_map_id
       JOIN outcome_source_capture capture ON capture.capture_id = run.capture_id
       JOIN outcome_provider_decoded_row row ON row.normalization_run_id = run.normalization_run_id
       LEFT JOIN outcome_provider_identity_candidate identity ON identity.provider_decoded_row_id = row.provider_decoded_row_id
       LEFT JOIN outcome_provider_match_candidate match ON match.provider_decoded_row_id = row.provider_decoded_row_id
      WHERE run.normalization_run_id = $1 AND row.provider_decoded_row_id = $2
      FOR SHARE OF run, row`,
    [content.staging.normalizationRunId, content.staging.providerDecodedRowId]
  );
  const row = result.rows[0];
  const candidateJson =
    content.subjectType === 'provider_match_candidate' ||
    (content.subjectType === 'provider_club_candidate' &&
      content.occurrence.source === 'match_side')
      ? row?.match_candidate_json
      : row?.identity_candidate_json;
  const expectedCandidateId =
    content.subjectType === 'provider_player_candidate'
      ? content.identityCandidateId
      : content.subjectType === 'provider_match_candidate'
        ? content.matchCandidateId
        : content.occurrence.source === 'match_side'
          ? content.occurrence.matchCandidateId
          : content.occurrence.identityCandidateId;
  const actualCandidateId =
    content.subjectType === 'provider_match_candidate' ||
    (content.subjectType === 'provider_club_candidate' &&
      content.occurrence.source === 'match_side')
      ? row?.match_candidate_id
      : row?.identity_candidate_id;
  if (
    !row ||
    row.finalized_at === null ||
    row.staging_sha256 !== content.staging.stagingSha256 ||
    row.field_map_sha256 !== content.staging.fieldMapSha256 ||
    !row.field_map_approval_current ||
    row.source_row_sha256 !== content.staging.sourceRowSha256 ||
    row.row_status !== content.staging.rowStatus ||
    row.environment !== content.staging.environment ||
    row.environment !== executionEnvironment ||
    row.provider !== content.staging.provider ||
    row.capability_id !== content.staging.capabilityId ||
    row.competition !== content.staging.competition ||
    row.season_year !== content.staging.seasonYear ||
    actualCandidateId !== expectedCandidateId ||
    candidateJson === null ||
    sha256AflTradeCanonicalJson(candidateJson) !== content.staging.candidateSha256
  ) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'The proposal does not match one exact candidate in a finalized normalization run.'
    );
  }
  requireExactCandidateContent(content, candidateJson);
  const expectedFinalization = createAflTradeContentAddress('provider-normalization-finalization', {
    normalizationRunId: content.staging.normalizationRunId,
    stagingSha256: row.staging_sha256,
    finalizedAt: new Date(row.finalized_at).toISOString(),
  });
  if (content.staging.normalizationFinalization.id !== expectedFinalization) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'Normalization finalization evidence does not match the finalized run.'
    );
  }
  return row;
}

function requireExactCandidateContent(
  content: AflTradeProviderResolutionProposalContent,
  candidateJson: unknown
) {
  if (typeof candidateJson !== 'object' || candidateJson === null || Array.isArray(candidateJson)) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'The staged candidate payload is not an object.'
    );
  }
  const candidate = candidateJson as Record<string, unknown>;
  let actual: unknown;
  if (content.subjectType === 'provider_player_candidate') {
    actual = {
      nativePlayerId: candidate.nativeEntityId ?? null,
      recordedName: candidate.recordedName,
      recordedClubId: candidate.recordedClubId ?? null,
      recordedClubName: candidate.recordedClubName ?? null,
    };
  } else if (content.subjectType === 'provider_match_candidate') {
    actual = {
      nativeMatchId: candidate.nativeMatchId ?? null,
      roundLabel: candidate.roundLabel,
      matchDateText: candidate.matchDateText ?? null,
      homeClubNativeId: candidate.homeClubNativeId ?? null,
      homeClubName: candidate.homeClubName,
      awayClubNativeId: candidate.awayClubNativeId ?? null,
      awayClubName: candidate.awayClubName,
      orderIndependentSha256: candidate.orderIndependentSha256,
    };
  } else if (content.occurrence.source === 'match_side') {
    const prefix = content.occurrence.side === 'home' ? 'home' : 'away';
    actual = {
      nativeClubId: candidate[`${prefix}ClubNativeId`] ?? null,
      recordedName: candidate[`${prefix}ClubName`],
    };
  } else {
    actual = {
      nativeClubId: candidate.recordedClubId ?? null,
      recordedName: candidate.recordedClubName,
    };
  }
  if (canonicalizeAflTradeJson(actual) !== canonicalizeAflTradeJson(content.candidate)) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'The proposal candidate fields do not equal the immutable staged candidate.'
    );
  }
}

async function loadIssues(
  transaction: AflOutcomeSqlTransaction,
  normalizationRunId: string,
  row: StagingRow
): Promise<readonly IssueRow[]> {
  const result = await transaction.query<IssueRow>(
    `SELECT issue_id, issue_code, source_field, details_json
       FROM outcome_provider_normalization_issue
      WHERE normalization_run_id = $1 AND source_row_number = $2
      ORDER BY issue_id`,
    [normalizationRunId, row.source_row_number]
  );
  return result.rows;
}

function requireIssueEvidence(
  content: AflTradeProviderResolutionProposalContent,
  issues: readonly IssueRow[]
) {
  const issueSetId = createAflTradeContentAddress('provider-resolution-issue-set', {
    normalizationRunId: content.staging.normalizationRunId,
    providerDecodedRowId: content.staging.providerDecodedRowId,
    issues,
  });
  if (
    content.staging.issueSet.id !== issueSetId ||
    content.staging.blockingIssueCount !== issues.length
  ) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'The proposal issue set does not equal the immutable normalization issues.'
    );
  }
}

async function requireCurrentClosures(
  transaction: AflOutcomeSqlTransaction,
  content: AflTradeProviderResolutionProposalContent,
  issues: readonly IssueRow[]
) {
  const issueIds = new Set(issues.map(({ issue_id }) => issue_id));
  if (
    content.staging.blockingIssueClosures.some(({ issueId }) => !issueIds.has(issueId)) ||
    content.staging.blockingIssueClosures.length !==
      issues.length - content.staging.openBlockingIssueCount
  ) {
    throw new AflTradeProviderResolutionPersistenceError(
      'STAGING_MISMATCH',
      'Blocking-issue closures must identify the exact immutable issue set.'
    );
  }
  for (const closure of content.staging.blockingIssueClosures) {
    const result = await transaction.query<{ decision_id: string }>(
      `SELECT decision.decision_id
         FROM outcome_review_decision decision
        WHERE decision.decision_id = $1
          AND decision.subject_type = 'provider_normalization_issue'
          AND decision.subject_id = $2
          AND decision.decision = 'approved'
          AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = decision.decision_id)`,
      [closure.decision.id, closure.issueId]
    );
    if (!result.rows[0]) {
      throw new AflTradeProviderResolutionPersistenceError(
        'STAGING_MISMATCH',
        'A blocking-issue closure is missing, withdrawn, or not approved.'
      );
    }
  }
}

async function requireCurrentNamespace(
  transaction: AflOutcomeSqlTransaction,
  content: AflTradeProviderResolutionProposalContent
) {
  const namespace = content.staging.nativeIdNamespace;
  if (namespace === null) return;
  const result = await transaction.query<{ definition_json: unknown }>(
    `SELECT namespace.definition_json
       FROM outcome_provider_native_id_namespace namespace
      WHERE namespace.namespace_id = $1 AND namespace.status = 'approved'
        AND namespace.provider = $2 AND namespace.capability_id = $3 AND namespace.entity_kind = $4
        AND $5 BETWEEN namespace.valid_from_season AND namespace.valid_through_season
        AND (namespace.identity_scope = 'global' OR namespace.competition = $6)
        AND namespace.definition_sha256 = $7
        AND namespace.approval_decision_id = $8 AND namespace.approval_decision_sha256 = $9
        AND namespace.environment = $10
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = namespace.approval_decision_id)`,
    [
      namespace.namespaceId,
      namespace.provider,
      namespace.capabilityId,
      namespace.entityKind,
      content.staging.seasonYear,
      content.staging.competition,
      namespace.definitionSha256,
      namespace.approvalDecision.id,
      namespace.approvalDecision.sha256,
      namespace.environment,
    ]
  );
  if (!result.rows[0]) {
    throw new AflTradeProviderResolutionPersistenceError(
      'NAMESPACE_NOT_CURRENT',
      'The native-ID namespace is missing, withdrawn, or outside its approved scope.'
    );
  }
}

async function requireCanonicalTarget(
  transaction: AflOutcomeSqlTransaction,
  content: AflTradeProviderResolutionProposalContent
) {
  const target = content.proposedTarget;
  if (target === null) return;
  if ('playerId' in target) {
    const found = await transaction.query(
      `SELECT 1 FROM outcome_player WHERE player_id = $1 AND status = 'approved'`,
      [target.playerId]
    );
    if (found.rows[0]) return;
  } else if ('clubId' in target) {
    const found = await transaction.query(
      `SELECT 1 FROM outcome_club WHERE club_id = $1 AND status = 'approved'`,
      [target.clubId]
    );
    if (found.rows[0]) return;
  } else {
    if (content.subjectType !== 'provider_match_candidate') {
      throw new AflTradeProviderResolutionPersistenceError(
        'TARGET_MISMATCH',
        'Canonical target kind does not match the resolution subject.'
      );
    }
    const found = await transaction.query(
      `SELECT 1
         FROM outcome_match match
        WHERE match.match_id = $1 AND match.competition = $2 AND match.season_year = $3
          AND match.round_label = $4 AND match.match_date = $5::timestamptz
          AND match.home_club_id = $6 AND match.away_club_id = $7`,
      [
        target.matchId,
        content.staging.competition,
        content.staging.seasonYear,
        target.canonicalRoundLabel,
        target.canonicalMatchDate,
        target.homeClubId,
        target.awayClubId,
      ]
    );
    if (found.rows[0]) {
      await requireCurrentMatchClubResolution(
        transaction,
        content.matchCandidateId,
        'home',
        target.homeClubId,
        target.homeClubResolutionDecisionId
      );
      await requireCurrentMatchClubResolution(
        transaction,
        content.matchCandidateId,
        'away',
        target.awayClubId,
        target.awayClubResolutionDecisionId
      );
      return;
    }
  }
  throw new AflTradeProviderResolutionPersistenceError(
    'TARGET_MISMATCH',
    'The proposal target is not an approved, exact canonical public AFL record.'
  );
}

async function requireCurrentMatchClubResolution(
  transaction: AflOutcomeSqlTransaction,
  matchCandidateId: string,
  side: 'home' | 'away',
  clubId: string,
  decisionId: string
) {
  const found = await transaction.query(
    `SELECT 1
       FROM outcome_provider_club_resolution resolution
       JOIN outcome_provider_club_resolution_head head
         ON head.resolution_id = resolution.resolution_id
       JOIN outcome_provider_identity_assignment_head assignment
         ON assignment.assignment_case_id = resolution.assignment_case_id
        AND assignment.decision_id = resolution.decision_id
        AND assignment.status = 'active'
      WHERE resolution.decision_id = $1 AND resolution.outcome = 'approved'
        AND resolution.match_candidate_id = $2 AND resolution.side = $3
        AND resolution.club_id = $4 AND resolution.assignment_status = 'active'`,
    [decisionId, matchCandidateId, side, clubId]
  );
  if (!found.rows[0]) {
    throw new AflTradeProviderResolutionPersistenceError(
      'TARGET_MISMATCH',
      `The canonical ${side} club is not backed by its exact current approved resolution.`
    );
  }
}

async function insertProposal(
  transaction: AflOutcomeSqlTransaction,
  proposal: AflTradeProviderResolutionDecision['content']['proposal']
) {
  const content = proposal.content;
  const identityCandidateId =
    content.subjectType === 'provider_player_candidate'
      ? content.identityCandidateId
      : content.subjectType === 'provider_club_candidate' &&
          content.occurrence.source === 'player_affiliation'
        ? content.occurrence.identityCandidateId
        : null;
  const matchCandidateId =
    content.subjectType === 'provider_match_candidate'
      ? content.matchCandidateId
      : content.subjectType === 'provider_club_candidate' &&
          content.occurrence.source === 'match_side'
        ? content.occurrence.matchCandidateId
        : null;
  await transaction.query(
    `INSERT INTO outcome_provider_resolution_proposal
      (proposal_id,resolution_case_id,subject_type,normalization_run_id,provider_decoded_row_id,
       identity_candidate_id,match_candidate_id,club_side,native_id_namespace_id,proposal_sha256,
       method_id,method_sha256,canonical_target_snapshot_id,canonical_target_snapshot_sha256,
       normalization_finalization_id,normalization_finalization_sha256,row_status,issue_set_id,
       issue_set_sha256,blocking_issue_count,open_blocking_issue_count,proposed_at,proposal_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (proposal_id) DO NOTHING`,
    [
      proposal.proposalId,
      content.resolutionCaseId,
      content.subjectType,
      content.staging.normalizationRunId,
      content.staging.providerDecodedRowId,
      identityCandidateId,
      matchCandidateId,
      content.subjectType === 'provider_club_candidate' &&
      content.occurrence.source === 'match_side'
        ? content.occurrence.side
        : null,
      content.staging.nativeIdNamespace?.namespaceId ?? null,
      proposal.proposalSha256,
      content.method.id,
      content.method.sha256,
      content.canonicalTargetSnapshot.id,
      content.canonicalTargetSnapshot.sha256,
      content.staging.normalizationFinalization.id,
      content.staging.normalizationFinalization.sha256,
      content.staging.rowStatus,
      content.staging.issueSet.id,
      content.staging.issueSet.sha256,
      content.staging.blockingIssueCount,
      content.staging.openBlockingIssueCount,
      content.proposedAt,
      canonicalizeAflTradeJson(content),
    ]
  );
  const stored = await transaction.query<{
    proposal_sha256: string;
    resolution_case_id: string;
    proposal_json: unknown;
  }>(
    `SELECT proposal_sha256, resolution_case_id, proposal_json
       FROM outcome_provider_resolution_proposal WHERE proposal_id = $1`,
    [proposal.proposalId]
  );
  if (
    stored.rows[0]?.proposal_sha256 !== proposal.proposalSha256 ||
    stored.rows[0]?.resolution_case_id !== content.resolutionCaseId ||
    canonicalizeAflTradeJson(stored.rows[0]?.proposal_json) !== canonicalizeAflTradeJson(content)
  ) {
    throw new AflTradeProviderResolutionPersistenceError(
      'DECISION_CONFLICT',
      'The proposal ID already exists with different immutable content.'
    );
  }
}

async function insertReviewDecision(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision
) {
  const content = decision.content;
  const target = content.proposal.content.proposedTarget;
  await transaction.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,
       supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_resolution_case',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      decision.decisionId,
      content.proposal.content.resolutionCaseId,
      content.outcome,
      target === null ? null : content.proposal.content.subjectType,
      target === null
        ? null
        : 'playerId' in target
          ? target.playerId
          : 'clubId' in target
            ? target.clubId
            : target.matchId,
      content.supersedesDecisionId,
      content.rationale,
      canonicalizeAflTradeJson(decision),
      content.reviewerAuthority.principalRef,
      content.decidedAt,
    ]
  );
}

async function insertTypedResolution(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision,
  revision: number
) {
  const content = decision.content;
  const proposal = content.proposal.content;
  const assignment = content.assignmentRevision;
  const shared = [
    decision.decisionId,
    proposal.resolutionCaseId,
    revision,
    content.outcome,
    assignment?.assignmentCaseId ?? null,
    assignment?.entityKind ?? null,
    assignment?.identityId ?? null,
    assignment ? assignment.expectedRevision + 1 : null,
    assignment?.supersedesDecisionId ?? null,
    assignment?.nextStatus ?? null,
    content.supersedesDecisionId,
    content.proposal.proposalId,
    decision.decisionSha256,
    content.decidedAt,
    content.effectiveAt,
    canonicalizeAflTradeJson(decision),
  ] as const;
  if (proposal.subjectType === 'provider_player_candidate') {
    const target = proposal.proposedTarget;
    await transaction.query(
      `INSERT INTO outcome_provider_player_resolution
       (resolution_id,resolution_case_id,identity_candidate_id,revision,outcome,resolution_scope,
        assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,
        supersedes_assignment_decision_id,assignment_status,player_identity_id,player_id,
        supersedes_resolution_id,decision_id,proposal_id,resolution_sha256,decided_at,effective_at,decision_json)
       VALUES ($1,$2,$17,$3,$4,$18,$5,$6,$7,$8,$9,$10,$19,$20,$11,$1,$12,$13,$14,$15,$16)`,
      [
        ...shared,
        proposal.identityCandidateId,
        target?.scope ?? null,
        target?.scope === 'provider_identity' ? target.playerIdentityId : null,
        target?.playerId ?? null,
      ]
    );
    return;
  }
  if (proposal.subjectType === 'provider_club_candidate') {
    const target = proposal.proposedTarget;
    await transaction.query(
      `INSERT INTO outcome_provider_club_resolution
       (resolution_id,resolution_case_id,occurrence_source,match_candidate_id,identity_candidate_id,side,
        revision,outcome,resolution_scope,assignment_case_id,assignment_entity_kind,assignment_identity_id,
        assignment_revision,supersedes_assignment_decision_id,assignment_status,club_identity_id,club_id,
        valid_from_season,valid_through_season,supersedes_resolution_id,decision_id,proposal_id,resolution_sha256,
        decided_at,effective_at,decision_json)
       VALUES ($1,$2,$17,$18,$19,$20,$3,$4,$21,$5,$6,$7,$8,$9,$10,$22,$23,$24,$25,$11,$1,$12,$13,$14,$15,$16)`,
      [
        ...shared,
        proposal.occurrence.source,
        proposal.occurrence.source === 'match_side' ? proposal.occurrence.matchCandidateId : null,
        proposal.occurrence.source === 'player_affiliation'
          ? proposal.occurrence.identityCandidateId
          : null,
        proposal.occurrence.source === 'match_side' ? proposal.occurrence.side : null,
        target?.scope ?? null,
        target?.scope === 'provider_identity' ? target.clubIdentityId : null,
        target?.clubId ?? null,
        target?.scope === 'temporal_alias' ? target.validFromSeason : null,
        target?.scope === 'temporal_alias' ? target.validThroughSeason : null,
      ]
    );
    return;
  }
  const target = proposal.proposedTarget;
  await transaction.query(
    `INSERT INTO outcome_provider_match_resolution
     (resolution_id,resolution_case_id,match_candidate_id,revision,outcome,assignment_case_id,
      assignment_entity_kind,assignment_identity_id,assignment_revision,supersedes_assignment_decision_id,
      assignment_status,match_identity_id,match_id,supersedes_resolution_id,decision_id,proposal_id,
      resolution_sha256,decided_at,effective_at,decision_json)
     VALUES ($1,$2,$17,$3,$4,$5,$6,$7,$8,$9,$10,$18,$19,$11,$1,$12,$13,$14,$15,$16)`,
    [...shared, proposal.matchCandidateId, target?.matchIdentityId ?? null, target?.matchId ?? null]
  );
}

async function insertApprovedIdentityRoot(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision
) {
  if (decision.content.outcome !== 'approved') return;
  const proposal = decision.content.proposal.content;
  if (proposal.subjectType === 'provider_player_candidate') {
    const target = proposal.proposedTarget;
    if (target?.scope !== 'provider_identity') return;
    await transaction.query(
      `INSERT INTO outcome_player_identity
       (identity_id,capture_id,provider,native_id_namespace_id,native_player_id,recorded_name,identity_sha256,first_observed_at)
       SELECT $1,run.capture_id,$2,$3,$4,$5,$6,$7 FROM outcome_provider_normalization_run run WHERE run.normalization_run_id=$8
       ON CONFLICT (identity_id) DO NOTHING`,
      [
        target.playerIdentityId,
        proposal.staging.provider,
        proposal.staging.nativeIdNamespace!.namespaceId,
        proposal.candidate.nativePlayerId,
        proposal.candidate.recordedName,
        target.playerIdentityId.slice(target.playerIdentityId.indexOf(':') + 1),
        decision.content.decidedAt,
        proposal.staging.normalizationRunId,
      ]
    );
    await requireExactIdentityRoot(
      transaction,
      'outcome_player_identity',
      target.playerIdentityId,
      {
        provider: proposal.staging.provider,
        native_id_namespace_id: proposal.staging.nativeIdNamespace!.namespaceId,
        native_player_id: proposal.candidate.nativePlayerId,
      }
    );
  } else if (proposal.subjectType === 'provider_club_candidate') {
    const target = proposal.proposedTarget;
    if (target === null) return;
    if (target.scope === 'provider_identity') {
      await transaction.query(
        `INSERT INTO outcome_club_identity
         (identity_id,provider,native_id_namespace_id,native_club_id,identity_sha256,first_observed_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (identity_id) DO NOTHING`,
        [
          target.clubIdentityId,
          proposal.staging.provider,
          proposal.staging.nativeIdNamespace!.namespaceId,
          proposal.candidate.nativeClubId,
          target.clubIdentityId.slice(target.clubIdentityId.indexOf(':') + 1),
          decision.content.decidedAt,
        ]
      );
      await requireExactIdentityRoot(transaction, 'outcome_club_identity', target.clubIdentityId, {
        provider: proposal.staging.provider,
        native_id_namespace_id: proposal.staging.nativeIdNamespace!.namespaceId,
        native_club_id: proposal.candidate.nativeClubId,
      });
    } else {
      await transaction.query(
        `INSERT INTO outcome_provider_club_alias
         (alias_id,provider,competition,normalized_name,normalization_policy_id,normalization_policy_sha256,
          valid_from_season,valid_through_season,alias_sha256,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (alias_id) DO NOTHING`,
        [
          target.aliasId,
          proposal.staging.provider,
          proposal.staging.competition,
          target.normalizedName,
          target.normalizationPolicy.id,
          target.normalizationPolicy.sha256,
          target.validFromSeason,
          target.validThroughSeason,
          target.aliasId.slice(target.aliasId.indexOf(':') + 1),
          decision.content.decidedAt,
        ]
      );
      await requireExactIdentityRoot(transaction, 'outcome_provider_club_alias', target.aliasId, {
        provider: proposal.staging.provider,
        competition: proposal.staging.competition,
        normalized_name: target.normalizedName,
        normalization_policy_id: target.normalizationPolicy.id,
        normalization_policy_sha256: target.normalizationPolicy.sha256,
        valid_from_season: target.validFromSeason,
        valid_through_season: target.validThroughSeason,
      });
      return;
    }
  } else if (proposal.subjectType === 'provider_match_candidate') {
    const target = proposal.proposedTarget;
    if (target === null) return;
    await transaction.query(
      `INSERT INTO outcome_match_identity
       (identity_id,provider,native_id_namespace_id,identity_kind,native_match_id,fixture_fingerprint_sha256,
        competition,season_year,identity_sha256,first_match_candidate_id,first_observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (identity_id) DO NOTHING`,
      [
        target.matchIdentityId,
        proposal.staging.provider,
        target.matchIdentityKind === 'provider_native'
          ? proposal.staging.nativeIdNamespace!.namespaceId
          : null,
        target.matchIdentityKind,
        target.matchIdentityKind === 'provider_native' ? proposal.candidate.nativeMatchId : null,
        target.matchIdentityKind === 'reviewed_fixture_fingerprint'
          ? target.fixtureFingerprintSha256
          : null,
        proposal.staging.competition,
        proposal.staging.seasonYear,
        target.matchIdentityId.slice(target.matchIdentityId.indexOf(':') + 1),
        proposal.matchCandidateId,
        decision.content.decidedAt,
      ]
    );
    await requireExactIdentityRoot(transaction, 'outcome_match_identity', target.matchIdentityId, {
      provider: proposal.staging.provider,
      native_id_namespace_id:
        target.matchIdentityKind === 'provider_native'
          ? proposal.staging.nativeIdNamespace!.namespaceId
          : null,
      identity_kind: target.matchIdentityKind,
      native_match_id:
        target.matchIdentityKind === 'provider_native' ? proposal.candidate.nativeMatchId : null,
      fixture_fingerprint_sha256:
        target.matchIdentityKind === 'reviewed_fixture_fingerprint'
          ? target.fixtureFingerprintSha256
          : null,
      competition: proposal.staging.competition,
      season_year: proposal.staging.seasonYear,
    });
  }
}

async function requireExactIdentityRoot(
  transaction: AflOutcomeSqlTransaction,
  table:
    | 'outcome_player_identity'
    | 'outcome_club_identity'
    | 'outcome_match_identity'
    | 'outcome_provider_club_alias',
  identityId: string,
  expected: Readonly<Record<string, string | number | null>>
) {
  const idColumn = table === 'outcome_provider_club_alias' ? 'alias_id' : 'identity_id';
  const columns = Object.keys(expected);
  const stored = await transaction.query<Record<string, unknown>>(
    `SELECT ${columns.join(',')} FROM ${table} WHERE ${idColumn} = $1`,
    [identityId]
  );
  if (!stored.rows[0] || columns.some((column) => stored.rows[0]?.[column] !== expected[column])) {
    throw new AflTradeProviderResolutionPersistenceError(
      'DECISION_CONFLICT',
      'A reusable provider identity already exists with different immutable content.'
    );
  }
}

async function insertApprovedIdentityOccurrence(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeProviderResolutionDecision
) {
  if (decision.content.outcome !== 'approved') return;
  const proposal = decision.content.proposal.content;
  if (proposal.subjectType === 'provider_player_candidate') {
    const target = proposal.proposedTarget;
    if (target?.scope !== 'provider_identity') return;
    await transaction.query(
      `INSERT INTO outcome_provider_player_identity_occurrence
       (occurrence_id,identity_candidate_id,player_identity_id,decision_id,occurrence_sha256,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      occurrenceValues('player', proposal.identityCandidateId, target.playerIdentityId, decision)
    );
    return;
  }
  if (proposal.subjectType === 'provider_club_candidate') {
    const target = proposal.proposedTarget;
    if (target?.scope !== 'provider_identity') return;
    const occurrence = proposal.occurrence;
    const occurrenceId = createAflTradeContentAddress('provider-club-identity-occurrence', {
      occurrence,
      clubIdentityId: target.clubIdentityId,
      decisionId: decision.decisionId,
    });
    await transaction.query(
      `INSERT INTO outcome_provider_club_identity_occurrence
       (occurrence_id,occurrence_source,match_candidate_id,identity_candidate_id,side,club_identity_id,
        decision_id,occurrence_sha256,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        occurrenceId,
        occurrence.source,
        occurrence.source === 'match_side' ? occurrence.matchCandidateId : null,
        occurrence.source === 'player_affiliation' ? occurrence.identityCandidateId : null,
        occurrence.source === 'match_side' ? occurrence.side : null,
        target.clubIdentityId,
        decision.decisionId,
        occurrenceId.slice(occurrenceId.indexOf(':') + 1),
        decision.content.decidedAt,
      ]
    );
    return;
  }
  const target = proposal.proposedTarget;
  if (target === null) return;
  await transaction.query(
    `INSERT INTO outcome_provider_match_identity_occurrence
     (occurrence_id,match_candidate_id,match_identity_id,decision_id,occurrence_sha256,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    occurrenceValues('match', proposal.matchCandidateId, target.matchIdentityId, decision)
  );
}

function occurrenceValues(
  kind: 'player' | 'match',
  candidateId: string,
  identityId: string,
  decision: AflTradeProviderResolutionDecision
) {
  const occurrenceId = createAflTradeContentAddress(`provider-${kind}-identity-occurrence`, {
    candidateId,
    identityId,
    decisionId: decision.decisionId,
  });
  return [
    occurrenceId,
    candidateId,
    identityId,
    decision.decisionId,
    occurrenceId.slice(occurrenceId.indexOf(':') + 1),
    decision.content.decidedAt,
  ];
}

function result(
  decision: AflTradeProviderResolutionDecision,
  revision: number,
  idempotentReplay: boolean
): PersistedAflTradeProviderResolution {
  return {
    decisionId: decision.decisionId,
    proposalId: decision.content.proposal.proposalId,
    resolutionCaseId: decision.content.proposal.content.resolutionCaseId,
    revision,
    outcome: decision.content.outcome,
    idempotentReplay,
  };
}
