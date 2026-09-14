import { createHash } from 'node:crypto';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
import { OFFICIAL_AFL_COMPENSATION_PARSER_VERSION } from './officialAflCompensationPdfFacts';

// Reviewed original article mappings; these references confer no lifecycle approval.
const articles = [
  {
    url: 'https://www.afl.com.au/news/537729/nab-afl-draft-order-locked-in',
    sha256: 'c1bf8e2428f2b5587f286550d8a5b20b861eeb0ccbbe51779969e687f2cc285c',
    scopeYears: [2010],
    claims: [
      {
        kind: 'compensation_activation_reference',
        useYear: 2010,
        recordedPlayer: 'Campbell Brown',
        recordedHolder: 'North Melbourne',
        selectionPosition: 'end_first_round',
      },
    ],
  },
  {
    url: 'https://www.lions.com.au/news/730793/descendent-from-the-merger',
    sha256: '114a22e341ca89c3ed3ca76697a0ee8d324f9f38a763e47f854954b3160c6f49',
    scopeYears: [2011],
    claims: [
      {
        kind: 'compensation_activation_reference',
        useYear: 2011,
        recordedPlayer: 'Jarrod Harbrow',
        recordedHolder: 'Brisbane Lions',
        selectionPosition: 'end_first_round',
      },
    ],
  },
  {
    url: 'https://www.afl.com.au/news/103376/statement-suns-giants-activate-compo-draft-picks',
    sha256: '6968cae45856373b08a8059e5165248f0f7abbd1c5bfa758ad0863160a29e855',
    scopeYears: [2014],
    claims: [
      {
        kind: 'compensation_activation_reference',
        useYear: 2014,
        recordedPlayer: 'Gary Ablett',
        recordedHolder: 'Gold Coast',
        selectionPosition: 'first_round',
      },
      {
        kind: 'compensation_activation_reference',
        useYear: 2014,
        recordedPlayer: 'Jared Brennan',
        recordedHolder: 'GWS',
        selectionPosition: 'end_first_round',
      },
      {
        kind: 'compensation_activation_reference',
        useYear: 2014,
        recordedPlayer: 'Josh Fraser',
        recordedHolder: 'Gold Coast',
        selectionPosition: 'third_round',
      },
      {
        kind: 'compensation_rule_reference',
        scheme: 'gold_coast_expansion_compensation',
        awardYear: 2010,
        expiresAfterYear: 2014,
        nomination: null,
        initialYearNoticeDeadline: null,
        tradeable: true,
        windowYears: null,
      },
    ],
  },
  {
    url: 'https://www.afl.com.au/news/93491/gold-coast-activate-compensation-pick-for-2015-draft',
    sha256: '034d713636f081d97c086d6a79b01b662ff61dd4d0c6ae24c17abf7b6f90c57a',
    scopeYears: [2015],
    claims: [
      {
        kind: 'compensation_activation_reference',
        useYear: 2015,
        recordedPlayer: 'Rhys Palmer',
        recordedHolder: 'Gold Coast',
        selectionPosition: 'end_first_round',
      },
    ],
  },
  {
    url: 'https://www.afl.com.au/news/81535/gold-coast-draft-rules-explained',
    sha256: 'b0e3d407fb1d3465bba0a3ad89bd51df862862a90598c25b6caf6bb14fe68a94',
    scopeYears: [2010, 2011, 2012, 2013, 2014],
    claims: [
      {
        kind: 'compensation_rule_reference',
        scheme: 'gold_coast_expansion_compensation',
        awardYear: 2010,
        expiresAfterYear: null,
        nomination: 'before_season',
        initialYearNoticeDeadline: null,
        tradeable: true,
        windowYears: 5,
      },
    ],
  },
  {
    url: 'https://www.melbournefc.com.au/news/774653/afl-compensation-explained',
    sha256: '8983caced741092cada49b21da8e85a317cccae8d0d023aac3b395a31f1c7eb2',
    scopeYears: [2011, 2012, 2013, 2014, 2015],
    claims: [
      {
        kind: 'compensation_rule_reference',
        scheme: 'gws_expansion_compensation',
        awardYear: 2011,
        expiresAfterYear: 2015,
        nomination: 'before_season',
        initialYearNoticeDeadline: '2011-11-11',
        tradeable: true,
        windowYears: null,
      },
    ],
  },
] as const;

export function reviewedOfficialAflCompensationArticle(url: string, year: number): boolean {
  return articles.some(
    (source) => source.url === url && source.scopeYears.some((value) => value === year)
  );
}

export function parseOfficialAflCompensationArticle(
  html: string,
  input: {
    capture: AflTradeExternalEvidenceContent['capture'];
    anchorSeasonYear: number;
  }
) {
  const { capture } = input;
  const source = articles.find((record) => record.url === capture.sourceUrl);
  if (
    !source ||
    !reviewedOfficialAflCompensationArticle(capture.sourceUrl, input.anchorSeasonYear) ||
    capture.parserVersion !== OFFICIAL_AFL_COMPENSATION_PARSER_VERSION ||
    capture.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'text/html' ||
    capture.contentSha256 !== source.sha256 ||
    createHash('sha256').update(html, 'utf8').digest('hex') !== source.sha256
  ) {
    throw new TypeError(
      'Compensation article requires exact reviewed bytes, URL, media type, parser and scope year.'
    );
  }
  return {
    evidence: source.claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'official_afl',
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `compensation-reference:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
