import { Prisma, type PrismaClient } from '@prisma/client';

import {
  fetchFootywireInjuryList,
  parseFootywireInjuryList,
  type ParsedInjuryRow,
} from './footywireInjuryList';
import { FOOTYWIRE_INJURY_LIST_URL, FOOTYWIRE_INJURY_SOURCE } from './injuryListConstants';
import {
  contentSha256,
  matchInjuryRowsToPlayers,
  type MatchedInjuryRow,
} from './injuryListMatching';

/**
 * Stores the Footywire injury list as an append-only Prisma snapshot.
 *
 * Injuries are facts about AFL players, not about any league or season, so snapshots carry no
 * league or season scope; `aflSeason` only records the calendar year the list was fetched in. Every
 * failure before the write (fetch, parse, sanity) rejects the run and writes nothing, so the last
 * good snapshot stays current until the read model's freshness window says otherwise.
 */

// The in-season list peaks around 300 rows across 18 clubs. Far more than that means the page is
// not the list we think it is. There is no minimum: the off-season page can show 2 clubs and 8 rows,
// and the parser already rejects a page with no club tables.
export const MAX_INJURY_LIST_ROWS = 600;

export type InjuryListIngestionRejectionReason = 'fetch_failed' | 'parse_failed' | 'too_many_rows';

export class InjuryListIngestionRejected extends Error {
  constructor(
    readonly reason: InjuryListIngestionRejectionReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'InjuryListIngestionRejected';
  }
}

export interface InjuryListCounts {
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
}

export type InjuryListIngestionResult =
  | { outcome: 'created'; snapshotId: string; counts: InjuryListCounts }
  | {
      outcome: 'unchanged';
      snapshotId: string;
      /** Counts after re-matching the stored entries against today's players. */
      counts: InjuryListCounts;
      /** Entries whose player link or match status changed on this confirmation. */
      relinked: number;
    };

export type InjuryListIngestionClient = Pick<
  PrismaClient,
  'player' | 'injuryListSnapshot' | '$transaction'
>;

export interface IngestFootywireInjuryListOptions {
  prisma: InjuryListIngestionClient;
  fetchImpl?: typeof fetch;
  now?: Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readRows(fetchImpl: typeof fetch | undefined): Promise<ParsedInjuryRow[]> {
  let html: string;
  try {
    html = await fetchFootywireInjuryList(fetchImpl);
  } catch (error) {
    throw new InjuryListIngestionRejected(
      'fetch_failed',
      `Footywire injury list fetch failed: ${errorMessage(error)}`,
      { cause: error }
    );
  }

  let rows: ParsedInjuryRow[];
  try {
    rows = parseFootywireInjuryList(html);
  } catch (error) {
    throw new InjuryListIngestionRejected(
      'parse_failed',
      `Footywire injury list could not be parsed: ${errorMessage(error)}`,
      { cause: error }
    );
  }

  if (rows.length > MAX_INJURY_LIST_ROWS) {
    throw new InjuryListIngestionRejected(
      'too_many_rows',
      `Footywire injury list has ${rows.length} rows, more than the ${MAX_INJURY_LIST_ROWS} allowed`
    );
  }
  return rows;
}

type InjuryListTransaction = Prisma.TransactionClient;

function countMatches(matched: readonly MatchedInjuryRow[]): InjuryListCounts {
  return {
    rowCount: matched.length,
    matchedCount: matched.filter((row) => row.matchStatus === 'MATCHED').length,
    unmatchedCount: matched.filter((row) => row.matchStatus === 'UNMATCHED').length,
    ambiguousCount: matched.filter((row) => row.matchStatus === 'AMBIGUOUS').length,
  };
}

function findSnapshotByHash(tx: InjuryListTransaction, hash: string) {
  return tx.injuryListSnapshot.findUnique({
    where: { source_contentSha256: { source: FOOTYWIRE_INJURY_SOURCE, contentSha256: hash } },
    select: { id: true },
  });
}

/**
 * Confirms a snapshot whose rows were just fetched again, and re-links its entries. The content hash
 * covers the source rows only; the player links are derived from them and can improve as players
 * are imported (a row unmatched last week may name a player who exists now), so a confirmation
 * re-applies today's matching instead of keeping the links made when the snapshot was created.
 */
async function reconfirmSnapshot(
  tx: InjuryListTransaction,
  snapshotId: string,
  matched: readonly MatchedInjuryRow[],
  now: Date
): Promise<InjuryListIngestionResult> {
  // sourceKey is unique within a snapshot (the parser rejects a repeat) and is part of the hash,
  // so the stored entries and the fresh rows are the same set.
  const fresh = new Map(matched.map((row) => [row.sourceKey, row]));
  const entries = await tx.injuryListEntry.findMany({
    where: { snapshotId },
    select: { id: true, sourceKey: true, playerId: true, matchStatus: true },
  });
  if (entries.length !== fresh.size) {
    throw new Error(
      `Injury list snapshot ${snapshotId} has ${entries.length} entries but the list has ${fresh.size} rows`
    );
  }

  let relinked = 0;
  for (const entry of entries) {
    const row = fresh.get(entry.sourceKey);
    if (!row) {
      throw new Error(`Injury list snapshot ${snapshotId} has no row for ${entry.sourceKey}`);
    }
    if (entry.playerId === row.playerId && entry.matchStatus === row.matchStatus) continue;
    await tx.injuryListEntry.update({
      where: { id: entry.id },
      data: { playerId: row.playerId, matchStatus: row.matchStatus },
    });
    relinked += 1;
  }

  const counts = countMatches(matched);
  await tx.injuryListSnapshot.update({
    where: { id: snapshotId },
    data: { ...counts, confirmedAt: now },
  });
  return { outcome: 'unchanged', snapshotId, counts, relinked };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function ingestFootywireInjuryList({
  prisma,
  fetchImpl,
  now = new Date(),
}: IngestFootywireInjuryListOptions): Promise<InjuryListIngestionResult> {
  const rows = await readRows(fetchImpl);

  const players = await prisma.player.findMany({
    where: { active: true },
    select: { id: true, name: true, club: true },
  });
  const matched = matchInjuryRowsToPlayers(rows, players);
  const hash = contentSha256(rows);
  const counts = countMatches(matched);

  try {
    return await prisma.$transaction(async (tx) => {
      // `@@unique([source, contentSha256])` allows one snapshot per distinct list. Whether this list
      // is the latest one or an older one it reverted to (A, then B, then A again), the existing
      // snapshot is confirmed: advancing its confirmedAt makes it the latest, which is what the
      // read model needs.
      const existing = await findSnapshotByHash(tx, hash);
      if (existing) return reconfirmSnapshot(tx, existing.id, matched, now);

      const created = await tx.injuryListSnapshot.create({
        data: {
          source: FOOTYWIRE_INJURY_SOURCE,
          sourceUrl: FOOTYWIRE_INJURY_LIST_URL,
          contentSha256: hash,
          // The UTC year on Netlify; it only labels the snapshot and is never used to scope a read.
          aflSeason: now.getFullYear(),
          ...counts,
          fetchedAt: now,
          confirmedAt: now,
          entries: {
            createMany: {
              data: matched.map((row) => ({
                clubName: row.clubName,
                sourceKey: row.sourceKey,
                playerName: row.playerName,
                injuryRaw: row.injuryRaw,
                returnRaw: row.returnRaw,
                status: row.status,
                etaWeeksMin: row.etaWeeksMin,
                etaWeeksMax: row.etaWeeksMax,
                etaDaysMin: row.etaDaysMin,
                etaDaysMax: row.etaDaysMax,
                playerId: row.playerId,
                matchStatus: row.matchStatus,
              })),
            },
          },
        },
        select: { id: true },
      });
      return { outcome: 'created' as const, snapshotId: created.id, counts };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent run created this list between our read and our insert. PostgreSQL has aborted
    // our transaction, so the snapshot the other run wrote is confirmed in a fresh one.
    return prisma.$transaction(async (tx) => {
      const existing = await findSnapshotByHash(tx, hash);
      if (!existing) throw error;
      return reconfirmSnapshot(tx, existing.id, matched, now);
    });
  }
}
