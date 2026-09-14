import { createHash } from 'node:crypto';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_2010_REPORT = {
  url: 'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf',
  sha256: '9e2d92ccbe9ff013687402c6d9dfde884939b69a708b3d633407c09f10e29572',
  pdfPageIndex: 64,
  printedPage: 74,
  reviewedStatement:
    'was the No. 1 selection and, in total, there were 107 players added to AFL lists.',
} as const;

/**
 * Reviewed-document mapping, not general PDF text extraction. The statement was
 * checked against this exact PDF's page65/printed74. A different document digest
 * requires a fresh reviewed mapping; caller-supplied text/counts are never used.
 * Capture effectiveAt remains an observation timestamp, not a publication claim.
 */
export function parseOfficialAflDraft2010PdfFacts(input: {
  bytes: Uint8Array;
  capture: AflTradeExternalEvidenceContent['capture'];
  anchorSeasonYear: number;
}) {
  const { capture, bytes } = input;
  if (
    input.anchorSeasonYear !== 2010 ||
    capture.sourceUrl !== OFFICIAL_AFL_2010_REPORT.url ||
    capture.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf' ||
    capture.contentSha256 !== OFFICIAL_AFL_2010_REPORT.sha256 ||
    createHash('sha256').update(bytes).digest('hex') !== OFFICIAL_AFL_2010_REPORT.sha256
  ) {
    return {
      evidence: [],
      issues: [
        {
          code: 'invalid_draft_session' as const,
          sourceKey: capture.sourceUrl,
          detail:
            'Reviewed2010 PDF requires the exact original report bytes, URL, media type and year.',
        },
      ],
    };
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture,
        sourceRow: {
          ordinal: 65,
          sourceKey: '2010-national:pdf-page-65:printed-74:list-additions',
        },
        claim: {
          kind: 'draft_completed_list_total',
          draftYear: 2010,
          draftType: 'national',
          population: 'national_selections_and_rookie_promotions',
          playerCount: 107,
        },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
