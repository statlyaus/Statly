import { createHash } from 'node:crypto';
import { load } from 'cheerio';

import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

type PartialSessionClaim = Extract<
  AflTradeExternalEvidenceContent['claim'],
  {
    kind:
      | 'draft_session_date'
      | 'draft_session_completion'
      | 'draft_session_boundary'
      | 'draft_completed_total';
  }
>;

// Bind reviewed paragraphs by normalized-text digest without duplicating article prose.
// Wrap: opening selection, completed Tuesday session, first player/club, final player/club.
// Independent report: retrospective total of 70 selected players.
const reports = new Map<
  string,
  {
    displayedDate: string;
    paragraphSha256: readonly string[];
    claims: readonly PartialSessionClaim[];
  }
>([
  [
    'https://www.afl.com.au/news/78408/afl-draft-blues-lock-in-weitering-with-no1-pick',
    {
      displayedDate: '2015-11-24T10:38:54Z',
      paragraphSha256: [
        '6506d835898e89fdc25dca10dcad16373b80b5df03e18c2d102ad88484c70513',
        'dc0ea75555c92f6600e21cf4eae0d235d63a1d0d0439a6d2d40d5285dbad794f',
        'af998360d5255a7426fcabb149839b846845f92ee1abfb53ce80f4dd7f13c4e2',
        '13806444cd7f4fc1fef50fc336f79df97fc76a9437cfad20c238500d8544f030',
      ],
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2015,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2015-11-24',
        },
        {
          kind: 'draft_session_completion',
          draftYear: 2015,
          draftType: 'national',
          sessionOrdinal: 1,
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2015,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'first',
          selectionNumber: 1,
          player: {
            nativeId: null,
            recordedName: 'Jacob Weitering',
          },
          selectedByClub: {
            nativeId: null,
            recordedName: 'Carlton',
          },
        },
        {
          kind: 'draft_session_boundary',
          draftYear: 2015,
          draftType: 'national',
          sessionOrdinal: 1,
          boundary: 'last',
          selectionNumber: 70,
          player: {
            nativeId: null,
            recordedName: 'Matthew Hayball',
          },
          selectedByClub: {
            nativeId: null,
            recordedName: 'Geelong',
          },
        },
      ],
    },
  ],
  [
    'https://www.afl.com.au/news/39972/nine-things-we-learned-from-the-2015-nab-afl-draft',
    {
      displayedDate: '2015-11-24T13:49:40Z',
      paragraphSha256: ['4757ce3e5e82175d7ecd170db85d01ffe7843805528ba853ff2b12719bbf400b'],
      claims: [
        {
          kind: 'draft_completed_total',
          draftYear: 2015,
          draftType: 'national',
          selectionCount: 70,
        },
      ],
    },
  ],
]);

export function isReviewedOfficialAflDraft2015SessionFactUrl(url: string): boolean {
  return reports.has(url);
}

export function parseOfficialAflDraft2015SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [
      { code: 'invalid_draft_session' as const, sourceKey: input.capture.sourceUrl, detail },
    ],
  });
  const report = reports.get(input.capture.sourceUrl);
  if (!report) return fail('No reviewed 2015 partial-session report matches this exact URL.');
  const $ = load(html);
  const body = $('.article-body');
  const dates = $('.article__date > time');
  const paragraphs = body
    .children('p')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get();
  const indexes = report.paragraphSha256.map((digest) =>
    paragraphs.flatMap((paragraph, index) =>
      digest === createHash('sha256').update(paragraph).digest('hex') ? [index] : []
    )
  );
  const uniquelyOrdered =
    indexes.every((matches) => matches.length === 1) &&
    indexes.every((matches, index) => index === 0 || matches[0]! > indexes[index - 1]![0]!);
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== report.displayedDate ||
    !uniquelyOrdered
  )
    return fail('The reviewed 2015 partial-session article structure or scoped statement changed.');
  return {
    evidence: report.claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2015:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
