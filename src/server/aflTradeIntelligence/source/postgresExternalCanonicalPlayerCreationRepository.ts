import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  recordAflTradeRepositoryLocations,
  requireAflTradeEvidenceLocated,
} from '../artifacts/artifactStoreLocation';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeExternalIdentityReviewWorkItem } from './externalIdentityReviewContracts';
import { PostgresAflTradeProviderResolutionRepository } from './postgresProviderResolutionRepository';
import {
  aflTradeExternalCanonicalTargetRegistrationSchema,
  aflTradeExternalCanonicalTargetSnapshotSchema,
} from './providerResolutionContracts';

const GOVERNANCE_WRITER_ROLE = 'afl_trade_nonproduction_governance_registry_writer';
const GOVERNANCE_ROLE_CONSTRAINT = 'outcome_governed_evidence_requires_registry_role';
export const MAXIMUM_SNAPSHOT_BYTES = 2_097_152;

export interface AflTradeExternalCanonicalPlayerCreation {
  completionId: string;
  /** The exact native-identity work item of the current completion the player is created from. */
  workItem: AflTradeExternalIdentityReviewWorkItem;
  canonicalId: string;
  displayName: string;
  reviewerAuthority: { principalRef: string; authorityEvidence: { id: string; sha256: string } };
  /** Located capture_metadata artifacts, such as the stored owner approval, in artifact-id order. */
  supportingEvidence: readonly AflTradeArtifactRef[];
  rationale: string;
  distinctFromPlayerIds?: readonly string[];
}

export interface CreatedAflTradeExternalCanonicalPlayer {
  registrationDecisionId: string;
  targetSnapshotReferenceId: string;
  canonicalId: string;
  idempotentReplay: boolean;
}

/** A transaction as the client the canonical-target owner expects, so its work joins this one. */
function joinTransaction(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

/**
 * Creates one canonical player from an external native identity through a reviewed v2 `create`
 * registration (runbook "Registering a season's national draftees"). The snapshot bytes are written
 * to the store and read back first; then one transaction records their custody and location, the
 * approved governed snapshot evidence (checked under the non-production governance-registry role,
 * migration 0004), the approved `canonical_target_creation` review, and the player through
 * `registerCanonicalTarget`. A refusal anywhere, including the same-name check (migration 0276),
 * leaves no row behind. Birth date stays unknown.
 */
export class PostgresAflTradeExternalCanonicalPlayerCreationRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly snapshots: AflTradeImmutableArtifactRepository
  ) {}

  async createPlayer(
    input: AflTradeExternalCanonicalPlayerCreation
  ): Promise<CreatedAflTradeExternalCanonicalPlayer> {
    const environment = input.workItem.content.subject.content.environment;
    if (environment !== 'non_production' || this.snapshots.artifactClass !== 'capture_metadata') {
      throw new TypeError(
        'Draftee creation writes non-production capture_metadata snapshot evidence only.'
      );
    }
    const at = await databaseNow(this.client);
    const snapshot = aflTradeExternalCanonicalTargetSnapshotSchema.parse({
      evidenceKind: 'canonical_target_snapshot',
      schemaVersion: 'afl-trade-canonical-target-snapshot/v2',
      environment,
      source: { historicalCompletionId: input.completionId, workItem: input.workItem },
      record: {
        entityKind: 'player',
        canonicalId: input.canonicalId,
        displayName: input.displayName,
        birthDate: null,
      },
    });
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(snapshot));
    // A retry finds the bytes an earlier refused run stored, under that run's creation time.
    const { reference } = await this.snapshots.putIfAbsent(
      createAflTradeCanonicalJsonArtifactRef(snapshot, at),
      bytes
    );
    const readback = await verifyAflTradeArtifactReadback(
      this.snapshots,
      reference,
      at,
      MAXIMUM_SNAPSHOT_BYTES
    );
    const snapshotReferenceId = createAflTradeContentAddress('canonical-target-snapshot', snapshot);
    const content = {
      schemaVersion: 'afl-trade-canonical-target-registration/v2' as const,
      authorityBoundary: 'reviewed_canonical_creation_no_provider_assignment' as const,
      action: 'create' as const,
      targetSnapshot: snapshot,
      targetSnapshotReferenceId: snapshotReferenceId,
      reviewerAuthority: input.reviewerAuthority,
      supportingEvidence: input.supportingEvidence,
      rationale: input.rationale,
      decidedAt: at,
      ...(input.distinctFromPlayerIds === undefined
        ? {}
        : { distinctFromPlayerIds: input.distinctFromPlayerIds }),
    };
    const registration = aflTradeExternalCanonicalTargetRegistrationSchema.parse({
      registrationDecisionId: createAflTradeContentAddress(
        'canonical-target-registration',
        content
      ),
      content,
    });
    const principal = input.reviewerAuthority.principalRef;
    return this.client.transaction(async (transaction) => {
      // The canonical-target owner's lock order, taken before anything is written.
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-identity:${input.workItem.content.subject.subjectId}`,
      ]);
      await transaction.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(value,0))
           FROM (SELECT DISTINCT unnest($1::text[]) AS value ORDER BY value) locks`,
        [
          [
            `outcome-canonical-target:player:${input.canonicalId}`,
            `outcome-review-subject:canonical_target_creation:${snapshotReferenceId}`,
            `outcome-review-subject:governed_evidence_reference:${snapshotReferenceId}`,
            `outcome-review-subject:governed_evidence_reference:${input.reviewerAuthority.authorityEvidence.id}`,
          ],
        ]
      );
      await requireAflTradeEvidenceLocated(
        transaction,
        input.supportingEvidence.map(({ artifactId }) => artifactId)
      );
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'capture_metadata','non_production',$6,$7,$8::jsonb)`,
        [
          reference.artifactId,
          reference.contentSha256,
          reference.storageUri,
          reference.mediaType,
          reference.byteLength,
          reference.createdAt,
          readback.content.verifiedAt,
          canonicalizeAflTradeJson(readback),
        ]
      );
      await recordAflTradeRepositoryLocations(transaction, this.snapshots, [reference]);
      const approvalId = createAflTradeContentAddress('governed-evidence-approval-decision', {
        referenceId: snapshotReferenceId,
      });
      const digest = sha256AflTradeCanonicalJson(snapshot);
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'governed_evidence_reference',$2,'approved',$3,$4::jsonb,$5,$6)`,
        [
          approvalId,
          snapshotReferenceId,
          'Canonical target snapshot retained for a reviewed draftee creation.',
          canonicalizeAflTradeJson({ referenceSha256: digest }),
          principal,
          at,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_governed_evidence_reference
          (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
           approval_decision_id,created_at,evidence_canonical_json,evidence_json)
         VALUES ($1,$2,'canonical_target_snapshot',$3,'non_production','approved',$4,$5,$6::text,
                 ($6::text)::jsonb)`,
        [
          snapshotReferenceId,
          digest,
          reference.artifactId,
          approvalId,
          at,
          canonicalizeAflTradeJson(snapshot),
        ]
      );
      // Governed evidence is checked under the isolated registry role only; everything else runs
      // as the connecting operator.
      await transaction.query(`SET LOCAL ROLE ${GOVERNANCE_WRITER_ROLE}`);
      await transaction.query(`SET CONSTRAINTS ${GOVERNANCE_ROLE_CONSTRAINT} IMMEDIATE`);
      await transaction.query('RESET ROLE');
      await transaction.query(`SET CONSTRAINTS ${GOVERNANCE_ROLE_CONSTRAINT} DEFERRED`);
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,
           rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'canonical_target_creation',$2,'approved','player',$3,$4,$5::jsonb,$6,$7)`,
        [
          registration.registrationDecisionId,
          snapshotReferenceId,
          input.canonicalId,
          registration.content.rationale,
          canonicalizeAflTradeJson(registration),
          principal,
          at,
        ]
      );
      const registered = await new PostgresAflTradeProviderResolutionRepository(
        joinTransaction(transaction)
      ).registerCanonicalTarget(
        {
          registrationDecisionId: registration.registrationDecisionId,
          targetSnapshotReferenceId: snapshotReferenceId,
        },
        { principalRef: principal, environment }
      );
      return {
        registrationDecisionId: registration.registrationDecisionId,
        targetSnapshotReferenceId: snapshotReferenceId,
        canonicalId: registered.canonicalId,
        idempotentReplay: registered.idempotentReplay,
      };
    });
  }
}

/** The database clock in UTC milliseconds, so every compared instant comes from one clock. */
export async function databaseNow(client: AflOutcomeSqlClient): Promise<string> {
  const result = await client.query<{ at: string }>(
    `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
  );
  return result.rows[0]!.at;
}

/** A stored owner approval as supporting evidence, if it is located non-production metadata. */
export async function loadLocatedApprovalArtifact(
  client: AflOutcomeSqlClient,
  artifactId: string
): Promise<AflTradeArtifactRef | null> {
  const result = await client.query<{
    artifact_id: string;
    content_sha256: string;
    storage_uri: string;
    media_type: string;
    byte_length: string;
    created_at: string;
  }>(
    `SELECT c.artifact_id,c.content_sha256,c.storage_uri,c.media_type,c.byte_length::text AS byte_length,
            to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM outcome_artifact_custody c
      WHERE c.artifact_id=$1 AND c.artifact_class='capture_metadata' AND c.environment='non_production'
        AND c.verified_at<=clock_timestamp()
        AND EXISTS (SELECT 1 FROM outcome_artifact_custody_location l WHERE l.artifact_id=c.artifact_id)`,
    [artifactId]
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return aflTradeArtifactRefSchema.parse({
    artifactId: row.artifact_id,
    contentSha256: row.content_sha256,
    storageUri: row.storage_uri,
    mediaType: row.media_type,
    byteLength: Number(row.byte_length),
    createdAt: row.created_at,
  });
}

/** Current identity-reviewer grants of the principal covering the work item's provider and seasons. */
export async function loadCurrentIdentityReviewerGrants(
  client: AflOutcomeSqlClient,
  principalRef: string,
  workItem: AflTradeExternalIdentityReviewWorkItem
): Promise<{ id: string; sha256: string }[]> {
  const content = workItem.content;
  const result = await client.query<{ authority_evidence_id: string; reference_sha256: string }>(
    `SELECT authority.authority_evidence_id,evidence.reference_sha256
       FROM outcome_operational_principal_authority authority
       JOIN outcome_governed_evidence_reference evidence
         ON evidence.reference_id=authority.authority_evidence_id
       JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
      WHERE authority.principal_ref=$1 AND authority.role='afl_trade_external_identity_reviewer'
        AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider=$2
        AND authority.capability_id='external_identity_resolution' AND authority.competition=$3
        AND authority.valid_from_season<=$4 AND authority.valid_through_season>=$5
        AND authority.valid_from<=clock_timestamp()
        AND (authority.valid_through IS NULL OR authority.valid_through>clock_timestamp())
        AND evidence.environment='non_production' AND evidence.status='approved'
        AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=approval.decision_id)
      ORDER BY authority.authority_evidence_id`,
    [
      principalRef,
      content.subject.content.provider,
      content.subject.content.competition,
      content.validFromSeason,
      content.validThroughSeason,
    ]
  );
  return result.rows.map((row) => ({
    id: row.authority_evidence_id,
    sha256: row.reference_sha256,
  }));
}

/** Whether the player exists, and if so whether a current approved creation review registered it. */
export async function loadCanonicalPlayerRegistrationState(
  client: AflOutcomeSqlClient,
  playerId: string
): Promise<'absent' | 'registered' | 'unregistered_player'> {
  const result = await client.query<{ player: boolean; registered: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM outcome_player WHERE player_id=$1 AND status='approved') AS player,
            EXISTS (SELECT 1 FROM outcome_review_decision r
                     WHERE r.subject_type='canonical_target_creation' AND r.decision='approved'
                       AND r.canonical_record_type='player' AND r.canonical_record_id=$1
                       AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                                        WHERE successor.supersedes_decision_id=r.decision_id)) AS registered`,
    [playerId]
  );
  const row = result.rows[0];
  if (row?.player !== true) return 'absent';
  return row.registered === true ? 'registered' : 'unregistered_player';
}

/** Approved players other than this one with the same normalised name (migration 0276). */
export async function loadSameNameApprovedPlayerIds(
  client: AflOutcomeSqlClient,
  playerId: string,
  displayName: string
): Promise<string[]> {
  const result = await client.query<{ player_id: string }>(
    `SELECT player_id FROM outcome_player
      WHERE status='approved' AND player_id<>$1
        AND outcome_canonical_player_name_key(display_name)=outcome_canonical_player_name_key($2)
      ORDER BY player_id COLLATE "C"`,
    [playerId, displayName]
  );
  return result.rows.map(({ player_id }) => player_id);
}
