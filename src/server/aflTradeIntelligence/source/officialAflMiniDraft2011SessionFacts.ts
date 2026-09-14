import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_MINI_2011_SOURCES = {
  membership: {
    url: 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
    time: '2012-10-08T01:41:12Z',
    digest: 'a95218761ed831d518e311afacd63e31510aa616cdfa3405f1ad5a277a918e32',
  },
  total: {
    url: 'https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine',
    time: '2012-11-18T06:23:58Z',
    digest: '20280372ac6fc97f94f8f49245182e44f92af71d34f609b5bac351f70b477270',
  },
  completed: {
    url: 'https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final',
    time: '2011-10-17T02:02:00Z',
    digest: 'e0b2999e4295e31289f9197dba9edcccbd4760b52853a4cabfc5f143436e41ca',
  },
} as const;
const sourceFor = (url: string) =>
  Object.entries(OFFICIAL_AFL_MINI_2011_SOURCES).find(([, value]) => value.url === url);
export function reviewedOfficialAflMiniDraft2011EffectiveYear(url: string): number | null {
  const source = sourceFor(url);
  return source ? Number(source[1].time.slice(0, 4)) : null;
}

/** Retrospective article years remain source years; emitted selections belong to2011. */
export function parseOfficialAflMiniDraft2011SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
) {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed2011 mini-draft source, context or statements changed.',
      },
    ],
  });
  const source = sourceFor(input.capture.sourceUrl);
  if (!source) return fail();
  const [key, expected] = source;
  const $ = load(html),
    body = $('.article-body'),
    dates = $('.article__date > time');
  const text = body.text().replace(/\s+/g, ' ').trim();
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== expected.time ||
    createHash('sha256').update(text).digest('hex') !== expected.digest
  )
    return fail();
  const common = { draftYear: 2011, draftType: 'mini_draft' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (key === 'membership') {
    if (
      !text.includes("right to select O'Meara with the first pick") ||
      !text.includes('Crouch became a Crow with the second mini-draft selection') ||
      !text.includes('2011 NAB AFL Draft')
    )
      return fail();
    const members = [
      { recordedName: "Jaeger O'Meara", selectionNumber: 1 },
      { recordedName: 'Brad Crouch', selectionNumber: 2 },
    ];
    claims = [
      { ...common, kind: 'draft_completed_membership_roster', members },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: "Jaeger O'Meara" },
        selectedByClub: { nativeId: null, recordedName: 'Gold Coast SUNS' },
      },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 2,
        player: { nativeId: null, recordedName: 'Brad Crouch' },
        selectedByClub: { nativeId: null, recordedName: 'Adelaide' },
      },
    ];
  } else if (key === 'total') {
    // The report explicitly says only two were selected last year.
    // Its2012 publication therefore identifies the2011 event.
    if (
      !text.includes(
        "O'Meara and Adelaide's Brad Crouch were the only two players selected in last year's 17-year-old mini-draft"
      )
    )
      return fail();
    claims = [{ ...common, kind: 'draft_completed_total', selectionCount: 2 }];
  } else {
    if (
      !text.includes(
        'mini-draft’ at Etihad Stadium on Monday afternoon to officially unveil prized recruit Brad Crouch'
      )
    )
      return fail();
    claims = [
      { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2011-10-17' },
      { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
    ];
  }
  return {
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: index + 1, sourceKey: `mini-draft:2011:${claim.kind}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
