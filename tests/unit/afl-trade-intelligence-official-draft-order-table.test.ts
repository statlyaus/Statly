import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5,
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  officialAflDraftOrderTableParser,
  parseOfficialAflDraftOrderTable,
  parseOfficialAflDraftOrderTableV5,
} from '@/server/aflTradeIntelligence/source/draftCorroborationAdapter';

const digest = (character: string) => character.repeat(64);
const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.afl.com.au/news/867098/final-draft-order-check-out-your-clubs-picks',
  capturedAt: '2026-10-09T01:00:00.000Z',
  effectiveAt: '2022-11-19T00:00:00.000Z',
  parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  fieldManifestSha256: digest('3'),
} as const;
const observedAt = '2022-11-19T00:00:00.000Z';

// Synthetic pages in the two reviewed markups; no provider text is retained in the repository.
function tableForm(rounds: Array<[string, Array<[number, string]>]>, nextYear = 2023): string {
  const sections = rounds
    .map(
      ([round, rows]) =>
        `<table><tbody><tr><th colspan="2"><h4>${round}</h4></th></tr></tbody><tbody>${rows
          .map(([pick, club]) => `<tr><td width="5%">${pick}</td><td width="95%">${club}</td></tr>`)
          .join('')}</tbody></table>`
    )
    .join('');
  return `<html><body><h4>Final Draft Order as of November 19, 2022</h4>${sections}
    <h4>${nextYear} DRAFT SELECTIONS TRADED</h4>
    <table><tbody><tr><th>ROUND ONE</th><th>ROUND TWO</th></tr>
    <tr><td>1. 3000</td><td>19. 948</td></tr></tbody></table></body></html>`;
}

function claims(html: string, draftYear = 2022) {
  const result = parseOfficialAflDraftOrderTable(html, { capture, draftYear, observedAt });
  return {
    issues: result.issues,
    rows: result.evidence.map(({ content }) => {
      if (content.claim.kind !== 'pick_custody') throw new Error('Expected pick custody.');
      return {
        pick: content.claim.recordedPickNumber,
        round: content.claim.roundNumber,
        holder: content.claim.currentClub.recordedName,
        original: content.claim.originalClub?.recordedName ?? null,
      };
    }),
  };
}

describe('parseOfficialAflDraftOrderTable', () => {
  it('reads each slot’s round, holder and original club from the order annotations', () => {
    const { rows, issues } = claims(
      tableForm([
        [
          'ROUND ONE',
          [
            [1, 'Greater Western Sydney (<a>received from North Melbourne as part of a trade</a>)'],
            [2, 'North Melbourne'],
            [3, 'Sydney (tied to Melbourne)'],
          ],
        ],
        [
          'ROUND TWO',
          [
            [
              4,
              'Brisbane (received from Gold Coast as part of a trade, originally tied to Collingwood)',
            ],
            [5, 'Collingwood (received from Geelong, Geel received from Brisbane in a pick swap)'],
            [6, 'Carlton (Example Player compensation pick)'],
            [7, 'West Coast (received from Carlton, Carl received from Syd in a pick swap)'],
            [8, 'Essendon (received from GWS* as part of a trade)'],
            [9, 'Hawthorn (originally received from the Western Bulldogs in 2021)'],
          ],
        ],
      ])
    );
    expect(rows).toEqual([
      { pick: 1, round: 1, holder: 'Greater Western Sydney', original: 'North Melbourne' },
      { pick: 2, round: 1, holder: 'North Melbourne', original: 'North Melbourne' },
      { pick: 3, round: 1, holder: 'Sydney', original: 'Melbourne' },
      { pick: 4, round: 2, holder: 'Brisbane', original: 'Collingwood' },
      { pick: 5, round: 2, holder: 'Collingwood', original: 'Brisbane' },
      { pick: 6, round: 2, holder: 'Carlton', original: null },
      { pick: 7, round: 2, holder: 'West Coast', original: null },
      { pick: 8, round: 2, holder: 'Essendon', original: 'GWS' },
      { pick: 9, round: 2, holder: 'Hawthorn', original: 'Western Bulldogs' },
    ]);
    // A special pick's missing original club is a claim fact; only the unreadable note is an issue.
    expect(issues.map(({ code, sourceKey }) => [code, sourceKey])).toEqual([
      ['unsupported_order_annotation', '2022:national:7'],
    ]);
  });

  it('reads the 2019 numbered-cell form and ignores the draft value index table', () => {
    const html = `<html><body><h6>Final draft order</h6><table><thead><tr><th colspan="2">ROUND ONE</th></tr></thead>
      <tbody><tr><td><span class="flag">GCFC</span></td><td>1. Gold Coast (priority pick)</td></tr>
      <tr><td><span class="flag">MELB</span></td><td>2. Melbourne</td></tr>
      <tr><td><span class="flag">CARL</span></td><td>3. Carlton (originally received from Adelaide in 2018)</td></tr></tbody></table>
      <table><thead><tr><th colspan="2">2020 DRAFT SELECTIONS TRADED</th></tr></thead></table>
      <table><tbody><tr><th>ROUND ONE</th><th>ROUND TWO</th></tr><tr><td>1. 3000</td><td>19. 948</td></tr></tbody></table>
      </body></html>`;
    const { rows, issues } = claims(html, 2019);
    expect(rows).toEqual([
      { pick: 1, round: 1, holder: 'Gold Coast', original: null },
      { pick: 2, round: 1, holder: 'Melbourne', original: 'Melbourne' },
      { pick: 3, round: 1, holder: 'Carlton', original: 'Adelaide' },
    ]);
    expect(issues).toEqual([]);
  });

  it('records the parser version, provider and observation time on every claim', () => {
    const result = parseOfficialAflDraftOrderTable(
      tableForm([['ROUND ONE', [[1, 'West Coast']]]]),
      { capture, draftYear: 2022, observedAt }
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.content).toMatchObject({
      provider: 'official_afl',
      capture: { parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION },
      claim: { kind: 'pick_custody', observedAt, draftType: 'national' },
      publicationEligible: false,
    });
  });

  it('refuses a page that does not belong to the authorized draft year', () => {
    const { rows, issues } = claims(tableForm([['ROUND ONE', [[1, 'West Coast']]]], 2024));
    expect(rows).toEqual([]);
    expect(issues.map(({ code }) => code)).toEqual(['invalid_page']);
  });

  it('refuses an order with a gap in its slots', () => {
    const { rows, issues } = claims(
      tableForm([
        [
          'ROUND ONE',
          [
            [1, 'West Coast'],
            [3, 'Hawthorn'],
          ],
        ],
      ])
    );
    expect(rows).toEqual([]);
    expect(issues.map(({ code }) => code)).toEqual(['invalid_page']);
  });

  it('refuses the whole page when a slot holder is not a recorded club name', () => {
    const { rows, issues } = claims(
      tableForm([
        [
          'ROUND ONE',
          [
            [1, 'West Coast'],
            [2, 'Tasmania'],
          ],
        ],
      ])
    );
    expect(rows).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'invalid_order_row', sourceKey: '2022:national:2' }),
    ]);
  });
});

describe('parseOfficialAflDraftOrderTable on the 2025 live-page layout (parser v4)', () => {
  // Each club's slots as the 13 November 2025 snapshot lists them under "YOUR CLUB'S PICKS".
  const CLUB_PICKS: Array<[string, number[]]> = [
    ['Adelaide', [16, 48, 55, 64, 73, 75, 93, 111]],
    ['Brisbane', [17, 23, 44, 51, 59, 68, 79, 97, 115]],
    ['Carlton', [9, 11, 43, 54, 67, 72, 87, 105]],
    ['Collingwood', [39, 45, 56, 61, 77, 95, 113]],
    ['Essendon', [5, 6, 21, 27, 30, 83, 101]],
    ['Fremantle', [20, 47, 69, 90, 103, 108]],
    ['Geelong', [19, 40, 60, 78, 96, 99, 114]],
    ['Gold Coast', [15, 18, 24, 28, 29, 36, 52, 92, 110]],
    ['GWS', [12, 35, 91, 109]],
    ['Hawthorn', [10, 22, 62, 76, 94, 112]],
    ['Melbourne', [7, 8, 37, 66, 71, 84, 102]],
    ['North Melbourne', [25, 26, 46, 57, 82, 100]],
    ['Port Adelaide', [49, 85]],
    ['Richmond', [3, 4, 38, 81]],
    ['St Kilda', [50, 65, 86, 104]],
    ['Sydney', [31, 32, 42, 63, 88, 106]],
    ['West Coast', [1, 2, 13, 34, 41, 58, 80, 98]],
    ['Western Bulldogs', [14, 33, 53, 70, 74, 89, 107]],
  ];
  // The first slot of each round on that page.
  const ROUND_STARTS: Record<number, string> = {
    1: 'ONE',
    24: 'TWO',
    44: 'THREE',
    62: 'FOUR',
    80: 'FIVE',
    98: 'SIX',
  };
  // Synthetic notes in the page's grammar; every other slot is the holder's own pick.
  const NOTES: Record<number, string> = {
    2: 'Example Player compensation pick',
    4: 'tied to North Melbourne',
    7: 'received from Gold Coast in a trade, originally tied to Port Adelaide',
  };
  const observedAt2025 = '2025-11-07T00:00:00.000Z';
  const capture2025 = {
    ...capture,
    sourceUrl:
      'https://web.archive.org/web/20251113035435id_/https://www.afl.com.au/draft/draft-order',
    effectiveAt: observedAt2025,
  };

  // Synthetic HTML in the 2025 markup: round headings in a single `td`, GWS named in full in the
  // table, a "FUTURE SELECTIONS TRADED" block with IN/OUT per club.
  function page2025(
    options: {
      lists?: Array<[string, number[]]>;
      asOf?: string;
      traded?: string;
    } = {}
  ): string {
    const lists = options.lists ?? CLUB_PICKS;
    const holders = new Map(
      CLUB_PICKS.flatMap(([club, picks]) => picks.map((pick) => [pick, club]))
    );
    const rows = [...holders.keys()]
      .sort((left, right) => left - right)
      .map((pick) => {
        const club = holders.get(pick)!;
        const heading = ROUND_STARTS[pick]
          ? `<tr><td colspan="2"><strong>ROUND ${ROUND_STARTS[pick]}</strong></td></tr>`
          : '';
        const holder = club === 'GWS' ? 'Greater Western Sydney' : club;
        const note = NOTES[pick] ? ` (<a href="#">${NOTES[pick]}</a>)` : '';
        return `${heading}<tr><td>${pick}</td><td>${holder}${note}</td></tr>`;
      })
      .join('');
    return `<html><body><div class="article__body">
      <p>As at conclusion of pick swaps window on ${options.asOf ?? 'November 7'}.</p>
      <h4>YOUR CLUB'S PICKS</h4>
      <p>${lists.map(([club, picks]) => `<strong>${club}: </strong>${picks.join(', ')}`).join('<br />')}</p>
      <h4>2025 INDICATIVE DRAFT ORDER</h4>
      <table><tbody>${rows}</tbody></table>
      <h4>${options.traded ?? 'FUTURE SELECTIONS TRADED'}</h4>
      <table><tbody><tr><td>IN</td><td>OUT</td></tr>
      <tr><td>Adelaide</td><td>- 2026 fourth-round pick to NM</td></tr></tbody></table>
      </div></body></html>`;
  }

  function claims2025(html: string) {
    const result = parseOfficialAflDraftOrderTable(html, {
      capture: capture2025,
      draftYear: 2025,
      observedAt: observedAt2025,
    });
    return {
      issues: result.issues,
      claims: result.evidence.map(({ content }) => {
        if (content.claim.kind !== 'pick_custody') throw new Error('Expected pick custody.');
        return content.claim;
      }),
    };
  }

  it('reads all 115 slots with the stated rounds, holders and original clubs', () => {
    const { claims, issues } = claims2025(page2025());
    expect(issues).toEqual([]);
    expect(claims).toHaveLength(115);
    expect(claims.map(({ recordedPickNumber }) => recordedPickNumber)).toEqual(
      Array.from({ length: 115 }, (_value, index) => index + 1)
    );
    expect(claims.every(({ observedAt }) => observedAt === observedAt2025)).toBe(true);
    const at = (pick: number) => {
      const claim = claims[pick - 1]!;
      return [
        claim.roundNumber,
        claim.currentClub.recordedName,
        claim.originalClub?.recordedName ?? null,
      ];
    };
    expect(at(1)).toEqual([1, 'West Coast', 'West Coast']);
    expect(at(2)).toEqual([1, 'West Coast', null]);
    expect(at(4)).toEqual([1, 'Richmond', 'North Melbourne']);
    expect(at(7)).toEqual([1, 'Melbourne', 'Port Adelaide']);
    expect(at(12)).toEqual([1, 'Greater Western Sydney', 'Greater Western Sydney']);
    expect(at(23)).toEqual([1, 'Brisbane', 'Brisbane']);
    expect(at(24)).toEqual([2, 'Gold Coast', 'Gold Coast']);
    expect(at(98)).toEqual([6, 'West Coast', 'West Coast']);
    expect(at(115)).toEqual([6, 'Brisbane', 'Brisbane']);
  });

  it('accepts the page without its stated as-of line', () => {
    const html = page2025().replace(/<p>As at conclusion[^<]*<\/p>/, '');
    expect(claims2025(html).claims).toHaveLength(115);
  });

  const moved: Array<[string, number[]]> = CLUB_PICKS.map(([club, picks]) =>
    club === 'Adelaide'
      ? [club, [...picks, 17]]
      : club === 'Brisbane'
        ? [club, picks.filter((pick) => pick !== 17)]
        : [club, picks]
  );
  it.each([
    ['a club list that disagrees with the table holder', { lists: moved }],
    [
      'a slot listed for two clubs',
      {
        lists: CLUB_PICKS.map(([club, picks]): [string, number[]] =>
          club === 'Adelaide' ? [club, [...picks, 17]] : [club, picks]
        ),
      },
    ],
    ['a slot missing from the club lists', { lists: CLUB_PICKS.slice(0, 17) }],
    [
      'a list line that names no recorded club',
      {
        lists: [...CLUB_PICKS.slice(1), ['Tasmania', [16, 48, 55, 64, 73, 75, 93, 111]]] as Array<
          [string, number[]]
        >,
      },
    ],
    ['a stated as-of date other than the observation date', { asOf: 'November 13' }],
    ['a stated as-of date in an unknown month', { asOf: 'Novembr 7' }],
    ['a traded block for another year', { traded: '2025 DRAFT SELECTIONS TRADED' }],
    ['no traded block', { traded: 'DRAFT VALUE INDEX' }],
  ])('refuses the whole page for %s', (_label, options) => {
    const { claims, issues } = claims2025(page2025(options));
    expect(claims).toEqual([]);
    expect(issues.map(({ code }) => code)).toEqual(['invalid_page']);
  });

  it('still reads the v3 form with a "<next year> DRAFT SELECTIONS TRADED" block', () => {
    const html = page2025({ traded: '2026 DRAFT SELECTIONS TRADED' });
    expect(claims2025(html).claims).toHaveLength(115);
  });
});

describe('parseOfficialAflDraftOrderTableV5 on the 2026 live-page layout (issue 789)', () => {
  // Each club's slots as the 14 October 2026 snapshot lists them under "EVERY CLUB'S PICKS".
  const CLUB_PICKS: Array<[string, number[]]> = [
    ['Adelaide', [15, 34, 35, 43, 56, 92]],
    ['Brisbane', [25, 28, 79, 97]],
    ['Carlton', [13, 18, 31, 50, 61, 72, 90]],
    ['Collingwood', [11, 30, 67, 68, 70, 88]],
    ['Essendon', [1, 17, 21, 27, 80]],
    ['Fremantle', [19, 40, 60, 63, 78, 96]],
    ['Geelong', [36, 57, 62, 75, 93]],
    ['Gold Coast', [8, 81, 85]],
    ['Greater Western Sydney', [9, 20, 26, 59, 77, 86]],
    ['Hawthorn', [29, 37, 71, 94]],
    ['Melbourne', [4, 14, 48, 52]],
    ['North Melbourne', [33, 49, 66, 74, 84]],
    ['Port Adelaide', [7, 12, 22, 24, 32, 46, 65]],
    ['Richmond', [2, 5, 44]],
    ['St Kilda', [10, 16, 41, 51, 69, 87]],
    ['Sydney', [6, 38, 39, 47, 54, 76, 95]],
    ['West Coast', [3, 23, 45, 58, 64, 73, 82]],
    ['Western Bulldogs', [42, 53, 55, 83, 89, 91]],
  ];
  // The first slot of each of the page's five rounds.
  const ROUNDS: Array<[number, string]> = [
    [1, 'ONE'],
    [21, 'TWO'],
    [43, 'THREE'],
    [62, 'FOUR'],
    [80, 'FIVE'],
  ];
  // Synthetic notes in the page's grammar; every other slot is the holder's own pick.
  const NOTES: Record<number, string> = {
    4: 'received from Port Adelaide in a trade',
    5: 'received from Port Adelaide in pick swap, PA received as Example Player compensation',
    7: 'received from Melbourne in a trade, tied to Gold Coast',
    8: 'Example Player compensation',
  };
  const observedAt2026 = '2026-10-14T00:00:00.000Z';
  const capture2026 = {
    ...capture,
    sourceUrl:
      'https://web.archive.org/web/20261014083707id_/https://www.afl.com.au/draft/draft-order',
    capturedAt: '2026-10-14T09:00:00.000Z',
    effectiveAt: observedAt2026,
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5,
  };

  // Synthetic HTML in the 2026 markup: each round heading is an `h4` just before its own table, the
  // club lists are headed "EVERY CLUB'S PICKS", the page states only "Updated: <date>", and no
  // "INDICATIVE DRAFT ORDER" heading appears.
  function page2026(
    options: {
      lists?: Array<[string, number[]]>;
      updated?: string | null;
      between?: string;
      listTitle?: string;
    } = {}
  ): string {
    const lists = options.lists ?? CLUB_PICKS;
    const holders = new Map(
      CLUB_PICKS.flatMap(([club, picks]) => picks.map((pick) => [pick, club]))
    );
    const rounds = ROUNDS.map(([start, name], index) => {
      const end = ROUNDS[index + 1]?.[0] ?? 98;
      const rows = Array.from({ length: end - start }, (_value, offset) => start + offset)
        .map((pick) => {
          const note = NOTES[pick] ? ` (<a href="#">${NOTES[pick]}</a>)` : '';
          return `<tr><td>${pick}</td><td>${holders.get(pick)}${note}</td></tr>`;
        })
        .join('');
      return `<h4>ROUND ${name}</h4>${options.between ?? ''}<table><tbody>${rows}</tbody></table>`;
    }).join('');
    const updated =
      options.updated === null ? '' : `<p>Updated: ${options.updated ?? 'October 14, 2026'}</p>`;
    return `<html><body><div class="article__body">${updated}
      <h4>${options.listTitle ?? "EVERY CLUB'S PICKS"}</h4>
      <p>${lists.map(([club, picks]) => `<strong>${club}: </strong>${picks.join(', ')}`).join('<br>')}</p>
      ${rounds}
      <h4>FUTURE SELECTIONS TRADED</h4>
      <table><tbody><tr><td></td><td>IN</td><td>OUT</td></tr>
      <tr><td>Brisbane</td><td>- 2027 first-round pick from StK</td><td></td></tr></tbody></table>
      <h4>2026 Draft Value Index</h4>
      <table><tbody><tr><th>Round One</th><th>Round Two</th><th>Round Three</th></tr>
      <tr><th>Pick/Pts</th><th>Pick/Pts</th><th>Pick/Pts</th></tr>
      <tr><td>1. 3000</td><td>19. 796</td><td>37. 297</td></tr></tbody></table>
      </div></body></html>`;
  }

  function claims2026(html: string, parse = parseOfficialAflDraftOrderTableV5) {
    const result = parse(html, {
      capture: capture2026,
      draftYear: 2026,
      observedAt: observedAt2026,
    });
    return {
      issues: result.issues,
      claims: result.evidence.map(({ content }) => {
        if (content.claim.kind !== 'pick_custody') throw new Error('Expected pick custody.');
        return content.claim;
      }),
    };
  }

  it('reads all 97 slots in five rounds with the holders and original clubs', () => {
    const { claims, issues } = claims2026(page2026());
    expect(issues).toEqual([]);
    expect(claims.map(({ recordedPickNumber }) => recordedPickNumber)).toEqual(
      Array.from({ length: 97 }, (_value, index) => index + 1)
    );
    const perRound = new Map<number, number>();
    claims.forEach(({ roundNumber }) =>
      perRound.set(roundNumber!, (perRound.get(roundNumber!) ?? 0) + 1)
    );
    expect([...perRound]).toEqual([
      [1, 20],
      [2, 22],
      [3, 19],
      [4, 18],
      [5, 18],
    ]);
    expect(claims.every(({ observedAt }) => observedAt === observedAt2026)).toBe(true);
    const at = (pick: number) => {
      const claim = claims[pick - 1]!;
      return [
        claim.roundNumber,
        claim.currentClub.recordedName,
        claim.originalClub?.recordedName ?? null,
      ];
    };
    expect(at(1)).toEqual([1, 'Essendon', 'Essendon']);
    expect(at(4)).toEqual([1, 'Melbourne', 'Port Adelaide']);
    // A compensation pick swapped on keeps no original club, like every special pick.
    expect(at(5)).toEqual([1, 'Richmond', null]);
    expect(at(7)).toEqual([1, 'Port Adelaide', 'Gold Coast']);
    expect(at(8)).toEqual([1, 'Gold Coast', null]);
    expect(at(9)).toEqual([1, 'Greater Western Sydney', 'Greater Western Sydney']);
    expect(at(21)).toEqual([2, 'Essendon', 'Essendon']);
    expect(at(43)).toEqual([3, 'Adelaide', 'Adelaide']);
    expect(at(62)).toEqual([4, 'Geelong', 'Geelong']);
    expect(at(97)).toEqual([5, 'Brisbane', 'Brisbane']);
  });

  it('is the parser a v5 capture names, and v4 reads nothing from the 2026 layout', () => {
    expect(officialAflDraftOrderTableParser(OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5)).toBe(
      parseOfficialAflDraftOrderTableV5
    );
    expect(officialAflDraftOrderTableParser(OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION)).toBe(
      parseOfficialAflDraftOrderTable
    );
    const { claims, issues } = claims2026(page2026(), parseOfficialAflDraftOrderTable);
    expect(claims).toEqual([]);
    expect(issues.map(({ code }) => code)).toEqual(['invalid_page']);
  });

  const moved: Array<[string, number[]]> = CLUB_PICKS.map(([club, picks]) =>
    club === 'Adelaide'
      ? [club, [...picks, 25]]
      : club === 'Brisbane'
        ? [club, picks.filter((pick) => pick !== 25)]
        : [club, picks]
  );
  it.each([
    ['no stated date', { updated: null }],
    ['an updated date other than the observation date', { updated: 'October 15, 2026' }],
    ['an updated date in an unknown month', { updated: 'Octobr 14, 2026' }],
    ['a club list that disagrees with the table holder', { lists: moved }],
    ['round headings that are not just before their tables', { between: '<p>Note.</p>' }],
  ])('refuses the whole page for %s', (_label, options) => {
    const { claims, issues } = claims2026(page2026(options));
    expect(claims).toEqual([]);
    expect(issues.map(({ code }) => code)).toEqual(['invalid_page']);
  });

  it('still reads the 2025 "YOUR CLUB\'S PICKS" heading', () => {
    expect(claims2026(page2026({ listTitle: "YOUR CLUB'S PICKS" })).claims).toHaveLength(97);
  });
});
