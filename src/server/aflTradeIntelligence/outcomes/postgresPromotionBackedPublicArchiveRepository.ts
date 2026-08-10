import { z } from 'zod';

import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  createAflTradePromotionBackedFactualProjection,
  type AflTradePromotionBackedFactualProjection,
} from './promotionBackedFactualProjectionContracts';
import {
  parseAflTradePromotionBackedFactualCandidate,
  type AflTradePromotionBackedFactualCandidate,
} from './promotionBackedFactualReleaseContracts';
import {
  AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION,
  createAflTradePromotionBackedPublicArchive,
  parseAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from './promotionBackedPublicArchiveContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

const requestSchema = z
  .object({
    releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
    createdAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      .pipe(z.iso.datetime({ offset: true })),
  })
  .strict();

const partySchema = z
  .object({
    clubId: z.string().min(1),
    role: z.string().min(1),
    ordinal: z.number().int().positive(),
  })
  .passthrough();
const eventSchema = z
  .object({
    eventVersionId: z.string().min(1),
    eventId: z.string().min(1),
    seasonYear: z.number().int(),
    kind: z.string().min(1),
    eventDate: z.string().min(1),
    officialName: z.string().min(1),
    parties: z.array(partySchema),
  })
  .passthrough();
const assetSchema = z
  .object({
    assetVersionId: z.string().min(1),
    eventVersionId: z.string().min(1),
    assetKey: z.string().min(1),
    kind: z.enum(['player', 'current_pick', 'future_pick', 'cash', 'list_right', 'other']),
    playerId: z.string().min(1).nullable(),
    pickId: z.string().min(1).nullable(),
    fromClubId: z.string().min(1).nullable(),
    toClubId: z.string().min(1).nullable(),
    rawDescription: z.string().min(1),
  })
  .passthrough();
const selectionSchema = z
  .object({
    selectionId: z.string().min(1),
    eventVersionId: z.string().min(1),
    selectionNumber: z.number().int().positive(),
    pickId: z.string().min(1).nullable(),
    playerId: z.string().min(1).nullable(),
    clubId: z.string().min(1),
  })
  .passthrough();
const custodySchema = z
  .object({
    custodyObservationId: z.string().min(1),
    pickId: z.string().min(1),
    observedAt: z.string().min(1),
    draftSeasonYear: z.number().int(),
    draftKind: z.string().min(1),
    recordedRound: z.number().int().positive().nullable(),
    recordedPick: z.number().int().positive().nullable(),
    originalClubId: z.string().min(1),
    currentClubId: z.string().min(1),
  })
  .passthrough();
const realizationSchema = z
  .object({
    realizationId: z.string().min(1),
    pickId: z.string().min(1),
    transferAssetVersionId: z.string().min(1),
    draftSelectionId: z.string().min(1),
    relationKind: z.literal('exercised_as'),
  })
  .passthrough();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-canonical-release-member/v1'),
    record: z.unknown(),
  })
  .passthrough();

interface CandidateRow extends Record<string, unknown> {
  status: string;
  finalized_at: Date | string | null;
  candidate_json: unknown;
}
interface ArchiveRow extends Record<string, unknown> {
  status: string;
  finalized_at: Date | string | null;
  archive_json: unknown;
}
interface SnapshotRow extends Record<string, unknown> {
  record_kind: AflTradePromotionBackedPublicArchiveRecordInput['recordKind'];
  record_sha256: string;
  record_canonical_json: string;
}
interface ClubRow extends Record<string, unknown> {
  club_id: string;
  current_name: string;
  abbreviation: string | null;
}
interface PlayerRow extends Record<string, unknown> {
  player_id: string;
  display_name: string;
}
interface PickRow extends Record<string, unknown> {
  pick_id: string;
  draft_season_year: number;
  draft_kind: string;
  nominal_round: number | null;
  nominal_pick: number | null;
  original_club_id: string | null;
}

export interface PersistedAflTradePromotionBackedPublicArchive {
  readonly archive: AflTradePromotionBackedPublicArchive;
  readonly projection: AflTradePromotionBackedFactualProjection;
  readonly idempotentReplay: boolean;
}

export class AflTradePromotionBackedPublicArchivePersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'CANDIDATE_UNAVAILABLE' | 'MEMBERSHIP_INCOMPLETE' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradePromotionBackedPublicArchivePersistenceError';
  }
}

function dateOnly(value: string): string {
  const result = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new TypeError('Canonical event date is invalid.');
  return result;
}

function createProjection(
  candidate: AflTradePromotionBackedFactualCandidate,
  archive: AflTradePromotionBackedPublicArchive,
  createdAt: string
): AflTradePromotionBackedFactualProjection {
  return createAflTradePromotionBackedFactualProjection({
    candidate,
    archive,
    createdAt,
    parityReport: {
      artifact: createAflTradeCanonicalJsonArtifactRef(
        {
          archiveId: archive.archiveId,
          canonicalMemberSetSha256: archive.content.canonicalMemberSetSha256,
          recordSetSha256: archive.content.recordSetSha256,
          status: 'passed',
        },
        createdAt
      ),
      status: 'passed',
      checkCount: 5,
      failureCount: 0,
      checkedCanonicalRecordCount: archive.content.recordCount,
      checkedPublicRecordCount: archive.content.recordCount,
    },
  });
}

async function loadCandidate(
  transaction: AflOutcomeSqlTransaction,
  releaseId: string
): Promise<AflTradePromotionBackedFactualCandidate> {
  const result = await transaction.query<CandidateRow>(
    `SELECT status,finalized_at,candidate_json FROM outcome_factual_release_candidate
      WHERE target_release_id=$1 FOR KEY SHARE`,
    [releaseId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row?.status !== 'approved' || row.finalized_at === null) {
    throw new AflTradePromotionBackedPublicArchivePersistenceError(
      'CANDIDATE_UNAVAILABLE',
      'Public archive requires one exact finalized promotion-backed factual candidate.'
    );
  }
  try {
    return parseAflTradePromotionBackedFactualCandidate(row.candidate_json);
  } catch (error) {
    throw new AflTradePromotionBackedPublicArchivePersistenceError(
      'CANDIDATE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Persisted factual candidate is invalid.'
    );
  }
}

async function loadSnapshots(
  transaction: AflOutcomeSqlTransaction,
  releaseId: string
): Promise<readonly SnapshotRow[]> {
  const result = await transaction.query<SnapshotRow>(
    `SELECT membership_json->>'recordKind' AS record_kind,record_sha256,record_canonical_json
       FROM outcome_release_event_version WHERE release_id=$1
     UNION ALL SELECT membership_json->>'recordKind',record_sha256,record_canonical_json
       FROM outcome_release_event_asset WHERE release_id=$1
     UNION ALL SELECT 'draft_selection',record_sha256,record_canonical_json
       FROM outcome_release_draft_selection WHERE release_id=$1
     UNION ALL SELECT 'pick_custody',record_sha256,record_canonical_json
       FROM outcome_release_pick_custody WHERE release_id=$1
     UNION ALL SELECT 'pick_realization',record_sha256,record_canonical_json
       FROM outcome_release_pick_realization WHERE release_id=$1
     ORDER BY 1,3`,
    [releaseId]
  );
  if (result.rows.length === 0) {
    throw new AflTradePromotionBackedPublicArchivePersistenceError(
      'MEMBERSHIP_INCOMPLETE',
      'Public archive has no canonical release members.'
    );
  }
  return result.rows;
}

function requireMapValue<T>(map: ReadonlyMap<string, T>, id: string, kind: string): T {
  const value = map.get(id);
  if (!value) throw new TypeError(`Canonical ${kind} ${id} is unavailable.`);
  return value;
}

async function buildRecords(
  transaction: AflOutcomeSqlTransaction,
  snapshots: readonly SnapshotRow[]
): Promise<AflTradePromotionBackedPublicArchiveRecordInput[]> {
  const decoded = snapshots.map((row) => ({
    ...row,
    record: snapshotSchema.parse(JSON.parse(row.record_canonical_json)).record,
  }));
  const clubIds = new Set<string>();
  const playerIds = new Set<string>();
  const pickIds = new Set<string>();
  for (const value of decoded) {
    if (value.record_kind === 'transaction' || value.record_kind === 'draft_event') {
      for (const party of eventSchema.parse(value.record).parties) clubIds.add(party.clubId);
    } else if (value.record_kind === 'transfer' || value.record_kind === 'draft_player_asset') {
      const asset = assetSchema.parse(value.record);
      if (asset.fromClubId) clubIds.add(asset.fromClubId);
      if (asset.toClubId) clubIds.add(asset.toClubId);
      if (asset.playerId) playerIds.add(asset.playerId);
      if (asset.pickId) pickIds.add(asset.pickId);
    } else if (value.record_kind === 'draft_selection') {
      const selection = selectionSchema.parse(value.record);
      clubIds.add(selection.clubId);
      if (selection.playerId) playerIds.add(selection.playerId);
      if (selection.pickId) pickIds.add(selection.pickId);
    } else if (value.record_kind === 'pick_custody') {
      const custody = custodySchema.parse(value.record);
      clubIds.add(custody.originalClubId);
      clubIds.add(custody.currentClubId);
    }
  }
  const clubs = await transaction.query<ClubRow>(
    `SELECT club_id,current_name,abbreviation FROM outcome_club WHERE club_id=ANY($1::text[])`,
    [[...clubIds]]
  );
  const players = await transaction.query<PlayerRow>(
    `SELECT player_id,display_name FROM outcome_player WHERE player_id=ANY($1::text[])`,
    [[...playerIds]]
  );
  const picks = await transaction.query<PickRow>(
    `SELECT pick_id,draft_season_year,draft_kind::text,nominal_round,nominal_pick,original_club_id
       FROM outcome_draft_pick WHERE pick_id=ANY($1::text[])`,
    [[...pickIds]]
  );
  const clubById = new Map(clubs.rows.map((row) => [row.club_id, row]));
  const playerById = new Map(players.rows.map((row) => [row.player_id, row]));
  const pickById = new Map(picks.rows.map((row) => [row.pick_id, row]));
  const club = (id: string) => {
    const row = requireMapValue(clubById, id, 'club');
    return { clubId: row.club_id, name: row.current_name, abbreviation: row.abbreviation };
  };
  const player = (id: string) => {
    const row = requireMapValue(playerById, id, 'player');
    return { playerId: row.player_id, displayName: row.display_name };
  };
  const pick = (id: string) => {
    const row = requireMapValue(pickById, id, 'pick');
    return {
      pickId: row.pick_id,
      draftSeasonYear: row.draft_season_year,
      draftKind: row.draft_kind,
      nominalRound: row.nominal_round,
      nominalPick: row.nominal_pick,
      originalClub: row.original_club_id ? club(row.original_club_id) : null,
    };
  };

  return decoded.map(({ record_kind, record }) => {
    if (record_kind === 'transaction' || record_kind === 'draft_event') {
      const value = eventSchema.parse(record);
      if (record_kind === 'transaction') {
        return {
          recordKind: 'transaction',
          recordId: value.eventVersionId,
          eventId: value.eventId,
          eventVersionId: value.eventVersionId,
          seasonYear: value.seasonYear,
          occurredOn: dateOnly(value.eventDate),
          officialName: value.officialName,
          transactionType: value.kind,
          parties: value.parties.map((party) => ({
            club: club(party.clubId),
            role: party.role,
            ordinal: party.ordinal,
          })),
        };
      }
      return {
        recordKind: 'draft_event',
        recordId: value.eventVersionId,
        eventId: value.eventId,
        eventVersionId: value.eventVersionId,
        seasonYear: value.seasonYear,
        occurredOn: dateOnly(value.eventDate),
        officialName: value.officialName,
        draftKind: value.kind as 'national_draft',
      };
    }
    if (record_kind === 'transfer') {
      const value = assetSchema.parse(record);
      if (!value.fromClubId || !value.toClubId)
        throw new TypeError('Directed asset clubs are incomplete.');
      return {
        recordKind: record_kind,
        recordId: value.assetVersionId,
        assetVersionId: value.assetVersionId,
        eventVersionId: value.eventVersionId,
        assetKey: value.assetKey,
        assetKind: value.kind,
        rawDescription: value.rawDescription,
        player: value.playerId ? player(value.playerId) : null,
        pick: value.pickId ? pick(value.pickId) : null,
        fromClub: club(value.fromClubId),
        toClub: club(value.toClubId),
      } as AflTradePromotionBackedPublicArchiveRecordInput;
    }
    if (record_kind === 'draft_player_asset') {
      const value = assetSchema.parse(record);
      if (!value.playerId || !value.toClubId)
        throw new TypeError('Draft player asset selection is incomplete.');
      return {
        recordKind: 'draft_player_asset',
        recordId: value.assetVersionId,
        assetVersionId: value.assetVersionId,
        eventVersionId: value.eventVersionId,
        assetKey: value.assetKey,
        assetKind: 'player',
        rawDescription: value.rawDescription,
        player: player(value.playerId),
        pick: null,
        club: club(value.toClubId),
      };
    }
    if (record_kind === 'draft_selection') {
      const value = selectionSchema.parse(record);
      if (!value.playerId)
        throw new TypeError('Public draft selection requires a resolved player.');
      return {
        recordKind: 'draft_selection',
        recordId: value.selectionId,
        selectionId: value.selectionId,
        eventVersionId: value.eventVersionId,
        selectionNumber: value.selectionNumber,
        pickId: value.pickId,
        player: player(value.playerId),
        club: club(value.clubId),
      };
    }
    if (record_kind === 'pick_custody') {
      const value = custodySchema.parse(record);
      return {
        recordKind: 'pick_custody',
        recordId: value.custodyObservationId,
        custodyObservationId: value.custodyObservationId,
        pickId: value.pickId,
        observedAt: new Date(value.observedAt).toISOString(),
        draftSeasonYear: value.draftSeasonYear,
        draftKind: value.draftKind,
        recordedRound: value.recordedRound,
        recordedPick: value.recordedPick,
        originalClub: club(value.originalClubId),
        currentClub: club(value.currentClubId),
      };
    }
    const value = realizationSchema.parse(record);
    return {
      recordKind: 'pick_realization',
      recordId: value.realizationId,
      realizationId: value.realizationId,
      pickId: value.pickId,
      transferAssetVersionId: value.transferAssetVersionId,
      draftSelectionId: value.draftSelectionId,
      relationKind: value.relationKind,
    };
  });
}

function dimensions(
  record: AflTradePromotionBackedPublicArchiveRecordInput,
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[]
) {
  const clubIds = new Set<string>();
  const playerIds = new Set<string>();
  let seasonYear: number | null = null;
  let eventVersionId: string | null = null;
  let pickId: string | null = null;
  if (record.recordKind === 'transaction' || record.recordKind === 'draft_event') {
    seasonYear = record.seasonYear;
    eventVersionId = record.eventVersionId;
    if (record.recordKind === 'transaction')
      record.parties.forEach(({ club }) => clubIds.add(club.clubId));
  } else if (record.recordKind === 'transfer') {
    eventVersionId = record.eventVersionId;
    clubIds.add(record.fromClub.clubId);
    clubIds.add(record.toClub.clubId);
    if (record.pick?.originalClub) clubIds.add(record.pick.originalClub.clubId);
    if (record.player) playerIds.add(record.player.playerId);
    pickId = record.pick?.pickId ?? null;
  } else if (record.recordKind === 'draft_player_asset') {
    eventVersionId = record.eventVersionId;
    clubIds.add(record.club.clubId);
    playerIds.add(record.player.playerId);
  } else if (record.recordKind === 'draft_selection') {
    eventVersionId = record.eventVersionId;
    clubIds.add(record.club.clubId);
    playerIds.add(record.player.playerId);
    pickId = record.pickId;
  } else if (record.recordKind === 'pick_custody') {
    seasonYear = record.draftSeasonYear;
    clubIds.add(record.originalClub.clubId);
    clubIds.add(record.currentClub.clubId);
    pickId = record.pickId;
  } else {
    const transfer = records.find(
      (candidate) =>
        candidate.recordKind === 'transfer' &&
        candidate.assetVersionId === record.transferAssetVersionId
    );
    if (transfer?.recordKind === 'transfer') eventVersionId = transfer.eventVersionId;
    pickId = record.pickId;
  }
  if (eventVersionId) {
    const event = records.find(
      (candidate) =>
        (candidate.recordKind === 'transaction' || candidate.recordKind === 'draft_event') &&
        candidate.eventVersionId === eventVersionId
    );
    if (event && (event.recordKind === 'transaction' || event.recordKind === 'draft_event'))
      seasonYear = event.seasonYear;
  }
  return {
    seasonYear,
    eventVersionId,
    pickId,
    clubIds: [...clubIds].sort(),
    playerIds: [...playerIds].sort(),
  };
}

async function persistArchive(
  transaction: AflOutcomeSqlTransaction,
  archive: AflTradePromotionBackedPublicArchive
): Promise<void> {
  const content = archive.content;
  await transaction.query(
    `INSERT INTO outcome_public_factual_archive
      (archive_id,release_id,candidate_id,corpus_id,environment,scope_key,competition,
       valid_from_season,valid_through_season,effective_through,source_member_set_sha256,
       canonical_member_set_sha256,record_count,record_counts_json,record_set_sha256,
       archive_canonical_json,archive_json,status,created_at,finalized_at)
     VALUES ($1,$2,$3,$4,$5::"OutcomeEnvironment",$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
       $15,$16,$17::jsonb,'staged',$18,NULL)`,
    [
      archive.archiveId,
      content.releaseId,
      content.factualCandidateId,
      content.corpusId,
      content.environment,
      content.scopeKey,
      content.competition,
      content.validFromSeason,
      content.validThroughSeason,
      content.effectiveThrough,
      content.sourceMemberSetSha256,
      content.canonicalMemberSetSha256,
      content.recordCount,
      canonicalizeAflTradeJson(content.recordCounts),
      content.recordSetSha256,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(archive),
      content.createdAt,
    ]
  );
  const recordInputs = content.records.map(({ record }) => record);
  for (const row of content.records) {
    const digestPreimage = {
      schemaVersion: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION,
      recordKind: row.record.recordKind,
      canonicalRecordSha256: row.canonicalRecordSha256,
      record: row.record,
    };
    const indexed = dimensions(row.record, recordInputs);
    await transaction.query(
      `INSERT INTO outcome_public_factual_archive_record
        (archive_id,ordinal,record_kind,record_id,canonical_record_sha256,record_sha256,
         season_year,event_version_id,pick_id,club_ids,player_ids,search_text,
         record_canonical_json,record_digest_canonical_json,record_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11::text[],$12,$13,$14,$15::jsonb)`,
      [
        archive.archiveId,
        row.ordinal,
        row.record.recordKind,
        row.record.recordId,
        row.canonicalRecordSha256,
        row.recordSha256,
        indexed.seasonYear,
        indexed.eventVersionId,
        indexed.pickId,
        indexed.clubIds,
        indexed.playerIds,
        canonicalizeAflTradeJson(row),
        canonicalizeAflTradeJson(row),
        canonicalizeAflTradeJson(digestPreimage),
        canonicalizeAflTradeJson(row),
      ]
    );
  }
  const finalized = await transaction.query(
    `UPDATE outcome_public_factual_archive SET status='approved',finalized_at=created_at
      WHERE archive_id=$1 AND status='staged' AND finalized_at IS NULL`,
    [archive.archiveId]
  );
  if (finalized.rowCount !== 1)
    throw new Error('Public factual archive did not finalize exactly once.');
}

export class PostgresAflTradePromotionBackedPublicArchiveRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async build(unparsedRequest: unknown): Promise<PersistedAflTradePromotionBackedPublicArchive> {
    const parsed = requestSchema.safeParse(unparsedRequest);
    if (!parsed.success) {
      throw new AflTradePromotionBackedPublicArchivePersistenceError(
        'INVALID_INPUT',
        parsed.error.message
      );
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-public-factual-archive:${parsed.data.releaseId}`,
      ]);
      const candidate = await loadCandidate(transaction, parsed.data.releaseId);
      const replay = await transaction.query<ArchiveRow>(
        `SELECT status,finalized_at,archive_json FROM outcome_public_factual_archive
          WHERE release_id=$1 FOR SHARE`,
        [parsed.data.releaseId]
      );
      if (replay.rows.length > 0) {
        const row = replay.rows[0];
        let archive: AflTradePromotionBackedPublicArchive;
        try {
          archive = parseAflTradePromotionBackedPublicArchive(row?.archive_json);
        } catch (error) {
          throw new AflTradePromotionBackedPublicArchivePersistenceError(
            'CONFLICT',
            error instanceof Error ? error.message : 'Persisted public archive is invalid.'
          );
        }
        if (
          replay.rows.length !== 1 ||
          row?.status !== 'approved' ||
          row.finalized_at === null ||
          archive.content.createdAt !== parsed.data.createdAt ||
          archive.content.factualCandidateId !== candidate.candidateId
        ) {
          throw new AflTradePromotionBackedPublicArchivePersistenceError(
            'CONFLICT',
            'The release already binds a different or incomplete public archive.'
          );
        }
        return {
          archive,
          projection: createProjection(candidate, archive, parsed.data.createdAt),
          idempotentReplay: true,
        };
      }
      try {
        const snapshots = await loadSnapshots(transaction, parsed.data.releaseId);
        const records = await buildRecords(transaction, snapshots);
        const archive = createAflTradePromotionBackedPublicArchive({
          candidate,
          createdAt: parsed.data.createdAt,
          records,
        });
        await persistArchive(transaction, archive);
        return {
          archive,
          projection: createProjection(candidate, archive, parsed.data.createdAt),
          idempotentReplay: false,
        };
      } catch (error) {
        if (error instanceof AflTradePromotionBackedPublicArchivePersistenceError) throw error;
        throw new AflTradePromotionBackedPublicArchivePersistenceError(
          'MEMBERSHIP_INCOMPLETE',
          error instanceof Error ? error.message : 'Public archive materialization failed.'
        );
      }
    });
  }
}
