import { describe, expect, it } from 'vitest';
import { parseDraftguruYearSelections } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
const capture = {
  captureId: `source-capture:${'1'.repeat(64)}`,
  artifactId: `artifact:${'2'.repeat(64)}`,
  contentSha256: '2'.repeat(64),
  mediaType: 'text/html',
  sourceUrl: 'https://www.draftguru.com.au/years/2011',
  capturedAt: '2026-09-13T00:00:00.000Z',
  effectiveAt: '2026-09-13T00:00:00.000Z',
  parserVersion: 'test',
  fieldManifestSha256: '3'.repeat(64),
};
const row = (label: string, number = '1') =>
  `<tr><td class="draft">${label}</td><td class="number">${number}</td><td class="club">Gold Coast</td><td class="player"><a href="/players/example/1">Example</a></td></tr>`;
const table = (rows: string) => `<table class="big-pick-movements"><tbody>${rows}</tbody></table>`;
const parse = (html: string) => parseDraftguruYearSelections(html, { capture, draftYear: 2011 });
describe('mixed year-page conservation', () => {
  it('retains all selection pathways and accounts for reviewed non-selection rows', () => {
    const selections = ['National', 'Mini-Draft', 'Rookie', 'Pre-Season', 'Mid-Season'];
    const excluded = [
      'Trade',
      'Free Agency',
      'Pre-Draft',
      'Post-Draft',
      'Training Squad Selection',
    ];
    const result = parse(table([...selections, ...excluded].map((label) => row(label)).join('')));
    expect(result.issues).toEqual([]);
    expect(
      result.evidence.map(
        (e) => e.content.claim.kind === 'draft_selection' && e.content.claim.draftType
      )
    ).toEqual(['national', 'mini_draft', 'rookie', 'pre_season', 'mid_season']);
    expect(result.scopeSummary).toEqual({
      observedRows: 10,
      includedRows: 5,
      invalidRows: 0,
      excludedByPathway: Object.fromEntries(excluded.map((label) => [label, 1])),
    });
  });
  it('uses category only for non-selection rows with an empty draft cell', () => {
    const categoryRow = (draft: string, category: string) =>
      `<tr><td class="category">${category}</td><td class="draft">${draft}</td><td class="number">1</td><td class="club">Gold Coast</td><td class="player">Example</td></tr>`;
    const result = parse(
      table(
        row('Mini-Draft') +
          categoryRow('', 'Trade') +
          categoryRow('Unknown', 'Trade') +
          categoryRow('', 'National')
      )
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(result.scopeSummary).toEqual({
      observedRows: 4,
      includedRows: 1,
      invalidRows: 2,
      excludedByPathway: { Trade: 1 },
    });
  });
  it.each(['1x', '1.5', '1e2', '0', '-1', '', '9007199254740992'])(
    'rejects malformed selection %s',
    (number) => {
      const result = parse(table(row('National', number)));
      expect(result.evidence).toEqual([]);
      expect(result.scopeSummary.invalidRows).toBe(1);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  );
  it.each(['Unknown', 'constructor', ''])('keeps unknown pathway %s as an error', (label) => {
    const result = parse(table(row('Mini-Draft') + row(label)));
    expect(result.evidence).toHaveLength(1);
    expect(result.scopeSummary.invalidRows).toBe(1);
    expect(result.issues).toHaveLength(1);
  });
  it('rejects absent, duplicate and selection-free tables', () => {
    for (const html of ['', table(row('National')) + table(row('National')), table(row('Trade'))]) {
      expect(parse(html).evidence).toEqual([]);
      expect(parse(html).issues.length).toBeGreaterThan(0);
    }
  });
});
