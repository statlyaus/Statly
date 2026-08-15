import { z } from 'zod';

import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  parseAflTradePromotionBackedCorpus,
  type AflTradePromotionBackedCorpus,
} from '../artifacts/promotionBackedCorpusContracts';
import { parseAflTradeExternalCaptureExecutionReceipt } from '../source/externalDraftTradeIngestion';
import {
  createAflTradePromotionBackedFactualRelease,
  parseAflTradePromotionBackedFactualCandidate,
  type AflTradePromotionBackedFactualCandidate,
} from './promotionBackedFactualReleaseContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

const exactUtcInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const buildRequestSchema = z
  .object({
    corpusId: z.string().regex(/^corpus:[a-f0-9]{64}$/),
    scopeKey: z.string().trim().min(1).max(1_000),
    createdAt: exactUtcInstantSchema,
  })
  .strict();

type BuildRequest = z.infer<typeof buildRequestSchema>;
type RecordKind = AflTradePromotionBackedCorpus['content']['members'][number]['recordKind'];

export interface PersistedAflTradePromotionBackedFactualRelease {
  readonly corpusId: string;
  readonly releaseId: string;
  readonly candidateId: string;
  readonly sourceMemberSetSha256: string;
  readonly canonicalMemberSetSha256: string;
  readonly canonicalMemberCount: number;
  readonly status: 'finalized';
  readonly idempotentReplay: boolean;
}

export class AflTradePromotionBackedFactualReleasePersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'CORPUS_UNAVAILABLE'
      | 'CORPUS_INCOMPLETE'
      | 'SOURCE_AUTHORITY_MISMATCH'
      | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePromotionBackedFactualReleasePersistenceError';
  }
}

interface CorpusRow extends Record<string, unknown> {
  status: string;
  corpus_json: unknown;
}

interface CaptureRow extends Record<string, unknown> {
  promotion_id: string;
  capture_id: string;
  source_snapshot_id: string;
  environment: string;
  competition: string;
  anchor_season_year: number | string;
  captured_at: Date | string;
  manifest_json: unknown;
}

interface CanonicalRow extends Record<string, unknown> {
  record_kind: RecordKind;
  canonical_record_id: string;
  canonical_record_json: unknown;
}

interface ReplayRow extends Record<string, unknown> {
  status: string;
  finalized_at: Date | string | null;
  candidate_json: unknown;
}

function exactInstant(value: Date | string): string {
  const instant = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    throw new TypeError('Expected an exact UTC millisecond instant.');
  }
  return instant;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function resultFromCandidate(
  candidate: AflTradePromotionBackedFactualCandidate,
  idempotentReplay: boolean
): PersistedAflTradePromotionBackedFactualRelease {
  return {
    corpusId: candidate.content.corpusId,
    releaseId: candidate.content.targetReleaseId,
    candidateId: candidate.candidateId,
    sourceMemberSetSha256: candidate.content.sourceMemberSetSha256,
    canonicalMemberSetSha256: candidate.content.canonicalMemberSetSha256,
    canonicalMemberCount: candidate.content.targetReleaseManifest.content.canonicalMemberCount,
    status: 'finalized',
    idempotentReplay,
  };
}

async function requireCurrentSourceAuthority(
  transaction: AflOutcomeSqlTransaction,
  corpus: AflTradePromotionBackedCorpus,
  receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>,
  createdAt: string
): Promise<{ rightsArtifactId: string; gateDecisionId: string }> {
  if (receipt.content.schemaVersion === 'statly-local-fixture-execution/v1') {
    if (
      corpus.content.environment !== 'test_fixture' ||
      receipt.content.environment !== corpus.content.environment ||
      receipt.content.provider !== 'statly_local_fixture' ||
      !receipt.content.fixtureOnly ||
      receipt.content.liveSourceAccessed ||
      receipt.content.providerRightsExpanded
    ) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        'Local fixture execution authority does not match the fixture-only corpus.'
      );
    }
    return {
      rightsArtifactId: receipt.content.rightsArtifactId,
      gateDecisionId: receipt.content.gateDecisionId,
    };
  }
  if (receipt.content.schemaVersion === 'afl-trade-external-capture-execution/v1') {
    if (corpus.content.environment !== 'test_fixture') {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        'Non-fixture factual releases require an authenticated execution receipt v2.'
      );
    }
    return {
      rightsArtifactId: receipt.content.rightsArtifactId,
      gateDecisionId: receipt.content.gateDecisionId,
    };
  }

  const decisionId = receipt.content.gate0aReceipt.content.result.decisionId;
  if (
    decisionId === null ||
    receipt.content.request.environment !== corpus.content.environment ||
    receipt.content.request.competition !== corpus.content.competition ||
    receipt.content.gate0aReceipt.content.result.status !== 'mechanically_eligible'
  ) {
    throw new AflTradePromotionBackedFactualReleasePersistenceError(
      'SOURCE_AUTHORITY_MISMATCH',
      'Capture execution scope does not match the canonical corpus.'
    );
  }
  const stored = await transaction.query<{ content_json: unknown }>(
    `SELECT rights.content_json
       FROM outcome_source_rights_proposal rights
       JOIN outcome_gate_decision decision ON decision.decision_id=$2
       JOIN outcome_gate_proposal proposal ON proposal.proposal_id=decision.proposal_id
      WHERE rights.rights_artifact_id=$1
        AND decision.gate='gate_0a_permission_to_evaluate'
        AND decision.environment=$3::"OutcomeEnvironment"
        AND decision.decision_key=$4 AND decision.state='approved'
        AND decision.effective_at <= $5::timestamptz
        AND decision.revalidate_at > $5::timestamptz
        AND proposal.proposal_json->'content'->'affectedArtifacts' @> $6::jsonb
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id
        )
      FOR SHARE OF rights,decision,proposal`,
    [
      receipt.content.sourceRights.rightsArtifactId,
      decisionId,
      corpus.content.environment,
      receipt.content.gate0aReceipt.content.request.decisionKey,
      createdAt,
      canonicalizeAflTradeJson([
        { kind: 'source_rights', artifactId: receipt.content.sourceRights.rightsArtifactId },
      ]),
    ]
  );
  if (
    stored.rows.length !== 1 ||
    !exactJson(stored.rows[0]?.content_json, receipt.content.sourceRights)
  ) {
    throw new AflTradePromotionBackedFactualReleasePersistenceError(
      'SOURCE_AUTHORITY_MISMATCH',
      'Capture source rights are not current in the durable Gate ledger.'
    );
  }
  return {
    rightsArtifactId: receipt.content.sourceRights.rightsArtifactId,
    gateDecisionId: decisionId,
  };
}

async function loadSourceAncestry(
  transaction: AflOutcomeSqlTransaction,
  corpus: AflTradePromotionBackedCorpus,
  createdAt: string
) {
  const result = await transaction.query<CaptureRow>(
    `SELECT corpus_promotion.promotion_id,promotion_run.capture_id,capture.source_snapshot_id,
            capture.environment,capture.competition,capture.anchor_season_year,capture.captured_at,
            capture.manifest_json
       FROM outcome_promotion_backed_corpus_promotion corpus_promotion
       JOIN outcome_external_canonical_promotion_import_run promotion_run
         ON promotion_run.promotion_id=corpus_promotion.promotion_id
       JOIN outcome_source_capture capture ON capture.capture_id=promotion_run.capture_id
      WHERE corpus_promotion.corpus_id=$1 AND capture.status='approved'
      ORDER BY corpus_promotion.promotion_id,promotion_run.capture_id
      FOR SHARE OF corpus_promotion,promotion_run,capture`,
    [corpus.corpusId]
  );
  const expectedPromotions = new Set(
    corpus.content.promotions.map(({ promotionId }) => promotionId)
  );
  const captureById = new Map<string, CaptureRow>();
  const captureIdsByPromotion = new Map<string, Set<string>>();
  for (const row of result.rows) {
    if (
      !expectedPromotions.has(row.promotion_id) ||
      row.environment !== corpus.content.environment ||
      row.competition !== corpus.content.competition ||
      Date.parse(exactInstant(row.captured_at)) > Date.parse(corpus.content.knowledgeCutoffAt)
    ) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        'A promotion capture falls outside the corpus scope or knowledge cutoff.'
      );
    }
    const existing = captureById.get(row.capture_id);
    if (existing && !exactJson(existing, row)) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        'One capture identity has conflicting immutable ancestry.'
      );
    }
    captureById.set(row.capture_id, row);
    const ids = captureIdsByPromotion.get(row.promotion_id) ?? new Set<string>();
    ids.add(row.capture_id);
    captureIdsByPromotion.set(row.promotion_id, ids);
  }
  if (
    result.rows.length === 0 ||
    [...expectedPromotions].some((promotionId) => !captureIdsByPromotion.has(promotionId))
  ) {
    throw new AflTradePromotionBackedFactualReleasePersistenceError(
      'CORPUS_INCOMPLETE',
      'Every corpus promotion requires at least one exact source capture.'
    );
  }

  const sourceCaptures = [];
  const sourceSnapshots: { captureId: string; recordCanonicalJson: string }[] = [];
  for (const row of [...captureById.values()].sort((left, right) =>
    left.capture_id.localeCompare(right.capture_id)
  )) {
    const manifest = z
      .object({ executionReceipt: z.unknown() })
      .passthrough()
      .safeParse(row.manifest_json);
    if (!manifest.success) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        `Source capture ${row.capture_id} has no authenticated execution receipt.`
      );
    }
    let receipt: ReturnType<typeof parseAflTradeExternalCaptureExecutionReceipt>;
    try {
      receipt = parseAflTradeExternalCaptureExecutionReceipt(manifest.data.executionReceipt);
    } catch (error) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'SOURCE_AUTHORITY_MISMATCH',
        error instanceof Error ? error.message : 'Source execution receipt is invalid.'
      );
    }
    const authority = await requireCurrentSourceAuthority(transaction, corpus, receipt, createdAt);
    sourceCaptures.push({
      captureId: row.capture_id,
      sourceSnapshotId: row.source_snapshot_id,
      ...authority,
      recordSha256: sha256AflTradeCanonicalJson(row.manifest_json),
      recordedAt: exactInstant(row.captured_at),
    });
    sourceSnapshots.push({
      captureId: row.capture_id,
      recordCanonicalJson: canonicalizeAflTradeJson(row.manifest_json),
    });
  }
  const promotionSources = [...expectedPromotions].sort().map((promotionId) => ({
    promotionId,
    captureIds: [...(captureIdsByPromotion.get(promotionId) ?? [])].sort(),
  }));
  return { sourceCaptures, promotionSources, sourceSnapshots };
}

async function loadCanonicalMembers(
  transaction: AflOutcomeSqlTransaction,
  corpus: AflTradePromotionBackedCorpus
) {
  const requested = [
    ...new Map(
      corpus.content.members.map(({ recordKind, canonicalRecordId }) => [
        `${recordKind}\0${canonicalRecordId}`,
        { recordKind, canonicalRecordId },
      ])
    ).values(),
  ].sort((left, right) =>
    `${left.recordKind}\0${left.canonicalRecordId}`.localeCompare(
      `${right.recordKind}\0${right.canonicalRecordId}`
    )
  );
  const result = await transaction.query<CanonicalRow>(
    `WITH requested_member AS (
       SELECT member->>'recordKind' AS record_kind,member->>'canonicalRecordId' AS canonical_record_id
         FROM jsonb_array_elements($1::jsonb) member
     ), canonical_member AS (
       SELECT requested.record_kind,version.event_version_id AS canonical_record_id,
              jsonb_build_object(
                'eventVersionId',version.event_version_id,'eventId',version.event_id,
                'competition',event.competition,'seasonYear',event.season_year,
                'stableKey',event.stable_key,'version',version.version,'kind',version.kind,
                'acquisitionMechanism',version.acquisition_mechanism,'eventDate',version.event_date,
                'officialName',version.official_name,'status',version.status,
                'sourceImportRowId',version.source_import_row_id,
                'supersedesVersionId',version.supersedes_version_id,'recordedAt',version.recorded_at,
                'parties',COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'clubId',party.club_id,'sourceImportRowId',party.source_import_row_id,
                  'role',party.role,'ordinal',party.ordinal) ORDER BY party.ordinal)
                  FROM outcome_event_party party WHERE party.event_version_id=version.event_version_id),'[]'::jsonb)
              ) AS canonical_record_json
         FROM requested_member requested
         JOIN outcome_event_version version ON version.event_version_id=requested.canonical_record_id
         JOIN outcome_event event ON event.event_id=version.event_id
        WHERE (requested.record_kind='transaction' AND version.kind='trade')
           OR (requested.record_kind='draft_event' AND version.kind<>'trade')
       UNION ALL
       SELECT requested.record_kind,asset.asset_version_id,
              jsonb_build_object(
                'assetVersionId',asset.asset_version_id,'eventVersionId',asset.event_version_id,
                'assetKey',asset.asset_key,'kind',asset.kind,'playerId',asset.player_id,
                'playerIdentityId',asset.player_identity_id,
                'externalIdentityDecisionId',asset.external_identity_decision_id,
                'pickId',asset.pick_id,'fromClubId',asset.from_club_id,'toClubId',asset.to_club_id,
                'sourceImportRowId',asset.source_import_row_id,
                'rawDescription',asset.raw_description,'status',asset.status)
         FROM requested_member requested
         JOIN outcome_event_asset asset ON asset.asset_version_id=requested.canonical_record_id
        WHERE requested.record_kind IN ('transfer','draft_player_asset')
       UNION ALL
       SELECT requested.record_kind,selection.selection_id,
              jsonb_build_object(
                'selectionId',selection.selection_id,'eventVersionId',selection.event_version_id,
                'selectionNumber',selection.selection_number,'pickId',selection.pick_id,
                'playerId',selection.player_id,'playerIdentityId',selection.player_identity_id,
                'externalIdentityDecisionId',selection.external_identity_decision_id,
                'clubId',selection.club_id,'sourceImportRowId',selection.source_import_row_id,
                'status',selection.status)
         FROM requested_member requested
         JOIN outcome_draft_selection selection ON selection.selection_id=requested.canonical_record_id
        WHERE requested.record_kind='draft_selection'
       UNION ALL
       SELECT requested.record_kind,custody.custody_observation_id,
              jsonb_build_object(
                'custodyObservationId',custody.custody_observation_id,'pickId',custody.pick_id,
                'observedAt',custody.observed_at,'draftSeasonYear',custody.draft_season_year,
                'draftKind',custody.draft_kind,'recordedRound',custody.recorded_round,
                'recordedPick',custody.recorded_pick,'originalClubId',custody.original_club_id,
                'currentClubId',custody.current_club_id,'sourceImportRowId',custody.source_import_row_id,
                'status',custody.status,'evidence',custody.evidence_json,'recordedAt',custody.recorded_at)
         FROM requested_member requested
         JOIN outcome_pick_custody_observation custody
           ON custody.custody_observation_id=requested.canonical_record_id
        WHERE requested.record_kind='pick_custody'
       UNION ALL
       SELECT requested.record_kind,realization.realization_id,
              jsonb_build_object(
                'realizationId',realization.realization_id,'pickId',realization.pick_id,
                'transferAssetVersionId',realization.transfer_asset_version_id,
                'draftSelectionId',realization.draft_selection_id,
                'sourceImportRowId',realization.source_import_row_id,
                'relationKind',realization.relation_kind,'status',realization.status,
                'evidence',realization.evidence_json,'recordedAt',realization.recorded_at)
         FROM requested_member requested
         JOIN outcome_pick_realization realization
           ON realization.realization_id=requested.canonical_record_id
        WHERE requested.record_kind='pick_realization'
     )
     SELECT record_kind,canonical_record_id,canonical_record_json
       FROM canonical_member ORDER BY record_kind,canonical_record_id`,
    [canonicalizeAflTradeJson(requested)]
  );
  const expectedKeys = requested.map(
    ({ recordKind, canonicalRecordId }) => `${recordKind}\0${canonicalRecordId}`
  );
  const actualKeys = result.rows.map(
    ({ record_kind, canonical_record_id }) => `${record_kind}\0${canonical_record_id}`
  );
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new AflTradePromotionBackedFactualReleasePersistenceError(
      'CORPUS_INCOMPLETE',
      'The corpus canonical identities do not resolve to one exact stored canonical row each.'
    );
  }
  const snapshots = result.rows.map((row) => {
    const content = {
      schemaVersion: 'afl-trade-canonical-release-member/v1',
      recordKind: row.record_kind,
      record: row.canonical_record_json,
    } as const;
    return {
      recordKind: row.record_kind,
      canonicalRecordId: row.canonical_record_id,
      canonicalRecordSha256: sha256AflTradeCanonicalJson(content),
      recordCanonicalJson: canonicalizeAflTradeJson(content),
    };
  });
  return {
    members: snapshots.map(({ recordKind, canonicalRecordId, canonicalRecordSha256 }) => ({
      recordKind,
      canonicalRecordId,
      canonicalRecordSha256,
    })),
    snapshots,
  };
}

async function persistBundle(
  transaction: AflOutcomeSqlTransaction,
  bundle: ReturnType<typeof createAflTradePromotionBackedFactualRelease>,
  evidence: {
    sourceSnapshots: readonly { captureId: string; recordCanonicalJson: string }[];
    canonicalSnapshots: readonly {
      recordKind: RecordKind;
      canonicalRecordId: string;
      canonicalRecordSha256: string;
      recordCanonicalJson: string;
    }[];
  }
) {
  const { release, candidate } = bundle;
  await transaction.query(
    `INSERT INTO outcome_release_manifest
      (release_id,scope_key,environment,created_at,effective_through,manifest_canonical_json,
       manifest_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      release.releaseId,
      release.content.scopeKey,
      release.content.environment,
      release.content.createdAt,
      release.content.effectiveThrough,
      canonicalizeAflTradeJson(release.content),
      canonicalizeAflTradeJson(release),
    ]
  );
  await transaction.query(
    `INSERT INTO outcome_factual_release_candidate
      (candidate_id,candidate_sha256,target_release_id,environment,scope_key,competition,
       valid_from_season,valid_through_season,effective_through,member_set_sha256,
       promotion_backed_corpus_id,source_member_set_sha256,canonical_member_set_sha256,
       candidate_canonical_json,source_capture_set_canonical_json,
       promotion_source_set_canonical_json,canonical_member_set_canonical_json,status,
       member_counts_json,created_at,finalized_at,candidate_json)
     VALUES ($1,$2,$3,$4::"OutcomeEnvironment",$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,$17,'staged',$18::jsonb,$19,NULL,$20::jsonb)`,
    [
      candidate.candidateId,
      candidate.candidateSha256,
      release.releaseId,
      release.content.environment,
      release.content.scopeKey,
      release.content.competition,
      release.content.validFromSeason,
      release.content.validThroughSeason,
      release.content.effectiveThrough,
      release.content.sourceMemberSetSha256,
      release.content.corpusId,
      release.content.sourceMemberSetSha256,
      release.content.canonicalMemberSetSha256,
      canonicalizeAflTradeJson(candidate.content),
      canonicalizeAflTradeJson(release.content.sourceCaptures),
      canonicalizeAflTradeJson(release.content.promotionSources),
      canonicalizeAflTradeJson(release.content.canonicalMembers),
      canonicalizeAflTradeJson({
        sourceCaptures: release.content.sourceCaptures.length,
        canonicalMembers: release.content.canonicalMemberCount,
        ...release.content.canonicalRecordCounts,
      }),
      candidate.content.createdAt,
      canonicalizeAflTradeJson(candidate),
    ]
  );
  const sourceSnapshotByCapture = new Map(
    evidence.sourceSnapshots.map((snapshot) => [snapshot.captureId, snapshot.recordCanonicalJson])
  );
  for (const [index, capture] of release.content.sourceCaptures.entries()) {
    await transaction.query(
      `INSERT INTO outcome_release_source_capture
        (release_id,capture_id,ordinal,record_sha256,record_canonical_json,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        release.releaseId,
        capture.captureId,
        index + 1,
        capture.recordSha256,
        sourceSnapshotByCapture.get(capture.captureId),
        canonicalizeAflTradeJson(capture),
      ]
    );
  }
  const canonicalSnapshotByKey = new Map(
    evidence.canonicalSnapshots.map((snapshot) => [
      `${snapshot.recordKind}\0${snapshot.canonicalRecordId}`,
      snapshot.recordCanonicalJson,
    ])
  );
  const tableByKind = {
    transaction: ['outcome_release_event_version', 'event_version_id'],
    draft_event: ['outcome_release_event_version', 'event_version_id'],
    transfer: ['outcome_release_event_asset', 'asset_version_id'],
    draft_player_asset: ['outcome_release_event_asset', 'asset_version_id'],
    draft_selection: ['outcome_release_draft_selection', 'selection_id'],
    pick_custody: ['outcome_release_pick_custody', 'custody_observation_id'],
    pick_realization: ['outcome_release_pick_realization', 'realization_id'],
  } as const;
  const ordinals = new Map<string, number>();
  for (const member of release.content.canonicalMembers) {
    const [table, idColumn] = tableByKind[member.recordKind];
    const ordinal = (ordinals.get(table) ?? 0) + 1;
    ordinals.set(table, ordinal);
    await transaction.query(
      `INSERT INTO ${table}
        (release_id,${idColumn},ordinal,record_sha256,record_canonical_json,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        release.releaseId,
        member.canonicalRecordId,
        ordinal,
        member.canonicalRecordSha256,
        canonicalSnapshotByKey.get(`${member.recordKind}\0${member.canonicalRecordId}`),
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  const finalized = await transaction.query(
    `UPDATE outcome_factual_release_candidate SET status='approved',finalized_at=created_at
      WHERE candidate_id=$1 AND status='staged' AND finalized_at IS NULL`,
    [candidate.candidateId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradePromotionBackedFactualReleasePersistenceError(
      'CONFLICT',
      'Promotion-backed factual candidate could not be finalized exactly once.'
    );
  }
}

export class PostgresAflTradePromotionBackedFactualReleaseRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async build(unparsedRequest: unknown): Promise<PersistedAflTradePromotionBackedFactualRelease> {
    let request: BuildRequest;
    try {
      request = buildRequestSchema.parse(unparsedRequest);
    } catch (error) {
      throw new AflTradePromotionBackedFactualReleasePersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Factual release build request is invalid.'
      );
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `promotion-backed-factual-release:${request.corpusId}`,
      ]);
      const corpusResult = await transaction.query<CorpusRow>(
        `SELECT corpus.status,corpus.corpus_json
           FROM outcome_promotion_backed_corpus corpus
          WHERE corpus.corpus_id=$1 FOR SHARE OF corpus`,
        [request.corpusId]
      );
      if (corpusResult.rows.length !== 1 || corpusResult.rows[0]?.status !== 'finalized') {
        throw new AflTradePromotionBackedFactualReleasePersistenceError(
          'CORPUS_UNAVAILABLE',
          'Factual release requires one exact finalized promotion-backed corpus.'
        );
      }
      let corpus: AflTradePromotionBackedCorpus;
      try {
        corpus = parseAflTradePromotionBackedCorpus(corpusResult.rows[0].corpus_json);
      } catch (error) {
        throw new AflTradePromotionBackedFactualReleasePersistenceError(
          'CORPUS_INCOMPLETE',
          error instanceof Error ? error.message : 'Persisted corpus is invalid.'
        );
      }
      if (corpus.corpusId !== request.corpusId) {
        throw new AflTradePromotionBackedFactualReleasePersistenceError(
          'CORPUS_INCOMPLETE',
          'Persisted corpus content address does not match the requested identity.'
        );
      }
      const ancestry = await loadSourceAncestry(transaction, corpus, request.createdAt);
      const canonical = await loadCanonicalMembers(transaction, corpus);
      let bundle: ReturnType<typeof createAflTradePromotionBackedFactualRelease>;
      try {
        bundle = createAflTradePromotionBackedFactualRelease({
          corpus,
          scopeKey: request.scopeKey,
          createdAt: request.createdAt,
          effectiveThrough: corpus.content.knowledgeCutoffAt,
          sourceCaptures: ancestry.sourceCaptures,
          promotionSources: ancestry.promotionSources,
          canonicalMembers: canonical.members,
        });
      } catch (error) {
        throw new AflTradePromotionBackedFactualReleasePersistenceError(
          'CORPUS_INCOMPLETE',
          error instanceof Error ? error.message : 'Factual release evidence is incomplete.'
        );
      }
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-release-membership:${bundle.release.releaseId}`,
      ]);
      const replay = await transaction.query<ReplayRow>(
        `SELECT status,finalized_at,candidate_json
           FROM outcome_factual_release_candidate
          WHERE candidate_id=$1 FOR SHARE`,
        [bundle.candidate.candidateId]
      );
      if (replay.rows.length > 0) {
        const row = replay.rows[0];
        if (
          replay.rows.length !== 1 ||
          row?.status !== 'approved' ||
          row.finalized_at === null ||
          !exactJson(row.candidate_json, bundle.candidate)
        ) {
          throw new AflTradePromotionBackedFactualReleasePersistenceError(
            'CONFLICT',
            'Factual candidate identity already binds different or incomplete content.'
          );
        }
        try {
          return resultFromCandidate(
            parseAflTradePromotionBackedFactualCandidate(row.candidate_json),
            true
          );
        } catch (error) {
          throw new AflTradePromotionBackedFactualReleasePersistenceError(
            'CONFLICT',
            error instanceof Error ? error.message : 'Persisted factual candidate is invalid.'
          );
        }
      }
      await persistBundle(transaction, bundle, {
        sourceSnapshots: ancestry.sourceSnapshots,
        canonicalSnapshots: canonical.snapshots,
      });
      return resultFromCandidate(bundle.candidate, false);
    });
  }
}
