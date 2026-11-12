/**
 * The ETL's AFL match result ingest (etl/resultIngest.ts through etl/resultStore.ts) against the
 * migrated PostgreSQL schema: a round's nine results store and read back through Prisma by match id,
 * an unchanged re-ingest writes nothing, a changed score supersedes the stored row, a result that
 * changes back (A, B, A) supersedes again, a rejected batch writes nothing, and the migration's own constraints hold. Footywire is never contacted.
 */
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import {
  ingestResultRows,
  recordAbandonedResult,
  type ResultSourceRow,
} from '../../etl/resultIngest';
import { pgResultStore } from '../../etl/resultStore';

// A season no real data uses, so cleanup never touches another file's rows.
const SEASON = 1901;
const FETCHED_AT = new Date('2026-11-11T00:00:00Z');

const CLUBS: [string, string][] = [
  ['Adelaide', 'Brisbane'],
  ['Carlton', 'Collingwood'],
  ['Essendon', 'Fremantle'],
  ['Geelong', 'Gold Coast'],
  ['GWS', 'Hawthorn'],
  ['Melbourne', 'North Melbourne'],
  ['Port Adelaide', 'Richmond'],
  ['St Kilda', 'Sydney'],
  ['West Coast', 'Western Bulldogs'],
];

function roundRows(): ResultSourceRow[] {
  return CLUBS.map(([home, away], index) => ({
    season: SEASON,
    match_id: String(90001 + index),
    round_label: 'Round 5',
    home_team: home,
    away_team: away,
    home_points: 80 + index,
    away_points: 80 - index,
    date: '1901-04-20',
    last_home_and_away_round: 24,
  }));
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 2 });
const store = pgResultStore(pool);

async function cleanup() {
  // One statement: superseded rows reference their replacement, checked at commit.
  await prisma.$executeRaw`DELETE FROM "AflMatchResult" WHERE "season" = ${SEASON}`;
}

describe('AflMatchResult ingest on PostgreSQL', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("stores a round's nine results and reads them back by match id", async () => {
    const summary = await ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT });
    expect(summary).toEqual({ results: 9, inserted: 9, superseded: 0, unchanged: 0 });

    const stored = await prisma.aflMatchResult.findMany({
      where: { season: SEASON, supersededById: null },
      orderBy: { matchId: 'asc' },
    });
    expect(stored).toHaveLength(9);
    expect(stored[0]).toMatchObject({
      season: SEASON,
      round: 5,
      matchId: '90001',
      matchUid: '1901-R5-ADE-BRL',
      homeClub: 'Adelaide',
      awayClub: 'Brisbane Lions',
      homePoints: 80,
      awayPoints: 80,
      margin: 0,
      status: 'FINAL',
      fetchedAt: FETCHED_AT,
      supersedeReason: null,
    });
    expect(stored[8]).toMatchObject({ matchId: '90009', margin: 16 });

    const again = await ingestResultRows(roundRows(), { store, fetchedAt: new Date() });
    expect(again).toEqual({ results: 9, inserted: 0, superseded: 0, unchanged: 9 });
    expect(await prisma.aflMatchResult.count({ where: { season: SEASON } })).toBe(9);
  });

  it('a changed score creates a superseding row and keeps both', async () => {
    await ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT });
    const changed = roundRows();
    changed[2] = { ...changed[2], away_points: 83 };

    const summary = await ingestResultRows(changed, { store, fetchedAt: new Date() });

    expect(summary).toEqual({ results: 9, inserted: 0, superseded: 1, unchanged: 8 });
    const history = await prisma.aflMatchResult.findMany({
      where: { season: SEASON, matchId: '90003' },
      include: { supersededBy: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    const old = history.find((row) => row.supersededById !== null)!;
    const current = history.find((row) => row.supersededById === null)!;
    expect(old).toMatchObject({ homePoints: 82, awayPoints: 78, margin: 4 });
    expect(old.supersededBy?.id).toBe(current.id);
    expect(old.supersedeReason).toBe(
      'Footywire result changed: Essendon 82 v Fremantle 78 is now Essendon 82 v Fremantle 83'
    );
    expect(current).toMatchObject({ homePoints: 82, awayPoints: 83, margin: -1 });
  });

  it('a result that goes A, B, A ends with three rows and A current (BR-24)', async () => {
    await ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT });
    const changed = roundRows();
    changed[2] = { ...changed[2], away_points: 83 };
    await ingestResultRows(changed, { store, fetchedAt: new Date() });

    const summary = await ingestResultRows(roundRows(), { store, fetchedAt: new Date() });

    expect(summary).toEqual({ results: 9, inserted: 0, superseded: 1, unchanged: 8 });
    const history = await prisma.aflMatchResult.findMany({
      where: { season: SEASON, matchId: '90003' },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(3);
    const current = history.filter((row) => row.supersededById === null);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ homePoints: 82, awayPoints: 78, margin: 4 });
    expect(current[0].contentHash).toBe(
      history.find((row) => row.awayPoints === 78 && row.supersededById)!.contentHash
    );
    expect(history.find((row) => row.awayPoints === 83)!.supersedeReason).toBe(
      'Footywire result changed: Essendon 82 v Fremantle 83 is now Essendon 82 v Fremantle 78'
    );
  });

  it('a rejected batch writes nothing, including rows before the bad one', async () => {
    const rows = roundRows();
    rows[8] = { ...rows[8], home_points: null };

    await expect(ingestResultRows(rows, { store, fetchedAt: FETCHED_AT })).rejects.toThrow(
      /Unreadable home score/
    );
    expect(await prisma.aflMatchResult.count({ where: { season: SEASON } })).toBe(0);
  });

  it('a write that fails part-way rolls the whole transaction back', async () => {
    let calls = 0;
    const ids = () => (++calls === 5 ? 'duplicate-id' : `afl-result-int-${calls}`);
    await prisma.aflMatchResult.create({
      data: {
        id: 'duplicate-id',
        season: SEASON,
        round: 1,
        matchId: '1',
        matchUid: '1901-R1-ADE-CAR',
        homeClub: 'Adelaide',
        awayClub: 'Carlton',
        homePoints: 1,
        awayPoints: 0,
        margin: 1,
        status: 'FINAL',
        fetchedAt: FETCHED_AT,
        contentHash: 'x',
      },
    });

    await expect(
      ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT, newId: ids })
    ).rejects.toThrow();
    expect(await prisma.aflMatchResult.count({ where: { season: SEASON } })).toBe(1);
  });

  it('the schema refuses a second current row, an inconsistent margin and a reasonless supersede', async () => {
    await ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT });
    const base = await prisma.aflMatchResult.findFirstOrThrow({
      where: { season: SEASON, matchId: '90001' },
    });
    const { id: _id, createdAt: _createdAt, ...fields } = base;

    await expect(
      prisma.aflMatchResult.create({ data: { ...fields, contentHash: 'other' } })
    ).rejects.toThrow();
    await expect(
      prisma.aflMatchResult.create({
        data: { ...fields, matchId: '1', contentHash: 'other', margin: 5 },
      })
    ).rejects.toThrow();
    await expect(
      prisma.aflMatchResult.create({
        data: {
          ...fields,
          matchId: '2',
          contentHash: 'other',
          status: 'ABANDONED',
        },
      })
    ).rejects.toThrow();
    await expect(
      prisma.aflMatchResult.update({
        where: { id: base.id },
        data: { supersedeReason: 'no replacement' },
      })
    ).rejects.toThrow();

    await expect(
      prisma.aflMatchResult.create({
        data: {
          ...fields,
          matchId: '3',
          contentHash: 'abandoned',
          status: 'ABANDONED',
          homePoints: null,
          awayPoints: null,
          margin: null,
        },
      })
    ).resolves.toMatchObject({ status: 'ABANDONED' });
  });

  it('the operator command records an ABANDONED game once, and supersedes a stored result of it (#1315)', async () => {
    const abandoned = { season: SEASON, round: 5, homeTeam: 'Geelong', awayTeam: 'Gold Coast' };
    await expect(
      recordAbandonedResult(abandoned, { store, fetchedAt: FETCHED_AT })
    ).resolves.toMatchObject({ inserted: 1, superseded: 0 });
    // The table's CHECK constraint accepted it: no scores, no margin.
    await expect(
      prisma.aflMatchResult.findFirstOrThrow({
        where: { season: SEASON, matchId: `abandoned-${SEASON}-R5-GEE-GCS` },
      })
    ).resolves.toMatchObject({
      matchUid: `${SEASON}-R5-GEE-GCS`,
      status: 'ABANDONED',
      homePoints: null,
      awayPoints: null,
      margin: null,
      supersededById: null,
    });
    await expect(
      recordAbandonedResult(abandoned, { store, fetchedAt: FETCHED_AT })
    ).resolves.toMatchObject({ inserted: 0, superseded: 0, unchanged: 1 });

    // A game Footywire did post (match id 90004) that the operator then records as abandoned.
    await cleanup();
    await ingestResultRows(roundRows(), { store, fetchedAt: FETCHED_AT });
    await expect(
      recordAbandonedResult({ ...abandoned, matchId: '90004' }, { store, fetchedAt: FETCHED_AT })
    ).resolves.toMatchObject({ superseded: 1 });
    const old = await prisma.aflMatchResult.findFirstOrThrow({
      where: { season: SEASON, matchId: '90004', supersededById: { not: null } },
    });
    expect(old.supersedeReason).toBe(
      'Operator recorded the game as abandoned: Geelong 83 v Gold Coast 77 is now Geelong v Gold Coast abandoned'
    );
  });
});
