import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2019_CLUB_REVIEW_URL =
  'https://www.afl.com.au/news/149305/who-smashed-it-our-say-on-your-clubs-draft-performance';

// The numbers belong to the receiving club heading, not the feeder club in parentheses.
const reviewedClubs = [
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
] as const;

export function parseOfficialAflDraft2019Sessions(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session', sourceKey: input.capture.sourceUrl, detail }],
  });
  if (input.capture.sourceUrl !== OFFICIAL_AFL_2019_CLUB_REVIEW_URL)
    return fail('The source is not the reviewed 2019 completed club summary.');
  const $ = load(html);
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const body = $('.article-body');
  const date = $('.article__date > time');
  if (body.length !== 1 || date.length !== 1 || date.attr('datetime') !== '2019-11-28T12:22:00Z')
    return fail('The reviewed 2019 article body or contextual date has changed.');
  const headings = body.children('h6');
  if (headings.length !== reviewedClubs.length || body.children('h2,h3,h4,h5').length)
    return fail('The reviewed club-section structure has changed.');
  const players = new Map<number, { name: string; club: string }>();
  const paragraphs = new Map<string, string[]>();
  for (const [index, heading] of headings.toArray().entries()) {
    const [club, expectedNumbers] = reviewedClubs[index]!;
    if (clean($(heading).text()) !== club || !$(heading).next().is('p'))
      return fail('A receiving-club heading or immediate selection paragraph has changed.');
    const section = $(heading).nextUntil('h6').filter('p');
    const texts = section.map((_, paragraph) => clean($(paragraph).text())).get();
    paragraphs.set(club, texts);
    if (texts.filter((value) => value.startsWith('Who they picked:')).length !== 1)
      return fail('A club selection paragraph is missing or ambiguous.');
    const text = clean($(heading).next().text());
    if (!text.startsWith('Who they picked: '))
      return fail('The immediate paragraph is not the completed selection list.');
    const entries = text.slice('Who they picked: '.length).split(', ');
    if (entries.length !== expectedNumbers.length)
      return fail('A reviewed club selection count has changed.');
    for (const [entryIndex, entry] of entries.entries()) {
      const match = /^([1-9]\d*)\. ([A-Za-z][A-Za-z '\u2019-]*[A-Za-z])(?: \([^(),]+\))?$/.exec(
        entry
      );
      if (!match || Number(match[1]) !== expectedNumbers[entryIndex])
        return fail('A completed selection is malformed or outside its reviewed club membership.');
      const number = Number(match[1]);
      if (players.has(number)) return fail('A completed selection number is duplicated.');
      players.set(number, { name: match[2]!, club });
    }
  }
  if (
    players.size !== 65 ||
    Array.from({ length: 65 }, (_, i) => i + 1).some((n) => !players.has(n))
  )
    return fail('The complete 2019 selection membership is missing.');
  for (const [number, name, club] of [
    [21, 'Thomson Dow', 'RICHMOND'],
    [22, 'Deven Robertson', 'BRISBANE'],
    [15, 'Cody Weightman', 'WESTERN BULLDOGS'],
  ] as const) {
    const player = players.get(number);
    if (player?.name !== name || player.club !== club)
      return fail('A player used to establish the session boundary or event day has changed.');
  }
  const scopedParagraph = (club: string, prefix: string): string | undefined => {
    const matches = paragraphs.get(club)!.filter((text) => text.startsWith(prefix));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const guards: Array<[string, string, RegExp[]]> = [
    [
      'RICHMOND',
      'Verdict:',
      [
        /secured that with Dow to end the draft's first round\./,
        /From there, it turned into a bidding fest on the second night\./,
      ],
    ],
    [
      'BRISBANE',
      'What the club says:',
      [/\(Deven Robertson's\)/, /that first selection on the second night\./],
    ],
    [
      'BRISBANE',
      'Verdict:',
      [
        /The Lions waited overnight to enter the draft/,
        /on the second night and grab Larke Medal winner Robertson\./,
      ],
    ],
    ['ST KILDA', 'Verdict:', [/the Saints got into the action on Thursday night/]],
    ['WESTERN BULLDOGS', 'What the club says:', [/getting Cody Weightman last night/]],
  ];
  for (const [club, prefix, patterns] of guards) {
    const text = scopedParagraph(club, prefix);
    if (!text || patterns.some((pattern) => !pattern.test(text)))
      return fail(
        'A scoped event-day, relative-night or completed-session boundary statement is missing.'
      );
  }
  // These exact dates are reviewed against the same completed Thursday article and
  // its event-day/last-night statements. Never generalize to publication-minus-one.
  return {
    evidence: [
      { ordinal: 1, date: '2019-11-27', first: 1, count: 21 },
      { ordinal: 2, date: '2019-11-28', first: 22, count: 44 },
    ].map((session) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: session.ordinal,
          sourceKey: `national-draft:2019:session:${session.ordinal}`,
        },
        claim: {
          kind: 'draft_session',
          draftYear: 2019,
          draftType: 'national',
          sessionOrdinal: session.ordinal,
          eventDate: session.date,
          officialName: '2019 NAB AFL Draft',
          selectionNumbers: Array.from({ length: session.count }, (_, i) => session.first + i),
        },
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
