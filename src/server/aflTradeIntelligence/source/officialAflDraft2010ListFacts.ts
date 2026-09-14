import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
const sources = {
  additions: {
    url: 'https://www.afl.com.au/news/114795/countdown-to-d-day',
    time: '2010-11-13T05:41:00Z',
    digest: '1fbc4f952a8448c31525e9ecdae6f3a360d4e64d284cd31e0957f1e46055a921',
  },
  slots: {
    url: 'https://www.afl.com.au/news/469544/round-by-round-selections',
    time: '2010-11-23T04:41:00Z',
    digest: '465a95efa7f5a0229579e53c88caa70c7748b3fcd26d14dee828f26f2cb22adc',
  },
};
const clubHeadings = [
  'ADELAIDE',
  'BRISBANE LIONS',
  'CARLTON',
  'COLLINGWOOD',
  'ESSENDON',
  'FREMANTLE',
  'GEELONG',
  'GOLD COAST',
  'HAWTHORN',
  'MELBOURNE',
  'NORTH MELBOURNE',
  'PORT ADELAIDE',
  'RICHMOND',
  'ST KILDA',
  'SYDNEY SWANS',
  'WEST COAST',
  'WESTERN BULLDOGS',
];
const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Retain original club labels. Downstream joining must bind label differences explicitly. */
export function parseOfficialAflDraft2010ListFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
) {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed2010 list classification source or body changed.',
      },
    ],
  });
  const found = Object.entries(sources).find(([, s]) => s.url === input.capture.sourceUrl);
  if (!found) return fail();
  const [key, source] = found,
    $ = load(html),
    body = $('.article-body'),
    dates = $('.article__date > time'),
    text = norm(body.text());
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== source.time ||
    createHash('sha256').update(text).digest('hex') !== source.digest
  )
    return fail();
  const common = { draftYear: 2010 as const, draftType: 'national' as const };
  let claim: AflTradeExternalEvidenceContent['claim'];
  if (key === 'additions') {
    const clubs: { recordedClub: string; recordedNames: string[] }[] = [];
    const headings = [
      ...text.matchAll(
        new RegExp(
          `(${[...clubHeadings].sort((a, b) => b.length - a.length).join('|')})NAB AFL Draft selections:`,
          'g'
        )
      ),
    ];
    if (
      headings.length !== clubHeadings.length ||
      headings.some((h, i) => h[1] !== clubHeadings[i])
    )
      return fail();
    for (let i = 0; i < clubHeadings.length; i++) {
      const heading = clubHeadings[i]!;
      const start = headings[i]!.index!;
      const end = headings[i + 1]?.index ?? text.length;
      const section = text.slice(start, end),
        matches = [...section.matchAll(/Additions: (.*?)(?=Approach:|$)/g)];
      if (matches.length !== 1) return fail();
      const names = [...matches[0]![1]!.matchAll(/(?:^|, )([^,()]+) \(rookie elevation\)/g)].map(
        (m) => m[1]!.trim()
      );
      if (names.length) clubs.push({ recordedClub: heading, recordedNames: names });
    }
    if (clubs.flatMap((c) => c.recordedNames).length !== 28) return fail();
    claim = { ...common, kind: 'draft_rookie_list_additions', clubs };
  } else {
    const rows = body
      .html()!
      .split(/<br\s*\/?\s*>/i)
      .map((fragment) => norm(load(fragment).text()))
      .filter((t) => /^\d+ /.test(t));
    if (
      rows.length !== 112 ||
      rows.some((row, index) => Number(row.match(/^\d+/)![0]) !== index + 1)
    )
      return fail();
    const groups = new Map<string, number[]>();
    for (const row of rows.filter((t) => t.includes('(PR)'))) {
      const match = row.match(/^(\d+) (.+?) \(PR\)/);
      if (!match) return fail();
      const club = match[2]!,
        number = Number(match[1]);
      groups.set(club, [...(groups.get(club) ?? []), number]);
    }
    if ([...groups.values()].flat().length !== 28) return fail();
    claim = {
      ...common,
      kind: 'draft_rookie_promotion_slots',
      clubs: [...groups].map(([recordedClub, selectionNumbers]) => ({
        recordedClub,
        selectionNumbers,
      })),
    };
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: 1, sourceKey: `2010-national-${key}` },
        claim,
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
