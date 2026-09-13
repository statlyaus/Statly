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
  parserVersion: 'test-event-year/v2',
  fieldManifestSha256: '3'.repeat(64),
};
const parse = (body = html, year = 2020, sourceUrl = capture.sourceUrl) =>
  parseDraftguruYearSelections(body, { draftYear: year, capture: { ...capture, sourceUrl } });

describe('Draftguru event year provenance', () => {
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
    const result = parseDraftguruNationalYearSelections(html, { capture, draftYear: 2020 });
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

  it.each([
    [2019, 'https://www.draftguru.com.au/years/2019'],
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
