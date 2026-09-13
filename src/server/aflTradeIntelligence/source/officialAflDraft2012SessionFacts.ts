import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2012_SESSION_URLS = {
  membership: 'https://www.afl.com.au/news/87166/the-class-of-2012-draft-report-card',
  event:
    'https://www.afl.com.au/news/453360/2012-nab-afl-draft-sees-94-players-welcomed-to-afl-lists-selections-attached',
  classifications:
    'https://www.afl.com.au/news/38163/afl-club-list-lodgement-one-wednesday-october-31',
} as const;
const reviewed = {
  membership: {
    time: '2014-01-22T02:14:13Z',
    digest: '7beafd840597ca944bb189b11b3d9641522331dcf55440cdf4c41cfd1fbbfaa0',
  },
  event: {
    time: '2012-11-22T09:45:12Z',
    digest: 'f21d8e8436cfcac6c553933ddb0e5954cbcd26ee2502a381c07f36ee22898be6',
  },
  classifications: {
    time: '2012-10-31T06:35:51Z',
    digest: '81fcc24a019d2bcf58c81bb16074586508871f40ec4bd8e889281e6906cda633',
  },
} as const;
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const sourceKey = (url: string) =>
  (Object.keys(reviewed) as (keyof typeof reviewed)[]).find(
    (key) => OFFICIAL_AFL_2012_SESSION_URLS[key] === url
  );
export function reviewedOfficialAflDraft2012EffectiveYear(url: string): number | null {
  const key = sourceKey(url);
  return key ? Number(reviewed[key].time.slice(0, 4)) : null;
}

export function parseOfficialAflDraft2012SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed 2012 source, date or scoped statements changed.',
      },
    ],
  });
  const key = sourceKey(input.capture.sourceUrl);
  if (!key) return fail();
  const $ = load(html),
    body = $('.article-body'),
    date = $('.article__date > time');
  // Pin the reviewed article text, never navigation or related-story text. Structural
  // checks below also reject changed club headings and moved/duplicated labels.
  if (
    body.length !== 1 ||
    date.length !== 1 ||
    date.attr('datetime') !== reviewed[key].time ||
    createHash('sha256').update(normalize(body.text())).digest('hex') !== reviewed[key].digest
  )
    return fail();
  const common = { draftYear: 2012, draftType: 'national' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (key === 'membership') {
    let club = '',
      rookie = false;
    const rows: { recordedName: string; selectionNumber: number; club: string }[] = [];
    body.find('h2,b').each((_, element) => {
      const text = normalize($(element).text());
      if (element.tagName === 'h2' && text) {
        club = text;
        rookie = false;
        return;
      }
      if (text === 'Rookies') {
        rookie = true;
        return;
      }
      if (rookie || /pre-season|rookie promotion/i.test(text)) return;
      const match = text.match(/^(.+?),?\s+pick No\.\s*(\d+)(.*)$/);
      if (match) rows.push({ recordedName: match[1]!, selectionNumber: Number(match[2]), club });
    });
    // Preserve the four unlabelled rookie elevations. Only the independent
    // classifications document may exclude them from completed membership.
    const osborne = rows.filter(
      (row) =>
        row.recordedName === 'Michael Osborne' &&
        row.selectionNumber === 70 &&
        row.club === 'Hawthorn'
    );
    const terminal = rows.filter(
      (row) =>
        row.recordedName === 'Sean Gregory' && row.selectionNumber === 88 && row.club === 'Essendon'
    );
    if (
      rows.length !== 74 ||
      new Set(rows.map((row) => row.selectionNumber)).size !== 74 ||
      rows.some((row) => !row.club) ||
      osborne.length !== 1 ||
      terminal.length !== 1
    )
      return fail();
    claims = [
      {
        ...common,
        kind: 'draft_completed_membership_roster',
        members: rows.map(({ recordedName, selectionNumber }) => ({
          recordedName,
          selectionNumber,
        })),
      },
      {
        ...common,
        kind: 'draft_selection',
        selectionNumber: 70,
        roundNumber: null,
        player: { nativeId: null, recordedName: osborne[0]!.recordedName },
        selectedByClub: { nativeId: null, recordedName: osborne[0]!.club },
      },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 88,
        player: { nativeId: null, recordedName: terminal[0]!.recordedName },
        selectedByClub: { nativeId: null, recordedName: terminal[0]!.club },
      },
    ];
  } else if (key === 'classifications') {
    const paragraphs = body
      .find('p')
      .map((_, element) => normalize($(element).text()))
      .get();
    const names = ['Jack Crisp', 'Niall McKeever', 'Kyal Horsley', 'Harry Cunningham'];
    if (
      names.some(
        (name) => paragraphs.filter((text) => text === `${name}, Promoted Rookie`).length !== 1
      )
    )
      return fail();
    claims = names.map((recordedName) => ({
      ...common,
      kind: 'draft_completed_member_exclusion',
      recordedName,
      reason: 'rookie_elevation',
    }));
  } else {
    // The pinned completed-event release separates 24 rookie elevations from
    // 66 live + three father-son + one local-talent national selections (70).
    claims = [
      { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2012-11-22' },
      { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
      { ...common, kind: 'draft_completed_total', selectionCount: 66 + 3 + 1 },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Lachie Whitfield' },
        selectedByClub: { nativeId: null, recordedName: 'GWS Giants' },
      },
    ];
  }
  return {
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2012:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
