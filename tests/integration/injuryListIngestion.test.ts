/**
 * The Footywire injury list as append-only Prisma snapshots: a new list creates one snapshot with
 * its entries, a repeat only confirms it, and a rejected run writes nothing. Footywire is never
 * contacted; fetchImpl serves the trimmed live fixture and variants built from it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  ingestFootywireInjuryList,
  InjuryListIngestionRejected,
} from '@/server/injuries/injuryListIngestion';

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
  const rows = Array.from(
    { length: rowCount },
    (_, index) =>
      `<tr class="darkcolor"><td><a href="/afl/footy/pp-brisbane-lions--${PREFIX.toLowerCase()}-${index}">${PREFIX} Row ${index}</a></td><td>Knee</td><td>Season</td></tr>`
  ).join('\n');
  return `<table><tr><td class="tbtitle">Brisbane Lions (${rowCount} Players)</td></tr><tr><td><table>${rows}</table></td></tr></table>`;
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

async function removeFixtures() {
  // Entries cascade with their snapshot.
  await prisma.injuryListSnapshot.deleteMany({ where: fixtureSnapshots });
  await prisma.player.deleteMany({ where: { id: { startsWith: PLAYER_ID_PREFIX } } });
}

async function expectNothingWritten(fetchImpl: typeof fetch, reason: string) {
  const snapshotsBefore = await prisma.injuryListSnapshot.count();
  const entriesBefore = await prisma.injuryListEntry.count();
  const run = ingestFootywireInjuryList({ prisma, fetchImpl, now: T0 });
  await expect(run).rejects.toBeInstanceOf(InjuryListIngestionRejected);
  await expect(run).rejects.toMatchObject({ reason });
  expect(await prisma.injuryListSnapshot.count()).toBe(snapshotsBefore);
  expect(await prisma.injuryListEntry.count()).toBe(entriesBefore);
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

    const counts = { rowCount: 8, matchedCount: 4, unmatchedCount: 3, ambiguousCount: 1 };
    expect(result).toEqual({ outcome: 'created', snapshotId: expect.any(String), counts });

    const snapshot = await prisma.injuryListSnapshot.findUniqueOrThrow({
      where: { id: result.snapshotId },
      include: { entries: true },
    });
    expect(snapshot).toMatchObject({
      source: 'footywire',
      sourceUrl: 'https://www.footywire.com/afl/footy/injury_list',
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      aflSeason: T0.getFullYear(),
      fetchedAt: T0,
      confirmedAt: T0,
      ...counts,
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

    expect(second).toEqual({ ...first, outcome: 'unchanged', relinked: 0 });
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
    expect(reverted).toEqual({ ...original, outcome: 'unchanged', relinked: 0 });

    const latest = await prisma.injuryListSnapshot.findFirstOrThrow({
      where: { source: 'footywire', ...fixtureSnapshots },
      orderBy: { confirmedAt: 'desc' },
    });
    expect(latest).toMatchObject({ id: original.snapshotId, confirmedAt: hoursAfter(12) });
    expect(await prisma.injuryListSnapshot.count({ where: fixtureSnapshots })).toBe(2);
    expect(
      await prisma.injuryListEntry.count({ where: { playerName: { startsWith: PREFIX } } })
    ).toBe(16);
  });

  it('re-links a row to a player imported after the snapshot was created', async () => {
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

      const counts = { rowCount: 8, matchedCount: 5, unmatchedCount: 2, ambiguousCount: 1 };
      expect(second).toEqual({
        outcome: 'unchanged',
        snapshotId: first.snapshotId,
        counts,
        relinked: 1,
      });
      const snapshots = await prisma.injuryListSnapshot.findMany({ where: fixtureSnapshots });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({ ...counts, fetchedAt: T0, confirmedAt: hoursAfter(6) });
      expect(
        await prisma.injuryListEntry.findFirstOrThrow({
          where: { snapshotId: first.snapshotId, playerName: name('Reece Torrent') },
        })
      ).toMatchObject({ playerId: lateId, matchStatus: 'MATCHED' });
    } finally {
      // Later cases expect the original roster.
      await prisma.player.deleteMany({ where: { id: lateId } });
    }
  });

  it('writes nothing when the fetch fails', async () => {
    await expectNothingWritten(failingFetch, 'fetch_failed');
  });

  it('writes nothing when the page has no club tables', async () => {
    await expectNothingWritten(serving('<html><body>Maintenance</body></html>'), 'parse_failed');
  });

  it('writes nothing when every club table is empty', async () => {
    const emptyClubs = ['Brisbane Lions', 'Fremantle']
      .map(
        (club) =>
          `<table><tr><td class="tbtitle">${club} (0 Players)</td></tr><tr><td><table></table></td></tr></table>`
      )
      .join('');
    await expectNothingWritten(serving(`<html><body>${emptyClubs}</body></html>`), 'parse_failed');
  });

  it('writes nothing when the list has more than 600 rows', async () => {
    await expectNothingWritten(serving(oversizedHtml(601)), 'too_many_rows');
  });
});
