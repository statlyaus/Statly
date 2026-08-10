import { z } from 'zod';

import type { AflTradePromotionBackedArchiveSelection } from './promotionBackedArchiveSelection';
import {
  aflTradePromotionBackedPublicArchiveRecordSchema,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from './promotionBackedPublicArchiveContracts';
import type { AflOutcomeSqlClient } from './postgresOutcomeReleaseRepository';

const recordKindSchema = z.enum([
  'transaction',
  'transfer',
  'draft_event',
  'draft_selection',
  'draft_player_asset',
  'pick_custody',
  'pick_realization',
]);
const querySchema = z
  .object({
    recordKinds: z.array(recordKindSchema).min(1).max(7),
    seasonYear: z.number().int().min(1897).max(2200).optional(),
    clubId: z.string().trim().min(1).max(1_000).optional(),
    playerId: z.string().trim().min(1).max(1_000).optional(),
    eventVersionIds: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
    pickIds: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
    limit: z.number().int().positive().max(10_000).default(5_000),
  })
  .strict();

interface ArchiveHeaderRow extends Record<string, unknown> {
  archive_id: string;
  release_id: string;
  candidate_id: string;
  corpus_id: string;
  environment: string;
  scope_key: string;
  competition: string;
  source_member_set_sha256: string;
  canonical_member_set_sha256: string;
  record_count: number;
  record_set_sha256: string;
  status: string;
  finalized_at: Date | string | null;
}
interface RecordRow extends Record<string, unknown> {
  ordinal: number;
  record_json: unknown;
}

export interface AflTradePromotionBackedPublicArchiveRecordQuery {
  readonly recordKinds: readonly AflTradePromotionBackedPublicArchiveRecordInput['recordKind'][];
  readonly seasonYear?: number;
  readonly clubId?: string;
  readonly playerId?: string;
  readonly eventVersionIds?: readonly string[];
  readonly pickIds?: readonly string[];
  readonly limit?: number;
}

export interface AflTradePromotionBackedPublicArchiveReadRepository {
  listRecords(
    selection: AflTradePromotionBackedArchiveSelection,
    query: AflTradePromotionBackedPublicArchiveRecordQuery
  ): Promise<readonly AflTradePromotionBackedPublicArchiveRecordInput[]>;
  listAllRecords(
    selection: AflTradePromotionBackedArchiveSelection,
    query: Omit<AflTradePromotionBackedPublicArchiveRecordQuery, 'limit'>
  ): Promise<readonly AflTradePromotionBackedPublicArchiveRecordInput[]>;
}

function requireExactHeader(
  row: ArchiveHeaderRow | undefined,
  count: number,
  selection: AflTradePromotionBackedArchiveSelection
): void {
  if (
    count !== 1 ||
    !row ||
    row.status !== 'approved' ||
    row.finalized_at === null ||
    row.archive_id !== selection.publicArchiveId ||
    row.release_id !== selection.releaseId ||
    row.candidate_id !== selection.factualCandidateId ||
    row.corpus_id !== selection.corpusId ||
    row.environment !== selection.environment ||
    row.scope_key !== selection.scopeKey ||
    row.competition !== selection.competition ||
    row.source_member_set_sha256 !== selection.sourceMemberSetSha256 ||
    row.canonical_member_set_sha256 !== selection.canonicalMemberSetSha256 ||
    Number(row.record_count) !== selection.publicRecordCount ||
    row.record_set_sha256 !== selection.publicRecordSetSha256
  ) {
    throw new Error('The selected public factual archive header does not match its authority.');
  }
}

export function createPostgresAflTradePromotionBackedPublicArchiveReadRepository(dependencies: {
  client: AflOutcomeSqlClient;
  pageSize?: number;
}): AflTradePromotionBackedPublicArchiveReadRepository {
  const pageSize = z
    .number()
    .int()
    .positive()
    .max(10_000)
    .parse(dependencies.pageSize ?? 5_000);

  async function requireHeader(selection: AflTradePromotionBackedArchiveSelection): Promise<void> {
    const header = await dependencies.client.query<ArchiveHeaderRow>(
      `SELECT archive.archive_id,archive.release_id,archive.candidate_id,archive.corpus_id,
              archive.environment::text,archive.scope_key,archive.competition,
              archive.source_member_set_sha256,archive.canonical_member_set_sha256,
              archive.record_count,archive.record_set_sha256,archive.status::text,
              archive.finalized_at
         FROM outcome_public_factual_archive archive
         JOIN outcome_projection_manifest projection
           ON projection.public_archive_id=archive.archive_id
          AND projection.projection_id=$2 AND projection.release_id=archive.release_id
        WHERE archive.archive_id=$1 FOR SHARE OF archive,projection`,
      [selection.publicArchiveId, selection.projectionId]
    );
    requireExactHeader(header.rows[0], header.rows.length, selection);
  }

  async function readPage(
    selection: AflTradePromotionBackedArchiveSelection,
    query: z.infer<typeof querySchema>,
    afterOrdinal: number,
    limit: number
  ): Promise<readonly RecordRow[]> {
    const rows = await dependencies.client.query<RecordRow>(
      `SELECT ordinal,record_json FROM outcome_public_factual_archive_record
        WHERE archive_id=$1 AND record_kind=ANY($2::text[])
          AND ($3::integer IS NULL OR season_year=$3)
          AND ($4::text IS NULL OR club_ids @> ARRAY[$4]::text[])
          AND ($5::text IS NULL OR player_ids @> ARRAY[$5]::text[])
          AND (cardinality($6::text[])=0 OR event_version_id=ANY($6::text[]))
          AND (cardinality($7::text[])=0 OR pick_id=ANY($7::text[]))
          AND ordinal>$8
        ORDER BY ordinal LIMIT $9`,
      [
        selection.publicArchiveId,
        query.recordKinds,
        query.seasonYear ?? null,
        query.clubId ?? null,
        query.playerId ?? null,
        query.eventVersionIds,
        query.pickIds,
        afterOrdinal,
        limit,
      ]
    );
    return rows.rows;
  }

  function parseRows(rows: readonly RecordRow[]) {
    return rows.map(
      (row) => aflTradePromotionBackedPublicArchiveRecordSchema.parse(row.record_json).record
    );
  }

  return {
    async listRecords(selection, unparsedQuery) {
      const query = querySchema.parse(unparsedQuery);
      await requireHeader(selection);
      return parseRows(await readPage(selection, query, 0, query.limit));
    },
    async listAllRecords(selection, unparsedQuery) {
      const query = querySchema.parse({ ...unparsedQuery, limit: pageSize });
      await requireHeader(selection);
      const records: AflTradePromotionBackedPublicArchiveRecordInput[] = [];
      let afterOrdinal = 0;
      for (;;) {
        const rows = await readPage(selection, query, afterOrdinal, pageSize);
        records.push(...parseRows(rows));
        if (rows.length < pageSize) return records;
        const nextOrdinal = Number(rows.at(-1)?.ordinal);
        if (!Number.isInteger(nextOrdinal) || nextOrdinal <= afterOrdinal) {
          throw new Error('The selected public factual archive cursor did not advance.');
        }
        afterOrdinal = nextOrdinal;
      }
    },
  };
}
