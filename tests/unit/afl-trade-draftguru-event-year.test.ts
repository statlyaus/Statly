import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  parseDraftguruNationalYearSelections,
  parseDraftguruYearSelections,
} from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';

// Reduced retained table: no grades, statistics or outcomes. The page year is deliberately 2020.
const html = readFileSync('tests/fixtures/draftguru-year-2020.html', 'utf8');
const capture = {
  captureId: `source-capture:${'1'.repeat(64)}`,
  artifactId: `artifact:${'2'.repeat(64)}`,
  contentSha256: '2'.repeat(64),
  mediaType: 'text/html',
  sourceUrl: 'https://www.draftguru.com.au/years/2020',
  capturedAt: '2026-09-12T20:58:21.066Z',
  effectiveAt: '2026-09-12T20:58:21.065Z',
  parserVersion: 'draftguru-event-year/v2',
  fieldManifestSha256: '3'.repeat(64),
};
const parse = (body = html, year = 2020, sourceUrl = capture.sourceUrl) =>
  parseDraftguruYearSelections(body, { draftYear: year, capture: { ...capture, sourceUrl } });

describe('Draftguru event year provenance', () => {
  it('preserves ordinary annual mid-season page years outside the reviewed anomaly', () => {
    const result = parse(html, 2019, 'https://www.draftguru.com.au/years/2019');
    expect(result.issues).toEqual([]);
    const rows = result.evidence.filter(
      (row) =>
        row.content.claim.kind === 'draft_selection' && row.content.claim.draftType === 'mid_season'
    );
    expect(rows).toHaveLength(22);
    expect(
      rows.every((row) => 'draftYear' in row.content.claim && row.content.claim.draftYear === 2019)
    ).toBe(true);
  });

  it('rejects old general-year parser identities instead of reusing them for changed semantics', () => {
    expect(() =>
      parseDraftguruYearSelections(html, {
        draftYear: 2020,
        capture: { ...capture, parserVersion: 'draftguru-year-parser/v1' },
      })
    ).toThrow(/parser version/i);
  });

  it('corrects the reviewed 22 mid-season selections while preserving the 75 other claims', () => {
    const result = parse();
    expect(result.issues).toEqual([]);
    expect(result.evidence).toHaveLength(97);
    const midseason = result.evidence.filter(
      (row) =>
        row.content.claim.kind === 'draft_selection' && row.content.claim.draftType === 'mid_season'
    );
    expect(midseason).toHaveLength(22);
    expect(midseason.map((row) => row.content.claim)).toEqual(
      Array.from({ length: 22 }, (_, index) =>
        expect.objectContaining({ draftYear: 2021, selectionNumber: index + 1 })
      )
    );
    expect(
      midseason.every((row) => row.content.sourceRow.sourceKey.startsWith('2021:mid_season:'))
    ).toBe(true);
    const others = result.evidence.filter((row) => !midseason.includes(row));
    expect(others).toHaveLength(75);
    expect(
      others.every(
        (row) => 'draftYear' in row.content.claim && row.content.claim.draftYear === 2020
      )
    ).toBe(true);
    // The source's name is retained; this does not approve the official report's Williams/Will alias.
    expect(midseason[10]?.content.claim).toMatchObject({
      player: { recordedName: 'Will Collins' },
    });
  });

  it('preserves national-only delegation and its 59 complete evidence records', () => {
    const result = parseDraftguruNationalYearSelections(html, {
      capture: { ...capture, parserVersion: 'draftguru-national-year-page/v1' },
      draftYear: 2020,
    });
    expect(result.issues).toEqual([]);
    expect(result.evidence).toHaveLength(59);
    expect(result.evidence.map((row) => row.content.claim)).toEqual(
      parse()
        .evidence.filter(
          (row) =>
            row.content.claim.kind === 'draft_selection' &&
            row.content.claim.draftType === 'national'
        )
        .map((row) => row.content.claim)
    );
  });

  describe('national-year parser v2 access categories', () => {
    const parseNational = (body = html, parserVersion = 'draftguru-national-year-page/v2') =>
      parseDraftguruNationalYearSelections(body, {
        capture: { ...capture, parserVersion },
        draftYear: 2020,
      });
    const categories = (result: ReturnType<typeof parseNational>) =>
      result.evidence.map(({ content }) =>
        content.claim.kind === 'draft_selection' ? content.claim.accessCategory : 'not-a-selection'
      );

    it('records each national selection as open, academy or father-son', () => {
      const result = parseNational();
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      const counts = categories(result).reduce<Record<string, number>>(
        (total, value) => ({ ...total, [String(value)]: (total[String(value)] ?? 0) + 1 }),
        {}
      );
      expect(counts).toEqual({ open: 48, academy: 10, father_son: 1 });
    });

    it('keeps v1 claims exactly as recorded, with no access category', () => {
      expect(categories(parseNational(html, 'draftguru-national-year-page/v1'))).toEqual(
        Array.from({ length: 59 }, () => undefined)
      );
    });

    it.each(['Academy Scholarship', 'Academy (Northern)', 'Father-Son', 'Father-Son Unknown'])(
      'quarantines the near-miss category %s instead of reading it as a nomination',
      (label) => {
        const body = html.replace(
          /<td class="category">\s*Academy\s*</,
          `<td class="category">${label}<`
        );
        expect(body).not.toBe(html);
        expect(parseNational(body).issues).toContainEqual(
          expect.objectContaining({
            code: 'unsupported_row',
            detail: expect.stringContaining(label),
          })
        );
      }
    );

    it('quarantines an unreviewed category instead of guessing', () => {
      const body = html.replace(
        /<td class="category">\s*Academy/,
        '<td class="category">Rookie Elevation'
      );
      const result = parseNational(body);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_row',
          detail: expect.stringContaining('Rookie Elevation'),
        })
      );
    });

    it('reads access only under parser v2, so other callers keep their own field boundary', () => {
      const result = parseNational(html, 'official-afl-completed-draft-session/v1');
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(categories(result).every((category) => category === undefined)).toBe(true);
    });
  });

  describe('national-year parser v3 club-qualified academy forms', () => {
    const V3 = 'draftguru-national-year-page/v3';
    const parseNational = (body = html, parserVersion = V3) =>
      parseDraftguruNationalYearSelections(body, {
        capture: { ...capture, parserVersion },
        draftYear: 2020,
      });
    // Pick 1 is Jamarra Ugle-Hagan, selected by the Western Bulldogs.
    const firstAcademyCell = /<td class="category">Academy \(NG\)\n<\/td>/;
    const withPickOneCell = (label: string) => {
      const body = html.replace(firstAcademyCell, `<td class="category">${label}</td>`);
      expect(body).not.toBe(html);
      return body;
    };
    const pickOne = (result: ReturnType<typeof parseNational>) =>
      result.evidence.find(
        ({ content }) =>
          content.claim.kind === 'draft_selection' && content.claim.selectionNumber === 1
      )?.content.claim;

    it('emits exactly the v2 claims on a page with only the plain forms', () => {
      const v2 = parseNational(html, 'draftguru-national-year-page/v2');
      const v3 = parseNational();
      expect(v3.issues).toEqual([]);
      expect(v3.evidence.map(({ content }) => content.claim)).toEqual(
        v2.evidence.map(({ content }) => content.claim)
      );
    });

    it.each([
      ['Academy(Western Bulldogs)', 'academy'],
      ['Academy (NG)(Western Bulldogs)', 'academy'],
      ['Academy(Brisbane - Not Matched)', 'open'],
      ['Academy (NG)(St Kilda - Not Matched)', 'open'],
    ])('reads %s on a Western Bulldogs selection as %s', (label, expected) => {
      const result = parseNational(withPickOneCell(label));
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      expect(pickOne(result)).toMatchObject({ accessCategory: expected });
    });

    it.each([
      // Another club's academy, matched: the selecting club cannot have matched it.
      'Academy(Brisbane)',
      'Academy (NG)(St Kilda)',
      // The selecting club declining its own academy bid is contradictory.
      'Academy(Western Bulldogs - Not Matched)',
      'Academy(Brisbane - Matched)',
      'Academy()',
      'Academy(western bulldogs)',
      'Academy (NG) (Western Bulldogs)',
    ])('quarantines %s on a Western Bulldogs selection', (label) => {
      expect(parseNational(withPickOneCell(label)).issues).toContainEqual(
        expect.objectContaining({ code: 'unsupported_row', detail: expect.stringContaining(label) })
      );
    });

    it('keeps v2 refusing the club-qualified forms', () => {
      expect(
        parseNational(
          withPickOneCell('Academy(Western Bulldogs)'),
          'draftguru-national-year-page/v2'
        ).issues
      ).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_row',
          detail: expect.stringContaining('Academy(Western Bulldogs)'),
        })
      );
    });
  });

  describe('national-year parser v4 legacy forms (2011 to 2016 pages)', () => {
    const V4 = 'draftguru-national-year-page/v4';
    // The reduced 2020 table read as a 2016 page: v4 is reviewed for page years 2011 to 2016 only.
    const parseNational = (body = html, parserVersion = V4, draftYear = 2016) =>
      parseDraftguruNationalYearSelections(body, {
        capture: {
          ...capture,
          sourceUrl: `https://www.draftguru.com.au/years/${draftYear}`,
          parserVersion,
        },
        draftYear,
      });
    // Pick 1 is Jamarra Ugle-Hagan, selected by the Western Bulldogs.
    const firstAcademyCell = /<td class="category">Academy \(NG\)\n<\/td>/;
    const withPickOneCell = (label: string) => {
      const body = html.replace(firstAcademyCell, `<td class="category">${label}</td>`);
      expect(body).not.toBe(html);
      return body;
    };
    const pickOne = (result: ReturnType<typeof parseNational>) =>
      result.evidence.find(
        ({ content }) =>
          content.claim.kind === 'draft_selection' && content.claim.selectionNumber === 1
      )?.content.claim;
    // A Gold Coast mini-draft row as the 2011 and 2012 pages list it.
    const withMiniDraftRow = () => {
      const $ = load(html);
      const national = $('tbody tr')
        .filter((_i, tr) => $(tr).find('td.draft').text().trim() === 'National')
        .first();
      const mini = national.clone();
      mini.find('td.draft').text('Mini-Draft');
      mini.find('td.category').eq(1).text('');
      national.before(mini);
      return $.html();
    };

    it('emits exactly the v3 claims on a page with only the v3 forms', () => {
      const v3 = parseNational(html, 'draftguru-national-year-page/v3');
      const v4 = parseNational();
      expect(v4.issues).toEqual([]);
      expect(v4.evidence.map(({ content }) => content.claim)).toEqual(
        v3.evidence.map(({ content }) => content.claim)
      );
    });

    it.each([
      // A zone selection by the zone club (Gold Coast, GWS and Brisbane, 2011 to 2013).
      ['Zone(Western Bulldogs)', 'academy'],
      // Another club's academy player taken with an ordinary pick, unannotated on these pages.
      ['Academy(Brisbane)', 'open'],
      ['Academy (NG)(St Kilda)', 'open'],
      // The v3 forms keep their reading.
      ['Academy(Western Bulldogs)', 'academy'],
      ['Academy(Gold Coast - Not Matched)', 'open'],
      ['Father-Son(Chris Waterman)', 'father_son'],
    ])('reads %s on a Western Bulldogs selection as %s', (label, expected) => {
      const result = parseNational(withPickOneCell(label));
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      expect(pickOne(result)).toMatchObject({ accessCategory: expected, draftYear: 2016 });
    });

    it.each([
      // A zone naming another club is not a reviewed form.
      'Zone(Brisbane)',
      'Zone()',
      'Zone(western bulldogs)',
      'Zone (Western Bulldogs)',
      // The selecting club declining its own academy bid stays contradictory.
      'Academy(Western Bulldogs - Not Matched)',
      'Academy(Brisbane - Matched)',
    ])('quarantines %s on a Western Bulldogs selection', (label) => {
      expect(parseNational(withPickOneCell(label)).issues).toContainEqual(
        expect.objectContaining({ code: 'unsupported_row', detail: expect.stringContaining(label) })
      );
    });

    it('counts and drops mini-draft rows instead of reading them as national picks', () => {
      const result = parseNational(withMiniDraftRow());
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      expect(result.scopeSummary.excludedByPathway).toMatchObject({ 'Mini-Draft': 1 });
    });

    it('keeps v3 refusing the legacy forms and the mini-draft label', () => {
      const v3 = 'draftguru-national-year-page/v3';
      for (const label of ['Zone(Western Bulldogs)', 'Academy(Brisbane)']) {
        expect(parseNational(withPickOneCell(label), v3).issues).toContainEqual(
          expect.objectContaining({ code: 'unsupported_row' })
        );
      }
      const mini = parseNational(withMiniDraftRow(), v3);
      expect(mini.evidence).toEqual([]);
      expect(mini.issues).toContainEqual(
        expect.objectContaining({ detail: 'Unreviewed pathway label in national-only capture.' })
      );
    });

    it.each([2010, 2017, 2020])('refuses a %s page under v4', (year) => {
      const result = parseNational(html, V4, year);
      expect(result.evidence).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_row',
          detail: expect.stringContaining('2011 to 2016 pages only'),
        })
      );
    });
  });

  describe('national-year parser v5 early forms (2000 to 2010 pages)', () => {
    const V5 = 'draftguru-national-year-page/v5';
    // The reduced 2020 table read as a 2008 page: v5 is reviewed for page years 2000 to 2010 only.
    const parseNational = (body = html, parserVersion = V5, draftYear = 2008) =>
      parseDraftguruNationalYearSelections(body, {
        capture: {
          ...capture,
          sourceUrl: `https://www.draftguru.com.au/years/${draftYear}`,
          parserVersion,
        },
        draftYear,
      });
    const selection = (result: ReturnType<typeof parseNational>, number: number) =>
      result.evidence.find(
        ({ content }) =>
          content.claim.kind === 'draft_selection' && content.claim.selectionNumber === number
      )?.content.claim;
    // Sets the category cell of national pick `number`; pick 1 is the Western Bulldogs', 4 Sydney's.
    const withCategory = (number: number, label: string) => {
      const $ = load(html);
      const row = $('tbody tr').filter(
        (_i, tr) =>
          $(tr).find('td.draft').text().trim() === 'National' &&
          $(tr).find('td.number').text().trim() === String(number)
      );
      expect(row).toHaveLength(1);
      row.find('td.category').eq(1).text(label);
      return $.html();
    };
    // A training-squad row as the 2010 page lists it.
    const withTrainingSquadRow = () => {
      const $ = load(html);
      const national = $('tbody tr')
        .filter((_i, tr) => $(tr).find('td.draft').text().trim() === 'National')
        .first();
      const squad = national.clone();
      squad.find('td.draft').text('Training Squad Selection');
      squad.find('td.category').eq(1).text('');
      national.before(squad);
      return $.html();
    };

    it('emits exactly the v3 claims on a page with only the v3 forms', () => {
      const v3 = parseNational(html, 'draftguru-national-year-page/v3');
      const v5 = parseNational();
      expect(v5.issues).toEqual([]);
      expect(v5.evidence.map(({ content }) => content.claim)).toEqual(
        v3.evidence.map(({ content }) => content.claim)
      );
    });

    it.each([
      // A NSW scholarship player Sydney took.
      [4, 'Scholarship(NSW)', 'academy'],
      // A NSW scholarship player another club took with an ordinary pick.
      [1, 'Scholarship(NSW)', 'open'],
      [1, 'Father-Son(Chris Waterman)', 'father_son'],
    ])('reads pick %s marked %s as %s', (number, label, expected) => {
      const result = parseNational(withCategory(number, label));
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      expect(selection(result, number)).toMatchObject({
        accessCategory: expected,
        draftYear: 2008,
      });
    });

    it.each(['Scholarship(VIC)', 'Scholarship', 'Scholarship (NSW)', 'Zone(Western Bulldogs)'])(
      'quarantines %s',
      (label) => {
        expect(parseNational(withCategory(1, label)).issues).toContainEqual(
          expect.objectContaining({ code: 'unsupported_row' })
        );
      }
    );

    it('counts and drops a training-squad row', () => {
      const result = parseNational(withTrainingSquadRow());
      expect(result.issues).toEqual([]);
      expect(result.evidence).toHaveLength(59);
      expect(result.scopeSummary.excludedByPathway).toMatchObject({
        'Training Squad Selection': 1,
      });
    });

    it('keeps v3 and v4 refusing the scholarship form and the training-squad label', () => {
      for (const [version, year] of [
        ['draftguru-national-year-page/v3', 2008],
        ['draftguru-national-year-page/v4', 2011],
      ] as const) {
        expect(
          parseNational(withCategory(1, 'Scholarship(NSW)'), version, year).issues
        ).toContainEqual(expect.objectContaining({ code: 'unsupported_row' }));
        expect(parseNational(withTrainingSquadRow(), version, year).issues).toContainEqual(
          expect.objectContaining({ detail: 'Unreviewed pathway label in national-only capture.' })
        );
      }
    });

    it.each([1999, 2011, 2020])('refuses a %s page under v5', (year) => {
      const result = parseNational(html, V5, year);
      expect(result.evidence).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_row',
          detail: expect.stringContaining('2000 to 2010 pages only'),
        })
      );
    });
  });

  it.each([
    [2020, 'https://example.com/years/2020'],
    [2020, 'https://www.draftguru.com.au/years/2021'],
  ])('does not generalize the reviewed mapping to year %s and URL %s', (year, url) => {
    const result = parse(html, year, url);
    expect(
      result.evidence.filter(
        (row) =>
          row.content.claim.kind === 'draft_selection' &&
          row.content.claim.draftType === 'mid_season'
      )
    ).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each(['player', 'club', 'number'])(
    'rejects a changed %s binding instead of guessing its event year',
    (field) => {
      const $ = load(html);
      const row = $('tbody tr')
        .filter((_i, tr) => $(tr).find('td.draft').text().trim() === 'Mid-Season')
        .first();
      if (field === 'number') row.find('td.number').text('99');
      else
        row
          .find(`td.${field} a`)
          .attr('href', `/${field === 'player' ? 'players' : 'clubs'}/unreviewed`);
      const result = parse($.html());
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.scopeSummary.invalidRows).toBeGreaterThan(0);
      expect(
        result.evidence.filter(
          (item) =>
            item.content.claim.kind === 'draft_selection' &&
            item.content.claim.draftType === 'mid_season'
        )
      ).toHaveLength(21);
    }
  );
});
