import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_MINI_2012_SOURCES = {
  window: {
    url: 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
    time: '2012-10-08T01:41:12Z',
    digest: 'a95218761ed831d518e311afacd63e31510aa616cdfa3405f1ad5a277a918e32',
  },
  completed: {
    url: 'https://www.afl.com.au/news/453694/official-paperwork-close-to-gillette-afl-trade-period-friday-october-26',
    time: '2012-10-26T05:50:07Z',
    digest: 'c684ab3d822d940c6713982e149f404eba6374889bcfd00f2955645d34e7abdb',
  },
} as const;

export function reviewedOfficialAflMiniDraft2012EffectiveYear(url: string): number | null {
  return Object.values(OFFICIAL_AFL_MINI_2012_SOURCES).some((source) => source.url === url)
    ? 2012
    : null;
}

/** The rules establish a window; lodged paperwork establishes use. Neither supplies an exact day. */
export function parseOfficialAflMiniDraft2012SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
) {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed2012 mini-draft source, context or statements changed.',
      },
    ],
  });
  const found = Object.entries(OFFICIAL_AFL_MINI_2012_SOURCES).find(
    ([, source]) => source.url === input.capture.sourceUrl
  );
  if (!found) return fail();
  const [key, source] = found;
  const $ = load(html),
    body = $('.article-body'),
    dates = $('.article__date > time');
  const text = body.text().replace(/\s+/g, ' ').trim();
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== source.time ||
    createHash('sha256').update(text).digest('hex') !== source.digest
  )
    return fail();
  const common = { draftYear: 2012, draftType: 'mini_draft' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (key === 'window') {
    if (
      !text.includes('during the trade period (October 8-26)') ||
      !text.includes(
        'clubs able to make their selection at any time once the trade has been completed, up until the last day of the exchange period'
      )
    )
      return fail();
    // Available capacity is prospective, so it must not become a completed-total claim.
    claims = [
      {
        ...common,
        kind: 'draft_session_window',
        sessionOrdinal: 1,
        datePrecision: {
          precision: 'window',
          eventDate: null,
          earliestDate: '2012-10-08',
          latestDate: '2012-10-26',
        },
      },
    ];
  } else {
    const members = [
      { selectionNumber: 1, recordedName: 'Jack Martin', club: 'Gold Coast Suns', ordinal: 'one' },
      { selectionNumber: 2, recordedName: 'Jesse Hogan', club: 'Melbourne', ordinal: 'two' },
    ];
    if (
      !members.every((member) =>
        text.includes(
          `Trade Incentive Selection number ${member.ordinal} (used on ${member.recordedName}) to ${member.club === 'Gold Coast Suns' ? 'the ' : ''}${member.club}`
        )
      )
    )
      return fail();
    claims = [
      {
        ...common,
        kind: 'draft_completed_membership_roster',
        members: members.map(({ selectionNumber, recordedName }) => ({
          selectionNumber,
          recordedName,
        })),
      },
      ...members.map((member, index) => ({
        ...common,
        kind: 'draft_session_boundary' as const,
        sessionOrdinal: 1,
        boundary: index === 0 ? ('first' as const) : ('last' as const),
        selectionNumber: member.selectionNumber,
        player: { nativeId: null, recordedName: member.recordedName },
        selectedByClub: { nativeId: null, recordedName: member.club },
      })),
      { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
    ];
  }
  return {
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: index + 1, sourceKey: `mini-draft:2012:${claim.kind}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
