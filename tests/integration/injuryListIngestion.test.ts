/**
 * The Footywire injury list as append-only Prisma snapshots: a new list, or the same rows linked to
 * different players, creates one snapshot with its entries; a repeat only confirms it; a rejected
 * run writes nothing. Footywire is never contacted; fetchImpl serves the trimmed live fixture and
 * variants built from it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  ingestFootywireInjuryList,
  InjuryListIngestionRejected,
} from '@/server/injuries/injuryListIngestion';
import { clubTable, injuryListPage, playerRow } from '@/server/injuries/__fixtures__/footywireHtml';

const FIXTURE_HTML = readFileSync(
  path.resolve(process.cwd(), 'src/server/injuries/__fixtures__/footywire-injury-list.html'),
  'utf8'
);

// Letters only: normalizePlayerName strips everything else, and the prefix has to survive it so
// these rows can never match a player another file left behind.
const PREFIX = 'Intinjurylist';
const FIXTURE_NAMES = [
  'Henry Smith',
  'Jack Payne',
  'Noah Answerth',
  'Reece Torrent',
  'Zane Zakostelsky',
  'Aiden Riddle',
  'Ollie Murphy',
  'Sam Sturt',
];
const name = (fixtureName: string) => `${PREFIX} ${fixtureName}`;
const PLAYER_ID_PREFIX = 'int-injury-list-';

// Same markup as the fixture, with every player renamed to carry the prefix.
function prefixedHtml(html = FIXTURE_HTML): string {
  return FIXTURE_NAMES.reduce(
    (current, fixtureName) =>
      current.replaceAll(`>${fixtureName}</a>`, `>${name(fixtureName)}</a>`),
    html
  );
}

const BASE_HTML = prefixedHtml();
// One parsed field differs, so the content hash differs.
const CHANGED_HTML = BASE_HTML.replace(
  '<td align="center">Hamstring</td>\n<td align="center">TBC</td>',
  '<td align="center">Hamstring</td>\n<td align="center">2-3 weeks</td>'
);

function oversizedHtml(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, index) =>
    playerRow(
      `/afl/footy/pp-brisbane-lions--${PREFIX.toLowerCase()}-${index}`,
      `${PREFIX} Row ${index}`,
      'Knee',
      'Season'
    )
  );
  return injuryListPage(clubTable(`Brisbane Lions (${rowCount} Players)`, rows));
}

function serving(html: string): typeof fetch {
  return (async () => new Response(html, { status: 200 })) as typeof fetch;
}

const failingFetch = (async () =>
  new Response('Service Unavailable', { status: 503 })) as typeof fetch;

const T0 = new Date('2026-10-11T00:00:00.000Z');
const hoursAfter = (hours: number) => new Date(T0.getTime() + hours * 60 * 60 * 1000);

// Matched: Henry Smith, Jack Payne, Noah Answerth, Aiden Riddle (4). Ambiguous: Sam Sturt has two
// active Fremantle players (1). Unmatched: Reece Torrent has no player, Zane Zakostelsky's player is
// inactive, Ollie Murphy's player is at another club (3).
const players = [
  { id: 'henry-smith', name: name('Henry Smith'), club: 'Brisbane' },
  { id: 'jack-payne', name: name('Jack Payne'), club: 'Brisbane Lions' },
  { id: 'noah-answerth', name: name('Noah Answerth'), club: 'Brisbane' },
  { id: 'zane-zakostelsky', name: name('Zane Zakostelsky'), club: 'Brisbane', active: false },
  { id: 'aiden-riddle', name: name('Aiden Riddle'), club: 'Fremantle' },
  { id: 'ollie-murphy', name: name('Ollie Murphy'), club: 'Hawthorn' },
  { id: 'sam-sturt-1', name: name('Sam Sturt'), club: 'Fremantle' },
  { id: 'sam-sturt-2', name: name('Sam Sturt'), club: 'Fremantle' },
].map((player) => ({ position: 'MID', ...player, id: `${PLAYER_ID_PREFIX}${player.id}` }));

const fixtureSnapshots = {
  entries: { some: { playerName: { startsWith: PREFIX } } },
};
const fixtureEntries = { playerName: { startsWith: PREFIX } };

async function removeFixtures() {
  // Entries cascade with their snapshot.
  await prisma.injuryListSnapshot.deleteMany({ where: fixtureSnapshots });
  await prisma.player.deleteMany({ where: { id: { startsWith: PLAYER_ID_PREFIX } } });
}

// A time no other file uses, so any snapshot a rejected run created or confirmed is this run's.
const REJECTED_AT = new Date('2026-10-11T03:17:29.000Z');

async function expectNothingWritten(fetchImpl: typeof fetch, reason: string) {
  const run = ingestFootywireInjuryList({ prisma, fetchImpl, now: REJECTED_AT });
  await expect(run).rejects.toBeInstanceOf(InjuryListIngestionRejected);
  await expect(run).rejects.toMatchObject({ reason });
  expect(
    await prisma.injuryListSnapshot.count({
      where: { OR: [fixtureSnapshots, { fetchedAt: REJECTED_AT }, { confirmedAt: REJECTED_AT }] },
    })
  ).toBe(0);
  expect(await prisma.injuryListEntry.count({ where: fixtureEntries })).toBe(0);
}

describe('ingestFootywireInjuryList', () => {
  beforeAll(async () => {
    await removeFixtures();
    await prisma.player.createMany({ data: players });
  });

  beforeEach(async () => {
    await prisma.injuryListSnapshot.deleteMany({ where: fixtureSnapshots });
  });

  afterAll(async () => {
    await removeFixtures();
  });

  it('creates a snapshot with every row, matched only on exact name and club', async () => {
    const result = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: T0,
    });

    const counts = { rows: 8, matched: 4, unmatched: 3, ambiguous: 1 };
    expect(result).toEqual({ outcome: 'created', snapshotId: expect.any(String), counts });

    const snapshot = await prisma.injuryListSnapshot.findUniqueOrThrow({
      where: { id: result.snapshotId },
      include: { entries: true },
    });
    expect(snapshot).toMatchObject({
      source: 'footywire',
      sourceUrl: 'https://www.footywire.com/afl/footy/injury_list',
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      fetchedAt: T0,
      confirmedAt: T0,
    });

    const byName = new Map(snapshot.entries.map((entry) => [entry.playerName, entry]));
    expect(byName.size).toBe(8);
    expect(byName.get(name('Jack Payne'))).toMatchObject({
      clubName: 'Brisbane Lions',
      sourceKey: 'pp-brisbane-lions--jack-payne',
      injuryRaw: 'Knee',
      returnRaw: 'Season',
      status: 'SEASON',
      playerId: `${PLAYER_ID_PREFIX}jack-payne`,
      matchStatus: 'MATCHED',
    });
    expect(byName.get(name('Noah Answerth'))).toMatchObject({
      status: 'TEST',
      playerId: `${PLAYER_ID_PREFIX}noah-answerth`,
      matchStatus: 'MATCHED',
    });
    expect(byName.get(name('Sam Sturt'))).toMatchObject({
      status: 'TBC',
      playerId: null,
      matchStatus: 'AMBIGUOUS',
    });
    for (const unmatched of ['Reece Torrent', 'Zane Zakostelsky', 'Ollie Murphy']) {
      expect(byName.get(name(unmatched))).toMatchObject({
        playerId: null,
        matchStatus: 'UNMATCHED',
      });
    }
  });

  it('confirms the latest snapshot when the same list is fetched again', async () => {
    const first = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: T0,
    });
    const second = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: hoursAfter(6),
    });

    expect(second).toEqual({ ...first, outcome: 'unchanged' });
    const snapshots = await prisma.injuryListSnapshot.findMany({
      where: fixtureSnapshots,
      include: { _count: { select: { entries: true } } },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      id: first.snapshotId,
      fetchedAt: T0,
      confirmedAt: hoursAfter(6),
      _count: { entries: 8 },
    });
  });

  it('re-confirms an older snapshot when the list reverts to it', async () => {
    const original = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: T0,
    });
    const changed = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(CHANGED_HTML),
      now: hoursAfter(6),
    });
    const reverted = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: hoursAfter(12),
    });

    expect(changed.outcome).toBe('created');
    expect(changed.snapshotId).not.toBe(original.snapshotId);
    expect(reverted).toEqual({ ...original, outcome: 'unchanged' });

    const latest = await prisma.injuryListSnapshot.findFirstOrThrow({
      where: { source: 'footywire', ...fixtureSnapshots },
      orderBy: { confirmedAt: 'desc' },
    });
    expect(latest).toMatchObject({ id: original.snapshotId, confirmedAt: hoursAfter(12) });
    expect(await prisma.injuryListSnapshot.count({ where: fixtureSnapshots })).toBe(2);
    expect(await prisma.injuryListEntry.count({ where: fixtureEntries })).toBe(16);
  });

  it('creates a new snapshot when a row links to a player imported since', async () => {
    const lateId = `${PLAYER_ID_PREFIX}reece-torrent`;
    const first = await ingestFootywireInjuryList({
      prisma,
      fetchImpl: serving(BASE_HTML),
      now: T0,
    });
    try {
      await prisma.player.create({
        data: { id: lateId, name: name('Reece Torrent'), club: 'Brisbane', position: 'MID' },
      });
      const second = await ingestFootywireInjuryList({
        prisma,
        fetchImpl: serving(BASE_HTML),
        now: hoursAfter(6),
      });

      expect(second).toEqual({
        outcome: 'created',
        snapshotId: expect.any(String),
        counts: { rows: 8, matched: 5, unmatched: 2, ambiguous: 1 },
      });
      expect(second.snapshotId).not.toBe(first.snapshotId);
      expect(await prisma.injuryListSnapshot.count({ where: fixtureSnapshots })).toBe(2);

      // The first snapshot is left as it was: append-only, never re-linked in place.
      const reeceIn = (snapshotId: string) =>
        prisma.injuryListEntry.findFirstOrThrow({
          where: { snapshotId, playerName: name('Reece Torrent') },
        });
      expect(await reeceIn(first.snapshotId)).toMatchObject({
        playerId: null,
        matchStatus: 'UNMATCHED',
      });
      const latest = await prisma.injuryListSnapshot.findFirstOrThrow({
        where: { source: 'footywire', ...fixtureSnapshots },
        orderBy: { confirmedAt: 'desc' },
      });
      expect(latest).toMatchObject({
        id: second.snapshotId,
        fetchedAt: hoursAfter(6),
        confirmedAt: hoursAfter(6),
      });
      expect(await reeceIn(second.snapshotId)).toMatchObject({
        playerId: lateId,
        matchStatus: 'MATCHED',
      });
    } finally {
      // Later cases expect the original roster. Entries linked to the player keep their rows.
      await prisma.player.deleteMany({ where: { id: lateId } });
    }
  });

  it('writes nothing when the fetch fails', async () => {
    await expectNothingWritten(failingFetch, 'fetch_failed');
  });

  it('writes nothing when the page has no club tables', async () => {
    await expectNothingWritten(serving(injuryListPage('Maintenance')), 'parse_failed');
  });

  it('writes nothing when every club table is empty', async () => {
    const emptyClubs = injuryListPage(
      clubTable('Brisbane Lions (0 Players)', []),
      clubTable('Fremantle (0 Players)', [])
    );
    await expectNothingWritten(serving(emptyClubs), 'parse_failed');
  });

  it('writes nothing when the list has more than 600 rows', async () => {
    await expectNothingWritten(serving(oversizedHtml(601)), 'too_many_rows');
  });
});
