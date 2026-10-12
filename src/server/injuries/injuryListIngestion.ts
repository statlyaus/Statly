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
 * league or season scope. Every failure before the write (fetch, parse, sanity) rejects the run
 * and writes nothing, so the last good snapshot stays current until the read model's freshness
 * window says otherwise.
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
  rows: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
}

export interface InjuryListIngestionResult {
  outcome: 'created' | 'unchanged';
  snapshotId: string;
  /** This run's match counts, for the response and the log; they are not stored. */
  counts: InjuryListCounts;
}

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

function countMatches(matched: readonly MatchedInjuryRow[]): InjuryListCounts {
  const count = (status: MatchedInjuryRow['matchStatus']) =>
    matched.filter((row) => row.matchStatus === status).length;
  return {
    rows: matched.length,
    matched: count('MATCHED'),
    unmatched: count('UNMATCHED'),
    ambiguous: count('AMBIGUOUS'),
  };
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
  const contentHash = contentSha256(matched);
  const counts = countMatches(matched);

  // `@@unique([source, contentSha256])` allows one snapshot per distinct list. Whether this list is
  // the latest one or an older one it reverted to (A, then B, then A again), the existing snapshot
  // is confirmed: advancing its confirmedAt makes it the latest, which is what the read model needs.
  const attempt = async (tx: Prisma.TransactionClient): Promise<InjuryListIngestionResult> => {
    const existing = await tx.injuryListSnapshot.findUnique({
      where: {
        source_contentSha256: { source: FOOTYWIRE_INJURY_SOURCE, contentSha256: contentHash },
      },
      select: { id: true },
    });
    if (existing) {
      await tx.injuryListSnapshot.update({
        where: { id: existing.id },
        data: { confirmedAt: now },
      });
      return { outcome: 'unchanged', snapshotId: existing.id, counts };
    }

    const created = await tx.injuryListSnapshot.create({
      data: {
        source: FOOTYWIRE_INJURY_SOURCE,
        sourceUrl: FOOTYWIRE_INJURY_LIST_URL,
        contentSha256: contentHash,
        fetchedAt: now,
        confirmedAt: now,
        entries: { createMany: { data: matched } },
      },
      select: { id: true },
    });
    return { outcome: 'created', snapshotId: created.id, counts };
  };

  try {
    return await prisma.$transaction(attempt);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent run created this list between our read and our insert. PostgreSQL has aborted
    // our transaction, so the retry runs in a fresh one and finds the other run's snapshot.
    return prisma.$transaction(attempt);
  }
}
