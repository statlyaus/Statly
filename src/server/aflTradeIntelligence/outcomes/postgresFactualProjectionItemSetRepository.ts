import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeFactualProjectionItemSetSchema,
  type AflTradeFactualProjectionItemSet,
} from './factualProjectionItemSetContracts';
import { aflDraftTradeOutcomeFactualProjectionManifestSchema } from './outcomeReleaseContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Projection item-set instants must use UTC Z notation.');

interface ExistingItemSetRow {
  item_count: number;
  item_set_sha256: string;
  finalized_at: string | Date;
}

interface FinalizedCandidateRow {
  finalized_at: string | Date;
}

function sameInstant(actual: string | Date, expected: string): boolean {
  return new Date(actual).toISOString() === expected;
}

function searchText(item: AflTradeFactualProjectionItemSet['members'][number]['item']): string {
  return [
    item.eventId,
    item.tradeId,
    item.assetId,
    item.acquisitionType,
    item.aflClubId,
    item.clubName,
    item.player.aflPlayerId,
    item.player.displayName,
  ]
    .filter((value): value is string => value !== null)
    .join(' ');
}

function indexedRows(itemSet: AflTradeFactualProjectionItemSet) {
  return itemSet.members.map((member) => ({
    ordinal: member.ordinal,
    item_key: member.itemKey,
    event_id: member.item.eventId,
    trade_id: member.item.tradeId,
    asset_id: member.item.assetId,
    year: member.item.year,
    afl_club_id: member.item.aflClubId,
    club_name: member.item.clubName,
    player_name: member.item.player.displayName,
    search_text: searchText(member.item),
    metric_codes: [...new Set(member.item.checks.map(({ metric }) => metric))].sort(),
    status_codes: [...new Set(member.item.checks.map(({ status }) => status))].sort(),
    item_json: member.item,
    item_canonical_json: member.canonicalItemJson,
    item_sha256: member.itemSha256,
  }));
}

async function requireExactProjectionParents(
  transaction: AflOutcomeSqlTransaction,
  projection: z.infer<typeof aflDraftTradeOutcomeFactualProjectionManifestSchema>
) {
  const candidate = await transaction.query<FinalizedCandidateRow>(
    `SELECT finalized_at
       FROM outcome_factual_release_candidate
      WHERE candidate_id = $1
        AND target_release_id = $2
        AND member_set_sha256 = $3
        AND status = 'approved'
        AND finalized_at IS NOT NULL
        AND finalized_at <= $4
      FOR KEY SHARE`,
    [
      projection.content.factualCandidateId,
      projection.content.releaseId,
      projection.content.sourceMemberSetSha256,
      projection.content.createdAt,
    ]
  );
  if (
    candidate.rows.length !== 1 ||
    Date.parse(new Date(candidate.rows[0].finalized_at).toISOString()) >
      Date.parse(projection.content.createdAt)
  ) {
    throw new Error('Factual projection staging requires its exact finalized candidate.');
  }
}

export class PostgresAflTradeFactualProjectionItemSetRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persist(input: {
    projection: unknown;
    itemSet: unknown;
    finalizedAt: string;
  }): Promise<{ idempotentReplay: boolean }> {
    const projection = aflDraftTradeOutcomeFactualProjectionManifestSchema.parse(input.projection);
    const itemSet = aflTradeFactualProjectionItemSetSchema.parse(input.itemSet);
    const finalizedAt = utcInstantSchema.parse(input.finalizedAt);
    if (
      projection.content.documentCount !== itemSet.itemCount ||
      projection.content.publicListItemSetSha256 !== itemSet.itemSetSha256
    ) {
      throw new TypeError('Factual projection and public item-set evidence do not match.');
    }
    if (Date.parse(finalizedAt) < Date.parse(projection.content.createdAt)) {
      throw new TypeError('Factual projection item finalization predates its manifest.');
    }

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-factual-projection-items:${projection.projectionId}`,
      ]);
      await requireExactProjectionParents(transaction, projection);
      await transaction.query(
        `INSERT INTO outcome_projection_manifest
          (projection_id, release_id, created_at, manifest_json)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (projection_id) DO NOTHING`,
        [
          projection.projectionId,
          projection.content.releaseId,
          projection.content.createdAt,
          canonicalizeAflTradeJson(projection),
        ]
      );
      const exactProjection = await transaction.query(
        `SELECT projection_id
           FROM outcome_projection_manifest
          WHERE projection_id = $1
            AND release_id = $2
            AND created_at = $3
            AND manifest_json = $4::jsonb
          FOR KEY SHARE`,
        [
          projection.projectionId,
          projection.content.releaseId,
          projection.content.createdAt,
          canonicalizeAflTradeJson(projection),
        ]
      );
      if (exactProjection.rows.length !== 1) {
        throw new Error('Factual projection conflicts with staged immutable evidence.');
      }

      const existing = await transaction.query<ExistingItemSetRow>(
        `SELECT item_count, item_set_sha256, finalized_at
           FROM outcome_factual_projection_item_set
          WHERE projection_id = $1
          FOR KEY SHARE`,
        [projection.projectionId]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (
          row.item_count !== itemSet.itemCount ||
          row.item_set_sha256 !== itemSet.itemSetSha256 ||
          !sameInstant(row.finalized_at, finalizedAt)
        ) {
          throw new Error('Factual projection item-set replay conflicts with stored evidence.');
        }
        return { idempotentReplay: true };
      }

      await transaction.query(
        `INSERT INTO outcome_projection_item
          (release_id, projection_id, ordinal, item_key, event_id, trade_id, asset_id, year,
           afl_club_id, club_name, player_name, search_text, metric_codes, status_codes, item_json,
           item_canonical_json, item_sha256)
         SELECT $1, $2, row.ordinal::BIGINT, row.item_key, row.event_id, row.trade_id,
                row.asset_id, row.year, row.afl_club_id, row.club_name, row.player_name,
                row.search_text, row.metric_codes, row.status_codes, row.item_json,
                row.item_canonical_json, row.item_sha256
           FROM jsonb_to_recordset($3::jsonb) AS row(
             ordinal TEXT, item_key TEXT, event_id TEXT, trade_id TEXT, asset_id TEXT,
             year INTEGER, afl_club_id TEXT, club_name TEXT, player_name TEXT, search_text TEXT,
             metric_codes TEXT[], status_codes TEXT[], item_json JSONB,
             item_canonical_json TEXT, item_sha256 CHAR(64)
           )
         ON CONFLICT (projection_id, ordinal) DO NOTHING`,
        [
          projection.content.releaseId,
          projection.projectionId,
          canonicalizeAflTradeJson(indexedRows(itemSet)),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_factual_projection_item_set
          (projection_id, release_id, item_count, item_set_sha256, finalized_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          projection.projectionId,
          projection.content.releaseId,
          itemSet.itemCount,
          itemSet.itemSetSha256,
          finalizedAt,
        ]
      );
      return { idempotentReplay: false };
    });
  }
}
