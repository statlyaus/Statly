import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2011_SESSION_URLS = {
  membership: 'https://www.afl.com.au/news/506746/national-draft-all-the-picks',
  sutcliffe: 'https://www.afl.com.au/news/75034/draft-what-the-dockers-say',
  total: 'https://www.afl.com.au/news/453197/draft-numbers-set-to-fall-in-shallow-pool',
  saints: 'https://www.afl.com.au/news/469214/st-kilda-draft-summary',
} as const;
const reviewed = {
  membership: {
    time: '2011-11-24T22:58:00Z',
    digest: 'adcf01bbe5adbd073e9fb279403a3ccda4a022d3700bda6d9d0add5d0aa42257',
  },
  sutcliffe: {
    time: '2011-11-24T11:09:00Z',
    digest: '015e53b5be0488cf1031f0fb03ad47c14864f5c2cec26ad394603e9db5f17349',
  },
  total: {
    time: '2013-10-28T06:34:28Z',
    digest: '6c2b4dd781e808ca43b6f331adecf630ed731654771f807a7a4c79e4c427df54',
  },
  saints: {
    time: '2011-11-24T09:27:00Z',
    digest: '3076c805e6711e2b0ecb7926c9dcc4460a4df8c694652505648b921d2aef6618',
  },
} as const;
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const sourceKey = (url: string) =>
  (Object.keys(reviewed) as (keyof typeof reviewed)[]).find(
    (key) => OFFICIAL_AFL_2011_SESSION_URLS[key] === url
  );
export function reviewedOfficialAflDraft2011EffectiveYear(url: string): number | null {
  const key = sourceKey(url);
  return key ? Number(reviewed[key].time.slice(0, 4)) : null;
}

function reviewedMembershipMatches(
  members: { recordedName: string; selectionNumber: number }[],
  selected: string[]
) {
  return !(
    members.some((member) => !member.recordedName) ||
    new Set(members.map((member) => member.recordedName)).size !== 75 ||
    members[0]?.recordedName !== 'Jonathon Patton' ||
    members.at(-1)?.recordedName !== 'Jackson Allen' ||
    !selected[0]?.startsWith('1. GWS Giants - ') ||
    !selected.at(-1)?.startsWith('91. Gold Coast Suns (LT) - ') ||
    members.find((member) => member.recordedName === 'Cameron Sutcliffe')?.selectionNumber !== 72
  );
}

function parseReviewedMembership(
  bodyHtml: string
): AflTradeExternalEvidenceContent['claim'][] | null {
  const common = { draftYear: 2011, draftType: 'national' as const };
  const lines = bodyHtml
    .split(/<br\s*\/?\s*>/i)
    .map((fragment) => normalize(load(fragment).text()))
    .filter((text) => /^\d+\./.test(text));
  if (
    lines.length !== 96 ||
    lines.some((text, index) => Number(text.match(/^\d+/)?.[0]) !== index + 1)
  )
    return null;
  const promotions = lines.filter((text) => text.includes('(PR)'));
  const passes = lines.filter((text) => / - Pass$/.test(text));
  const selected = lines.filter((text) => !promotions.includes(text) && !passes.includes(text));
  if (promotions.length !== 13 || passes.length !== 8 || selected.length !== 75) return null;
  const members = selected.map((text) => ({
    recordedName:
      text
        .split(' - ')[1]
        ?.replace(/\s+\(.*$/, '')
        .trim() ?? '',
    selectionNumber: Number(text.match(/^\d+/)?.[0]),
  }));
  if (!reviewedMembershipMatches(members, selected)) return null;
  // Keep the source's disputed72. The independent club report and reviewed
  // membership owner resolve it; this parser never edits the reported value.
  return [
    { ...common, kind: 'draft_completed_membership_roster', members },
    {
      ...common,
      kind: 'draft_session_boundary',
      sessionOrdinal: 1,
      boundary: 'first',
      selectionNumber: 1,
      player: { nativeId: null, recordedName: 'Jonathon Patton' },
      selectedByClub: { nativeId: null, recordedName: 'GWS Giants' },
    },
    {
      ...common,
      kind: 'draft_session_boundary',
      sessionOrdinal: 1,
      boundary: 'last',
      selectionNumber: 91,
      player: { nativeId: null, recordedName: 'Jackson Allen' },
      selectedByClub: { nativeId: null, recordedName: 'Gold Coast Suns' },
    },
  ];
}

function reviewedArticleMatches($: ReturnType<typeof load>, key: keyof typeof reviewed) {
  const body = $('.article-body'),
    date = $('.article__date > time');
  // Pin the reviewed article text, never navigation or related-story text. Structural
  // checks below also reject changed club headings and moved/duplicated labels.
  return !(
    body.length !== 1 ||
    date.length !== 1 ||
    date.attr('datetime') !== reviewed[key].time ||
    createHash('sha256').update(normalize(body.text())).digest('hex') !== reviewed[key].digest
  );
}

export function parseOfficialAflDraft2011SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed 2011 source, date or scoped statements changed.',
      },
    ],
  });
  const key = sourceKey(input.capture.sourceUrl);
  if (!key) return fail();
  const $ = load(html),
    body = $('.article-body');
  if (!reviewedArticleMatches($, key)) return fail();
  const common = { draftYear: 2011, draftType: 'national' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (key === 'membership') {
    const membership = parseReviewedMembership(body.html() ?? '');
    if (!membership) return fail();
    claims = membership;
  } else if (key === 'sutcliffe') {
    const text = normalize(body.text());
    if (!text.includes('Pick 71: Cameron Sutcliffe') || !text.includes('Pick 72: Pass'))
      return fail();
    claims = [
      {
        ...common,
        kind: 'draft_completed_member_number',
        recordedName: 'Cameron Sutcliffe',
        selectionNumber: 71,
      },
    ];
  } else if (key === 'total') {
    const text = normalize(body.text());
    if (
      !text.includes('in 2011 there was 75') ||
      !text.includes('The total does not include rookie elevations')
    )
      return fail();
    claims = [{ ...common, kind: 'draft_completed_total', selectionCount: 75 }];
  } else {
    const text = normalize(body.text());
    // Completed Thursday evening plus the contextual Thursday24 November timestamp
    // establish the event date; this is not a future draft-order announcement.
    if (
      !text.includes(
        '2011 NAB AFL National Draft held at Sydney Olympic Park Sports Centre on Thursday evening'
      ) ||
      !/Pick 76\s*Jason Blake\s*\*re-drafted/.test(text)
    )
      return fail();
    claims = [
      { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2011-11-24' },
      { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
      {
        ...common,
        kind: 'draft_selection',
        selectionNumber: 76,
        roundNumber: null,
        player: { nativeId: null, recordedName: 'Jason Blake' },
        selectedByClub: { nativeId: null, recordedName: 'St Kilda' },
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
          sourceKey: `national-draft:2011:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
