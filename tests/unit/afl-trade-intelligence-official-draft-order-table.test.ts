import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  parseOfficialAflDraftOrderTable,
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
