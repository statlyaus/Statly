import { load } from 'cheerio';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION = 'official-afl-issuing-award/v1';
export const GWS_MINI_GRANT_URL =
  'https://www.gwsgiants.com.au/news/777331/2026-grand-final-packages';
export const ABLETT_COMPONENT_URL =
  'https://www.afl.com.au/news/471174/2012-trade-wrap-what-your-club-lost-and-gained';

export function isReviewedOfficialIssuingAwardUrl(url: string, year: number): boolean {
  return (
    (url === GWS_MINI_GRANT_URL && year === 2009) || (url === ABLETT_COMPONENT_URL && year === 2010)
  );
}

/** These are retrospective issuing references, not an approval, custody transfer or draft selection. */
export function parseOfficialAflIssuingAward(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
) {
  if (input.capture.parserVersion !== OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION)
    throw new TypeError('Issuing reference parser version does not match.');
  const document = load(html),
    bodies = document('.article__body');
  if (bodies.length !== 1)
    throw new TypeError('Issuing reference requires one publisher article body.');
  bodies.find('script, style, nav, aside').remove();
  bodies.find('br').replaceWith('\n');
  const text = bodies.text().replace(/\s+/g, ' ').trim();
  let claim: Extract<AflTradeExternalEvidenceContent['claim'], { kind: 'issuing_award_reference' }>;
  if (input.capture.sourceUrl === GWS_MINI_GRANT_URL) {
    if (
      !text.includes('October 2009') ||
      !text.includes('announced the concession') ||
      !text.includes('2011 NAB AFL Draft') ||
      !['Jaeger O’Meara', 'Brad Crouch', 'Jack Martin', 'Jesse Hogan'].every((name) =>
        text.replaceAll("'", '’').includes(name)
      )
    )
      throw new TypeError('Reviewed mini-draft issuing references changed or are incomplete.');
    claim = {
      kind: 'issuing_award_reference',
      grantYear: 2009,
      scheme: 'gws_mini_draft',
      recordedOriginalHolder: 'Greater Western Sydney',
      componentCount: 4,
      sourceDescription:
        'GWS mini-draft concession announced in October 2009; four named later selection rights.',
    };
  } else if (input.capture.sourceUrl === ABLETT_COMPONENT_URL) {
    const start = text.indexOf('GEELONG'),
      end = text.indexOf('GOLD COAST', start);
    const section = start >= 0 && end > start ? text.slice(start, end) : '';
    const goldCoast =
      end >= 0
        ? text.slice(
            end,
            text.indexOf('GREATER WESTERN SYDNEY', end) > end
              ? text.indexOf('GREATER WESTERN SYDNEY', end)
              : undefined
          )
        : '';
    const arrivals = goldCoast.includes('Out:')
      ? goldCoast.slice(0, goldCoast.indexOf('Out:'))
      : '';
    if (
      !section.includes('Out:') ||
      !section
        .slice(section.indexOf('Out:'))
        .includes('first-round compensation pick for losing Gary Ablett') ||
      !arrivals.includes('In:') ||
      !arrivals
        .slice(arrivals.indexOf('In:'))
        .includes('2010 compensation selection round one (G.Ablett)')
    ) {
      throw new TypeError(
        'Reviewed Ablett reference requires matching Geelong departure and Gold Coast arrival.'
      );
    }
    claim = {
      kind: 'issuing_award_reference',
      grantYear: 2010,
      scheme: 'gold_coast_expansion_compensation',
      recordedOriginalHolder: 'Geelong',
      componentCount: 1,
      sourceDescription:
        'Geelong transferred its 2010 round-one Gary Ablett compensation component in 2012.',
    };
  } else throw new TypeError('Official issuing reference URL is not reviewed.');
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: 1,
          sourceKey: `issuing-reference:${claim.scheme}:${claim.grantYear}`,
        },
        claim,
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
