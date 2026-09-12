import { describe, expect, it } from 'vitest';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';

const url =
  'https://www.afl.com.au/news/149305/who-smashed-it-our-say-on-your-clubs-draft-performance';
const capture = {
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl: url,
  capturedAt: '2026-09-11T00:00:00.000Z',
  effectiveAt: '2019-11-28T00:00:00.000Z',
  parserVersion: 'official-afl-completed-draft-session/v6',
  fieldManifestSha256: 'c'.repeat(64),
};
const clubs: Array<[string, number[]]> = [
  ['ADELAIDE', [6, 24, 28, 42, 48]],
  ['BRISBANE', [22, 33, 37, 59]],
  ['CARLTON', [17, 20, 47]],
  ['COLLINGWOOD', [40, 45, 55]],
  ['ESSENDON', [30, 38, 56, 63]],
  ['FREMANTLE', [7, 8, 9, 61]],
  ['GEELONG', [16, 19, 41, 50]],
  ['GOLD COAST', [1, 2, 11, 27, 60]],
  ['GREATER WESTERN SYDNEY', [4, 10, 51, 65]],
  ['HAWTHORN', [13, 29, 57]],
  ['MELBOURNE', [3, 12, 32]],
  ['NORTH MELBOURNE', [31, 34, 35]],
  ['PORT ADELAIDE', [14, 18, 23, 25]],
  ['RICHMOND', [21, 43, 44, 46, 54]],
  ['ST KILDA', [52, 64]],
  ['SYDNEY', [5, 26, 36, 39]],
  ['WEST COAST', [49, 58]],
  ['WESTERN BULLDOGS', [15, 53, 62]],
];
const names: Record<number, string> = {
  21: 'Thomson Dow',
  22: 'Deven Robertson',
  15: 'Cody Weightman',
};
const narratives: Record<string, string[]> = {
  RICHMOND: [
    "Verdict: The Tigers secured that with Dow to end the draft's first round. From there, it turned into a bidding fest on the second night.",
  ],
  BRISBANE: [
    "What the club says: (Deven Robertson's) selection was that first selection on the second night.",
    'Verdict: The Lions waited overnight to enter the draft on the second night and grab Larke Medal winner Robertson.',
  ],
  'ST KILDA': ['Verdict: After waiting, the Saints got into the action on Thursday night.'],
  'WESTERN BULLDOGS': ['What the club says: We were pleased getting Cody Weightman last night.'],
};
const section = ([club, numbers]: [string, number[]]) =>
  `<h6>${club}</h6><p>Who they picked: ${numbers.map((number) => `${number}. ${names[number] ?? 'Synthetic Player'}${[51, 65].includes(number) ? '' : ' (Feeder Club)'}`).join(', ')}</p>${(narratives[club] ?? []).map((text) => `<p>${text}</p>`).join('')}`;
const html = `<div class="article__date"><time datetime="2019-11-28T12:22:00Z"></time></div><div class="article-body">${clubs.map(section).join('')}</div>`;

describe('reviewed 2019 completed club summary', () => {
  it('binds two exact sessions to the same retained article and emits only session fields', () => {
    const result = parseOfficialAflDraftSession(html, { capture });
    expect(result.issues).toEqual([]);
    expect(result.evidence).toHaveLength(2);
    for (const [index, row] of result.evidence.entries()) {
      expect(row.content.capture).toEqual(capture);
      expect(row.content.sourceRow).toEqual({
        ordinal: index + 1,
        sourceKey: `national-draft:2019:session:${index + 1}`,
      });
      expect(row.content.claim).toEqual({
        kind: 'draft_session',
        draftYear: 2019,
        draftType: 'national',
        sessionOrdinal: index + 1,
        eventDate: index === 0 ? '2019-11-27' : '2019-11-28',
        officialName: '2019 NAB AFL Draft',
        selectionNumbers: Array.from(
          { length: index === 0 ? 21 : 44 },
          (_, i) => i + (index === 0 ? 1 : 22)
        ),
      });
      expect(row.content.publicationEligible).toBe(false);
    }
  });
  it('admits only the exact reviewed URL in its own season', () => {
    expect(isReviewedOfficialAflDraftSessionUrl(url, 2019)).toBe(true);
    expect(isReviewedOfficialAflDraftSessionUrl(url, 2020)).toBe(false);
    expect(isReviewedOfficialAflDraftSessionUrl(url + '?year=2019', 2019)).toBe(false);
    expect(
      parseOfficialAflDraftSession(html, { capture: { ...capture, sourceUrl: url + '/amp' } })
        .evidence
    ).toEqual([]);
  });
  it.each([
    ['changed date', html.replace('2019-11-28T12:22:00Z', '2019-11-29T12:22:00Z')],
    ['missing contextual date', html.replace('article__date', 'elsewhere')],
    [
      'duplicate date',
      html.replace('</time>', '</time><time datetime="2019-11-28T12:22:00Z"></time>'),
    ],
    ['duplicate body', html + '<div class="article-body"></div>'],
    ['unknown heading', html.replace('<h6>ADELAIDE', '<h6>UNKNOWN')],
    ['missing club', html.replace(section(clubs[0]!), '')],
    [
      'extra club',
      html.replace(
        '<h6>ADELAIDE',
        '<h6>UNKNOWN</h6><p>Who they picked: 66. Extra Player</p><h6>ADELAIDE'
      ),
    ],
    ['other direct heading', html.replace('<h6>ADELAIDE', '<h4>New layout</h4><h6>ADELAIDE')],
    [
      'displaced list',
      html.replace('<h6>ADELAIDE</h6>', '<h6>ADELAIDE</h6><p>Unreviewed intervening paragraph</p>'),
    ],
    [
      'duplicate list',
      html.replace('<h6>BRISBANE', '<p>Who they picked: 66. Synthetic Player</p><h6>BRISBANE'),
    ],
    [
      'receiving club reassignment',
      html
        .replace('6. Synthetic Player', '99. Synthetic Player')
        .replace('22. Deven Robertson', '6. Deven Robertson')
        .replace('99. Synthetic Player', '22. Synthetic Player'),
    ],
    ['missing pick', html.replace('6. Synthetic Player (Feeder Club), ', '')],
    ['duplicate pick', html.replace('24. Synthetic Player', '6. Synthetic Player')],
    ['out of range', html.replace('65. Synthetic Player', '66. Synthetic Player')],
    ['zero padded ordinal', html.replace('6. Synthetic Player', '06. Synthetic Player')],
    ['missing player', html.replace('6. Synthetic Player', '6. ')],
    [
      'malformed feeder',
      html.replace('6. Synthetic Player (Feeder Club)', '6. Synthetic Player (Feeder Club'),
    ],
    ['changed boundary player', html.replace('21. Thomson Dow', '21. Another Player')],
    ['changed opening player', html.replace('22. Deven Robertson', '22. Another Player')],
    ['changed relative-day player', html.replace('15. Cody Weightman', '15. Another Player')],
    [
      'first round unfinished',
      html.replace("end the draft's first round.", "start the draft's first round."),
    ],
    [
      'second night continuation missing',
      html.replace('From there, it turned into a bidding fest on the second night.', ''),
    ],
    [
      'opening quote changed',
      html.replace('that first selection on the second night.', 'a selection on another night.'),
    ],
    [
      'overnight missing',
      html.replace('The Lions waited overnight to enter the draft', 'The Lions entered the draft'),
    ],
    [
      'second-night selection missing',
      html.replace(
        'on the second night and grab Larke Medal winner Robertson.',
        'and grab a player.'
      ),
    ],
    ['weekday changed', html.replace('action on Thursday night', 'action on Friday night')],
    [
      'relative day changed',
      html.replace('getting Cody Weightman last night', 'getting Cody Weightman tonight'),
    ],
    [
      'duplicate scoped quote',
      html.replace('<h6>CARLTON', `<p>${narratives.BRISBANE![0]}</p><h6>CARLTON`),
    ],
    [
      'quote in wrong club',
      html
        .replace(`<p>${narratives['WESTERN BULLDOGS']![0]}</p>`, '')
        .replace(
          section(clubs[0]!),
          `${section(clubs[0]!)}<p>${narratives['WESTERN BULLDOGS']![0]}</p>`
        ),
    ],
  ])('rejects %s without partial session evidence', (_label, changed) => {
    const result = parseOfficialAflDraftSession(changed, { capture });
    expect(result.evidence).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('invalid_draft_session');
  });
});
