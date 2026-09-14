import { createHash } from 'node:crypto';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_COMPENSATION_PARSER_VERSION = 'official-afl-compensation-lifecycle/v1';
const reports = [
  {
    url: 'https://resources.afl.com.au/afl/document/2019/12/05/59317d2f-a338-4833-a242-21f858d6fa81/AFL-Annual-Report-2012_web-min.pdf',
    sha256: '8746ba6dc9f918d4920313c263ee3ca1c62a2ac7e79cf7f1a783b37033c47704',
    year: 2012,
    page: 62,
    selections: [
      {
        recordedPlayer: 'Phil Davis',
        recordedHolder: 'GWS Giants',
        selectionPosition: 'first_round',
      },
      {
        recordedPlayer: 'Nathan Krakouer',
        recordedHolder: 'Richmond',
        selectionPosition: 'second_round',
      },
    ],
  },
  {
    url: 'https://resources.afl.com.au/afl/document/2019/12/05/961d597e-b5d8-42b6-9f66-f2518cdd279b/2013-AFL-Annual-Report-min.pdf',
    sha256: '13aff57dae8cc9f96835e5ac0a801fd1561fe192aa4246c0b791805c76d40152',
    year: 2013,
    page: 51,
    selections: [
      {
        recordedPlayer: 'Gary Ablett',
        recordedHolder: 'GWS Giants',
        selectionPosition: 'mid_first_round',
      },
      {
        recordedPlayer: 'Nathan Bock',
        recordedHolder: 'Gold Coast Suns',
        selectionPosition: 'end_first_round',
      },
    ],
  },
] as const;

export function reviewedOfficialAflCompensationPdf(url: string, year: number): boolean {
  return reports.some((source) => source.url === url && source.year === year);
}

/** Reviewed page mappings to exact original PDFs; no notice date, issuing award or approval inferred. */
export function parseOfficialAflCompensationPdfFacts(input: {
  bytes: Uint8Array;
  capture: AflTradeExternalEvidenceContent['capture'];
  anchorSeasonYear: number;
}) {
  const { capture } = input;
  const report = reports.find((source) => source.url === capture.sourceUrl);
  if (
    !report ||
    input.anchorSeasonYear !== report.year ||
    capture.parserVersion !== OFFICIAL_AFL_COMPENSATION_PARSER_VERSION ||
    capture.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf' ||
    capture.contentSha256 !== report.sha256 ||
    createHash('sha256').update(input.bytes).digest('hex') !== report.sha256
  ) {
    throw new TypeError(
      'Compensation PDF requires the exact reviewed bytes, URL, media type, parser and year.'
    );
  }
  return {
    evidence: report.selections.map((selection, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'official_afl',
        capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `${report.year}:pdf-page-${report.page}:activated:${selection.recordedPlayer}:${selection.selectionPosition}`,
        },
        claim: { kind: 'compensation_activation_reference', useYear: report.year, ...selection },
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
