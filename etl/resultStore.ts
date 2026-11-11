/**
 * The PostgreSQL side of etl/resultIngest.ts: `AflMatchResult` in the fantasy database, whose shape
 * prisma/schema.prisma and its migration own. The ETL image carries no Prisma client, so these few
 * statements are written by hand; tests/integration/aflMatchResultIngest.test.ts runs them against
 * the migrated schema.
 */
import type { Pool, PoolClient } from 'pg';

import type {
  MatchResult,
  ResultStore,
  ResultStoreTransaction,
  StoredMatchResult,
} from './resultIngest';

// Any constant shared by every writer of AflMatchResult; the season is the second key.
const RESULT_LOCK_CLASS = 1292;

function transactionOn(client: PoolClient): ResultStoreTransaction {
  return {
    async read(season, matchIds) {
      const { rows } = await client.query<StoredMatchResult>(
        `SELECT "id", "matchId", "contentHash", "homeClub", "awayClub", "homePoints", "awayPoints",
                "status", "supersededById"
           FROM "AflMatchResult"
          WHERE "season" = $1 AND "matchId" = ANY($2::text[])`,
        [season, matchIds]
      );
      return rows;
    },
    async insert(id: string, result: MatchResult, fetchedAt: Date) {
      await client.query(
        `INSERT INTO "AflMatchResult"
           ("id", "season", "round", "matchId", "matchUid", "homeClub", "awayClub", "homePoints",
            "awayPoints", "margin", "status", "fetchedAt", "contentHash")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::"AflMatchResultStatus",
                 ($12::timestamptz AT TIME ZONE 'UTC'), $13)`,
        [
          id,
          result.season,
          result.round,
          result.matchId,
          result.matchUid,
          result.homeClub,
          result.awayClub,
          result.homePoints,
          result.awayPoints,
          result.margin,
          result.status,
          // Prisma stores UTC in timestamp-without-zone columns; pg would send a Date in local time.
          fetchedAt.toISOString(),
          result.contentHash,
        ]
      );
    },
    async markSuperseded(previousId, nextId, reason) {
      const { rowCount } = await client.query(
        `UPDATE "AflMatchResult" SET "supersededById" = $2, "supersedeReason" = $3
          WHERE "id" = $1 AND "supersededById" IS NULL`,
        [previousId, nextId, reason]
      );
      if (rowCount !== 1) throw new Error(`Result ${previousId} is no longer current`);
    },
  };
}

export function pgResultStore(pool: Pool): ResultStore {
  return {
    async transaction(season, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [RESULT_LOCK_CLASS, season]);
        const value = await work(transactionOn(client));
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
