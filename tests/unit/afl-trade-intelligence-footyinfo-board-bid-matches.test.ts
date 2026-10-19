import { describe, expect, it } from 'vitest';

import {
  FOOTYINFO_DRAFT_BOARD_PARSER_VERSION,
  FOOTYINFO_DRAFT_BOARD_V1_PARSER_VERSION,
  FOOTYINFO_DRAFT_BOARD_V2_PARSER_VERSION,
  parseFootyinfoDraftBoard,
} from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardAdapter';

import { FOOTYINFO_2021_MATCHED_BIDS } from '../testUtils/footyinfo2021MatchedBids';
import {
  footyinfoBoardPage,
  SYNTHETIC_BOARD_PICKS,
  type SyntheticBoardPick,
} from '../testUtils/footyinfoDraftBoardPage';

const digest = (character: string) => character.repeat(64);

function parse(
  picks: readonly SyntheticBoardPick[],
  { year = 2021, parserVersion = FOOTYINFO_DRAFT_BOARD_PARSER_VERSION } = {}
) {
  return parseFootyinfoDraftBoard(footyinfoBoardPage(picks, { year }), {
    draftYear: year,
    capture: {
      captureId: `source-capture:${digest('1')}`,
      artifactId: `artifact:${digest('2')}`,
      contentSha256: digest('2'),
      mediaType: 'text/html; charset=utf-8',
      sourceUrl: `https://www.footyinfo.com/draft/${year}`,
      capturedAt: '2026-10-12T01:00:00.000Z',
      effectiveAt: '2026-10-12T01:00:00.000Z',
      parserVersion,
      fieldManifestSha256: digest('3'),
    },
  });
}

function bidMatches(result: ReturnType<typeof parse>) {
  return result.evidence.flatMap(({ content: { claim, sourceRow } }) =>
    claim.kind === 'draft_board_bid_match' ? [{ claim, sourceRow }] : []
  );
}

function edit(
  picks: readonly SyntheticBoardPick[],
  id: number,
  change: (pick: SyntheticBoardPick) => SyntheticBoardPick
) {
  return picks.map((pick) => (pick.id === id ? change(pick) : pick));
}

function refusal(picks: readonly SyntheticBoardPick[]) {
  const result = parse(picks);
  expect(result.evidence).toEqual([]);
  expect(result.issues).toHaveLength(1);
  return result.issues[0]!.detail;
}

describe('Footyinfo board matched-bid points (parser v2, issue 789)', () => {
  it('states Sam Darcy’s 2021 father-son match with every pick the Bulldogs spent on it', () => {
    const result = parse(FOOTYINFO_2021_MATCHED_BIDS);
    expect(result.issues).toEqual([]);
    const [darcy, daicos] = bidMatches(result);
    expect(darcy).toEqual({
      sourceRow: { ordinal: 7, sourceKey: '2021:national:pick:5733:bid_match' },
      claim: {
        kind: 'draft_board_bid_match',
        draftYear: 2021,
        draftType: 'national',
        nativePickId: '5733',
        selectionNumber: 2,
        roundNumber: 1,
        club: { nativeId: 'WBD', recordedName: 'Western Bulldogs' },
        player: { nativeId: 'sam-darcy', recordedName: 'Sam Darcy' },
        bid: { club: { nativeId: 'GWS', recordedName: 'GWS' }, basis: 'father_son' },
        points: 2517,
        pointsUsed: 1889,
        consumedPicks: [
          {
            nativePickId: '7449',
            label: 'R2 (GEE) - Pick 34',
            originalNumber: 34,
            originalClubCode: 'GEE',
            holdingClubCode: 'WBD',
            pointsUsed: 542,
          },
          {
            nativePickId: '6042',
            label: 'R3 (GCS) - Pick 42',
            originalNumber: 42,
            originalClubCode: 'GCS',
            holdingClubCode: 'WBD',
            pointsUsed: 395,
          },
          {
            nativePickId: '6057',
            label: 'R3 (ADE) - Pick 43',
            originalNumber: 43,
            originalClubCode: 'ADE',
            holdingClubCode: 'WBD',
            pointsUsed: 378,
          },
          {
            nativePickId: '7451',
            label: 'R3 (ADE) - Pick 44',
            originalNumber: 44,
            originalClubCode: 'ADE',
            holdingClubCode: 'WBD',
            pointsUsed: 362,
          },
          {
            nativePickId: '5727',
            label: 'R3 (HAW) - Pick 45',
            originalNumber: 45,
            originalClubCode: 'HAW',
            holdingClubCode: 'WBD',
            pointsUsed: 347,
          },
        ],
        leftoverPicks: [{ nativePickId: '5792', holdingClubCode: 'WBD', points: 135 }],
      },
    });
    // The spent picks cover 2,024 points: the 1,889 used plus the 135 of the leftover pick.
    const spent = darcy!.claim.consumedPicks.map(({ pointsUsed }) => pointsUsed);
    expect(spent.reduce((total, points) => total + points, 0)).toBe(1889 + 135);
    expect(darcy!.claim.consumedPicks[0]).toMatchObject({
      originalClubCode: 'GEE',
      pointsUsed: 542,
    });

    expect(daicos!.claim).toMatchObject({
      nativePickId: '5735',
      selectionNumber: 4,
      club: { nativeId: 'COL' },
      player: { nativeId: 'nick-daicos' },
      bid: { club: { nativeId: 'GCS' }, basis: 'father_son' },
      points: 2034,
      pointsUsed: 1651,
      leftoverPicks: [],
    });
    expect(daicos!.claim.consumedPicks.map(({ label, pointsUsed }) => [label, pointsUsed])).toEqual(
      [
        ['R2 (RCH) - Pick 38', 465],
        ['R3 (NTH) - Pick 40', 429],
        ['R3 (CAR) - Pick 46', 395],
        ['R3 (FRE) - Pick 48', 362],
      ]
    );
  });

  it('emits v1’s rows unchanged and adds the matched bids after them; a v1 capture replays exactly', () => {
    const v1 = parse(SYNTHETIC_BOARD_PICKS, {
      year: 2024,
      parserVersion: FOOTYINFO_DRAFT_BOARD_V1_PARSER_VERSION,
    });
    const v2 = parse(SYNTHETIC_BOARD_PICKS, {
      year: 2024,
      parserVersion: FOOTYINFO_DRAFT_BOARD_V2_PARSER_VERSION,
    });
    expect(bidMatches(v1)).toEqual([]);
    const rows = (result: typeof v1) =>
      result.evidence.map(({ content: { sourceRow, claim } }) => ({ sourceRow, claim }));
    expect(rows(v2).slice(0, v1.evidence.length)).toEqual(rows(v1));
    expect(rows(v2).slice(v1.evidence.length)).toEqual(bidMatches(v2));
    expect(bidMatches(v2).map(({ claim }) => [claim.nativePickId, claim.consumedPicks])).toEqual([
      [
        '2',
        [
          {
            nativePickId: '9',
            label: 'R2 (ESS) - Pick 23',
            originalNumber: 23,
            originalClubCode: 'ESS',
            holdingClubCode: 'BRL',
            pointsUsed: 563,
          },
        ],
      ],
    ]);
  });

  it('states a match paid with no pick the club held as no spent picks and no points used', () => {
    const deficit = FOOTYINFO_2021_MATCHED_BIDS.filter(
      ({ purchasedFrom }) => purchasedFrom !== 5735
    ).map((pick) =>
      pick.id === 5735 ? { ...pick, pointsUsed: undefined, spent: undefined } : pick
    );
    const [, daicos] = bidMatches(parse(deficit));
    expect(daicos!.claim).toMatchObject({ pointsUsed: null, consumedPicks: [] });
  });

  it('refuses a spent pick the board does not record as spent on that bid, with those points', () => {
    const spentPick = (change: Partial<SyntheticBoardPick>) =>
      edit(FOOTYINFO_2021_MATCHED_BIDS, 7449, (pick) => ({ ...pick, ...change }));
    for (const picks of [
      spentPick({ pointsUsed: 541 }),
      spentPick({ purchasedFrom: 5735 }),
      spentPick({ originalClub: 'GWS' }),
      spentPick({ originalNumber: 33 }),
      spentPick({ round: 3 }),
      FOOTYINFO_2021_MATCHED_BIDS.filter(({ id }) => id !== 7449),
    ]) {
      expect(refusal(picks)).toMatch(/Matched bid 5733 lists spent pick 7449/);
    }
  });

  it('refuses a bid that uses more points than its spent picks hold, or misstates them', () => {
    const darcy = (change: Partial<SyntheticBoardPick>) =>
      edit(FOOTYINFO_2021_MATCHED_BIDS, 5733, (pick) => ({ ...pick, ...change }));
    expect(refusal(darcy({ pointsUsed: 2025 }))).toMatch(/used more points than its spent picks/);
    expect(refusal(darcy({ pointsUsed: undefined }))).toMatch(/points used without spent picks/);
    expect(refusal(darcy({ spent: [] }))).toMatch(/points used without spent picks/);
    expect(refusal(darcy({ pointsUsed: -1 }))).toMatch(/bid points do not have the reviewed shape/);
    expect(refusal(darcy({ pointsUsed: 1889.5 }))).toMatch(/reviewed shape/);
    const label = edit(FOOTYINFO_2021_MATCHED_BIDS, 5733, (pick) => ({
      ...pick,
      spent: pick.spent!.map((spent) =>
        spent.id === 7449 ? { ...spent, label: 'R2 (GEE) - Pick 35' } : spent
      ),
    }));
    expect(refusal(label)).toMatch(/lists spent pick 7449/);
  });

  it('refuses a points-used pick no matched bid lists, or one a bid lists twice or another bid lists', () => {
    const unlisted = edit(FOOTYINFO_2021_MATCHED_BIDS, 5733, (pick) => ({
      ...pick,
      spent: pick.spent!.filter(({ id }) => id !== 5727),
      pointsUsed: 1677 - 135,
    }));
    expect(refusal(unlisted)).toMatch(/Board pick 5727 used points for no matched bid/);
    const twice = edit(FOOTYINFO_2021_MATCHED_BIDS, 5735, (pick) => ({
      ...pick,
      spent: [...pick.spent!, FOOTYINFO_2021_MATCHED_BIDS[0]!.spent![0]!],
    }));
    // Another bid's pick is not recorded as spent on Daicos.
    expect(refusal(twice)).toMatch(
      /Matched bid 5735 lists spent pick 7449, which the board does not/
    );
    const repeated = edit(FOOTYINFO_2021_MATCHED_BIDS, 5733, (pick) => ({
      ...pick,
      spent: [...pick.spent!, pick.spent![0]!],
    }));
    expect(refusal(repeated)).toMatch(/Matched bid 5733 lists spent pick 7449 twice/);
  });

  it('refuses a spent pick held by a club other than the one that matched', () => {
    const held = edit(FOOTYINFO_2021_MATCHED_BIDS, 7449, (pick) => ({ ...pick, club: 'GEE' }));
    expect(refusal(held)).toMatch(
      /Matched bid 5733 lists spent pick 7449, which the board does not/
    );
  });

  it('refuses a capture that names an unreviewed parser version rather than reading it as v1', () => {
    expect(() =>
      parse(FOOTYINFO_2021_MATCHED_BIDS, { parserVersion: 'footyinfo-draft-board-parser/v4' })
    ).toThrow(/no reviewed parser version/);
  });

  it('refuses a leftover pick that does not carry exactly the excess, or names no matched bid', () => {
    const cleary = (change: Partial<SyntheticBoardPick>) =>
      edit(FOOTYINFO_2021_MATCHED_BIDS, 5792, (pick) => ({ ...pick, ...change }));
    expect(refusal(cleary({ points: 134 }))).toMatch(
      /Matched bid 5733 has spent points its leftover pick does not account for/
    );
    expect(refusal(cleary({ leftoverOf: 5735 }))).toMatch(/Matched bid 5733 has spent points/);
    expect(refusal(cleary({ leftoverOf: undefined }))).toMatch(
      /Leftover-points pick 5792 does not name the one matched bid/
    );
    expect(refusal(FOOTYINFO_2021_MATCHED_BIDS.filter(({ id }) => id !== 5792))).toMatch(
      /Matched bid 5733 has spent points/
    );
  });

  it('refuses points used on a selection the board does not call a matched bid', () => {
    const unbid = edit(FOOTYINFO_2021_MATCHED_BIDS, 5735, (pick) => ({
      ...pick,
      origin: 'standard',
      bid: undefined,
    }));
    expect(refusal(unbid)).toMatch(/Board pick 5735 states points used without a matched bid/);
  });
});
