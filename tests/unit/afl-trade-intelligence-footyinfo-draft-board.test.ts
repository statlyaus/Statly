import { describe, expect, it, vi } from 'vitest';

import {
  captureFootyinfoDraftBoard,
  FOOTYINFO_DRAFT_BOARD_PARSER_VERSION,
  parseFootyinfoDraftBoard,
  readFootyinfoSerializedLiteral,
} from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardAdapter';
import {
  footyinfoDraftBoardUrl,
  reviewedFootyinfoDraftBoardSeason,
} from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardSourceScope';
import { FOOTYINFO_DRAFT_BOARD_FIELDS } from '@/server/aflTradeIntelligence/development/localFootyinfoDraftBoardCapture';

import {
  footyinfoBoardPage,
  SYNTHETIC_BOARD_PICKS,
  type SyntheticBoardPick,
} from '../testUtils/footyinfoDraftBoardPage';

const digest = (character: string) => character.repeat(64);
const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.footyinfo.com/draft/2024',
  capturedAt: '2026-10-12T01:00:00.000Z',
  effectiveAt: '2026-10-12T01:00:00.000Z',
  parserVersion: FOOTYINFO_DRAFT_BOARD_PARSER_VERSION,
  fieldManifestSha256: digest('3'),
} as const;

function parse(html: string, draftYear = 2024) {
  return parseFootyinfoDraftBoard(html, { capture, draftYear });
}

function withPick(id: number, change: Partial<SyntheticBoardPick>) {
  return SYNTHETIC_BOARD_PICKS.map((pick) => (pick.id === id ? { ...pick, ...change } : pick));
}

function leafPaths(value: unknown, prefix: string): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => leafPaths(item, prefix));
  if (typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    key === 'kind' && !prefix.includes('.') ? [] : leafPaths(nested, `${prefix}.${key}`)
  );
}

describe('readFootyinfoSerializedLiteral', () => {
  it('reads slot-assigned literals and stops at the end of one value', () => {
    const text = 'x:$R[3]={a:!0,b:!1,"c d":[1,-2.5,null,void 0],e:"q\\"\\x3C\\u00e9"},rest';
    const { value, end } = readFootyinfoSerializedLiteral(text, 2);
    expect(value).toEqual({ a: true, b: false, 'c d': [1, -2.5, null, undefined], e: 'q"<é' });
    expect(text.slice(end)).toBe(',rest');
  });

  it('refuses back-references, code and duplicate keys rather than evaluating them', () => {
    expect(() => readFootyinfoSerializedLiteral('{a:$R[2]}', 0)).toThrow(/back-reference/);
    expect(() => readFootyinfoSerializedLiteral('{a:() => 1}', 0)).toThrow(/Unsupported value/);
    expect(() => readFootyinfoSerializedLiteral('{a:new Date(0)}', 0)).toThrow(/Unsupported/);
    expect(() => readFootyinfoSerializedLiteral('{a:1,a:2}', 0)).toThrow(/Duplicate key/);
  });
});

describe('parseFootyinfoDraftBoard', () => {
  it('emits every selected, passed and removed board pick with its stated route', () => {
    const { evidence, issues } = parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS));
    expect(issues).toEqual([]);
    const board = evidence.flatMap(({ content: { claim } }) =>
      claim.kind === 'draft_board_pick' ? [claim] : []
    );
    expect(
      board.map(({ status, recordedPickNumber, roundNumber, club, route, routeLabel, points }) => ({
        status,
        pick: recordedPickNumber,
        round: roundNumber,
        club: club.nativeId,
        route: route.map(({ nativeId }) => nativeId).join('>'),
        routeLabel,
        points,
      }))
    ).toEqual([
      {
        status: 'selected',
        pick: 1,
        round: 1,
        club: 'RCH',
        route: '',
        routeLabel: null,
        points: 3000,
      },
      {
        status: 'selected',
        pick: 5,
        round: 1,
        club: 'BRL',
        route: '',
        routeLabel: 'matched_bid',
        points: 1878,
      },
      {
        status: 'selected',
        pick: 10,
        round: 1,
        club: 'STK',
        route: '',
        routeLabel: 'compensation',
        points: 1395,
      },
      {
        status: 'selected',
        pick: 27,
        round: 1,
        club: 'NTH',
        route: 'NTH>GCS>RCH>NTH',
        routeLabel: 'special_assistance',
        points: 703,
      },
      // The board prints a leftover-points pick's label only, so no route is claimed.
      {
        status: 'selected',
        pick: 58,
        round: 4,
        club: 'RCH',
        route: '',
        routeLabel: 'leftover_points',
        points: 170,
      },
      {
        status: 'passed',
        pick: null,
        round: 4,
        club: 'CAR',
        route: 'FRE>STK>CAR',
        routeLabel: null,
        points: 49,
      },
      {
        status: 'removed',
        pick: null,
        round: 4,
        club: 'GCS',
        route: 'COL>HAW>ESS>RCH>GCS',
        routeLabel: null,
        points: null,
      },
      {
        status: 'passed',
        pick: null,
        round: null,
        club: 'GEE',
        route: '',
        routeLabel: null,
        points: null,
      },
    ]);
    expect(board[1]).toMatchObject({
      player: { nativeId: 'blake-oexample', recordedName: "Blake O'Example" },
      bid: { club: { nativeId: 'MEL', recordedName: 'Melbourne' }, basis: 'father_son' },
    });
    expect(board[6]!.note).toBe('Removed - not enough list spots');
    expect(board[7]!.note).toBe('Not used');
    expect(
      board.every(({ draftYear, draftType }) => draftYear === 2024 && draftType === 'national')
    ).toBe(true);
    expect(evidence.every(({ content }) => content.provider === 'footyinfo')).toBe(true);
  });

  it('also states each selection as a draft selection, a second source beside Draftguru', () => {
    const selections = parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS)).evidence.flatMap(
      ({ content: { claim } }) => (claim.kind === 'draft_selection' ? [claim] : [])
    );
    expect(
      selections.map(({ selectionNumber, selectedByClub, player }) => [
        selectionNumber,
        selectedByClub.nativeId,
        player.nativeId,
      ])
    ).toEqual([
      [1, 'RCH', 'avery-example'],
      [5, 'BRL', 'blake-oexample'],
      [10, 'STK', 'casey-example'],
      [27, 'NTH', 'drew-example'],
      [58, 'RCH', 'ellis-example'],
    ]);
  });

  it('emits exactly the reviewed field boundary', () => {
    const paths = new Set(
      parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS)).evidence.flatMap(({ content: { claim } }) =>
        leafPaths(claim, claim.kind)
      )
    );
    expect([...paths].sort()).toEqual([...FOOTYINFO_DRAFT_BOARD_FIELDS].sort());
  });

  it('refuses a selection whose table row differs from the board data', () => {
    const board = footyinfoBoardPage(SYNTHETIC_BOARD_PICKS);
    for (const page of [
      footyinfoBoardPage(withPick(4, { tableRoute: ['Special assistance', 'NTH → RCH → NTH'] })),
      board.replace('<td>703</td>', '<td>704</td>'),
      board.replace('<span>NTH</span>', '<span>RCH</span>'),
      board.replace('>Drew Example<', '>Drew Exampel<'),
      board.replace('<td>2023 assistance package (end of R1)</td>', '<td></td>'),
    ]) {
      expect(page).not.toBe(board);
      expect(parse(page)).toEqual({
        evidence: [],
        issues: [
          expect.objectContaining({
            code: 'invalid_page',
            detail: expect.stringMatching(/Selection 27/),
          }),
        ],
      });
    }
  });

  it('refuses a board whose table lists a selection the data does not', () => {
    const extra = footyinfoBoardPage(SYNTHETIC_BOARD_PICKS).replace(
      '</tbody></table>',
      '<tr><td>99</td><td>RCH</td><td>X</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>'
    );
    expect(parse(extra).issues[0]?.detail).toMatch(/same selections/);
  });

  it('refuses unreviewed statuses, origins, bid bases and broken routes', () => {
    const cases: Array<[Partial<SyntheticBoardPick> & { id?: never }, number, RegExp]> = [
      [{ status: 'forfeited' as never }, 6, /unreviewed status/],
      [{ origin: 'priority' as never }, 1, /unreviewed origin/],
      [{ bid: { club: 'MEL', reason: 'rookie_upgrade' } }, 2, /bid basis/],
      [
        {
          lineage: [
            ['trade', 'FRE', 'STK'],
            ['trade', 'HAW', 'CAR'],
          ],
        },
        6,
        /does not end with its holder/,
      ],
      [{ lineage: [['trade', 'FRE', 'STK']] }, 6, /does not end with its holder/],
      [{ number: 70 }, 6, /names a number or player/],
    ];
    for (const [change, id, detail] of cases) {
      const result = parse(footyinfoBoardPage(withPick(id, change)));
      expect(result.evidence).toEqual([]);
      expect(result.issues[0]?.detail).toMatch(detail);
    }
  });

  it('refuses another year’s or another draft’s board', () => {
    expect(
      parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS, { loaderYear: 2023 })).issues[0]?.detail
    ).toMatch(/not this year/);
    expect(
      parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS, { selectedKey: 'rookie_draft' })).issues[0]
        ?.detail
    ).toMatch(/reviewed shape/);
    expect(() => parse(footyinfoBoardPage(SYNTHETIC_BOARD_PICKS), 2023)).toThrow(/reviewed page/);
  });

  it('refuses a page without the single embedded board or with unreadable data', () => {
    expect(parse('<html><body><table></table></body></html>').issues[0]?.detail).toMatch(
      /router state/
    );
    const page = footyinfoBoardPage(SYNTHETIC_BOARD_PICKS);
    expect(
      parse(page.replace('number_settled:!0', 'number_settled:$R[1]')).issues[0]?.detail
    ).toMatch(/Unreadable board data/);
  });
});

describe('Footyinfo board scope and capture', () => {
  it('reviews exactly one board URL per draft year 2019 to 2025', () => {
    expect(
      [2018, 2019, 2025, 2026].map((year) =>
        reviewedFootyinfoDraftBoardSeason(footyinfoDraftBoardUrl(year))
      )
    ).toEqual([null, 2019, 2025, null]);
    for (const url of [
      'https://footyinfo.com/draft/2024',
      'https://www.footyinfo.com/draft/2024?hidePassed=0',
      'https://www.footyinfo.com/draft/2024/rookie',
      'http://www.footyinfo.com/draft/2024',
    ])
      expect(reviewedFootyinfoDraftBoardSeason(url)).toBeNull();
  });

  it('fetches without following redirects and refuses any status but 200 or 304', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    );
    const result = await captureFootyinfoDraftBoard({
      url: footyinfoDraftBoardUrl(2024),
      validators: null,
      maximumBytes: 1024,
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(result).toMatchObject({ status: 'captured', sourceUrl: footyinfoDraftBoardUrl(2024) });
    expect(fetchImpl).toHaveBeenCalledWith(
      footyinfoDraftBoardUrl(2024),
      expect.objectContaining({ redirect: 'error' })
    );
    for (const status of [403, 429, 503]) {
      await expect(
        captureFootyinfoDraftBoard({
          url: footyinfoDraftBoardUrl(2024),
          validators: null,
          maximumBytes: 1024,
          timeoutMs: 1000,
          fetchImpl: async () => new Response('challenge', { status }),
        })
      ).rejects.toThrow(String(status));
    }
    await expect(
      captureFootyinfoDraftBoard({
        url: 'https://www.footyinfo.com/draft/2018',
        validators: null,
        maximumBytes: 1024,
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow(/not a reviewed draft board/);
    await expect(
      captureFootyinfoDraftBoard({
        url: footyinfoDraftBoardUrl(2024),
        validators: null,
        maximumBytes: 4,
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow(/byte limit/);
  });
});
