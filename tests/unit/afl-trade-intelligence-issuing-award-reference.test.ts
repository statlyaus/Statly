import { captureOfficialAflPage } from '@/server/aflTradeIntelligence/source/officialAflPageCapture';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { describe, expect, it, vi } from 'vitest';
import {
  ABLETT_COMPONENT_URL,
  GWS_MINI_GRANT_URL,
  OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION,
  isReviewedOfficialIssuingAwardUrl,
  parseOfficialAflIssuingAward,
} from '@/server/aflTradeIntelligence/source/officialAflIssuingAwardAdapter';

const capture = (sourceUrl: string) => ({
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl,
  capturedAt: '2026-09-14T00:00:00.000Z',
  effectiveAt: '2012-10-15T00:00:00.000Z',
  parserVersion: OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION,
  fieldManifestSha256: 'c'.repeat(64),
});
// Synthetic excerpts exercise article boundaries without retaining publisher articles in Git.
const mini =
  'The AFL announced the concession in October 2009. At the 2011 NAB AFL Draft, Jaeger O’Meara and Brad Crouch; later Jack Martin and Jesse Hogan.';
const ablett =
  'GEELONG Out: first-round compensation pick for losing Gary Ablett GOLD COAST In: 2010 compensation selection round one (G.Ablett) Out: other';
const article = (body: string) => `<div class="article__body">${body}</div>`;

describe('retrospective issuing award references', () => {
  it('preserves a retrospective capture date separately from the original grant year', () => {
    const result = parseOfficialAflIssuingAward(article(mini), {
      capture: capture(GWS_MINI_GRANT_URL),
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].content.claim).toMatchObject({
      kind: 'issuing_award_reference',
      grantYear: 2009,
      componentCount: 4,
    });
    expect(result.evidence[0].content.capture.effectiveAt).toBe('2012-10-15T00:00:00.000Z');
    expect(result.evidence[0].content.publicationEligible).toBe(false);
  });
  it('extracts the Ablett issuing reference without inferring activation or expiry', () => {
    const result = parseOfficialAflIssuingAward(article(ablett), {
      capture: capture(ABLETT_COMPONENT_URL),
    });
    expect(result.evidence[0].content.claim).toMatchObject({ grantYear: 2010, componentCount: 1 });
    expect(result.evidence[0].content.claim).not.toHaveProperty('useYears');
  });
  it.each([
    mini.replace('October 2009', 'October 2011'),
    mini.replace('Jesse Hogan', 'another player'),
  ])('rejects missing original grant evidence', (body) => {
    expect(() =>
      parseOfficialAflIssuingAward(article(body), { capture: capture(GWS_MINI_GRANT_URL) })
    ).toThrow();
  });
  it('does not borrow evidence from navigation or another club', () => {
    for (const html of [
      article('no evidence') + `<nav>${mini}</nav>`,
      article(`<nav>${mini}</nav>`),
      article('GEELONG Out: none GOLD COAST Out: 2010 compensation selection round one (G.Ablett)'),
    ]) {
      expect(() =>
        parseOfficialAflIssuingAward(html, {
          capture: capture(html.includes('GEELONG') ? ABLETT_COMPONENT_URL : GWS_MINI_GRANT_URL),
        })
      ).toThrow();
    }
  });
  it('rejects ambiguous article bodies and mismatched parser versions', () => {
    expect(() =>
      parseOfficialAflIssuingAward(article(mini).repeat(2), {
        capture: capture(GWS_MINI_GRANT_URL),
      })
    ).toThrow();
    expect(() =>
      parseOfficialAflIssuingAward(article(mini), {
        capture: { ...capture(GWS_MINI_GRANT_URL), parserVersion: 'other/v1' },
      })
    ).toThrow();
  });
  it('restricts scope to exact reviewed URLs and original grant years', () => {
    expect(isReviewedOfficialIssuingAwardUrl(GWS_MINI_GRANT_URL, 2009)).toBe(true);
    expect(isReviewedOfficialIssuingAwardUrl(ABLETT_COMPONENT_URL, 2010)).toBe(true);
    expect(isReviewedOfficialIssuingAwardUrl(GWS_MINI_GRANT_URL, 2011)).toBe(false);
    expect(isReviewedOfficialIssuingAwardUrl(ABLETT_COMPONENT_URL + '/amp', 2010)).toBe(false);
    expect(() =>
      parseOfficialAflIssuingAward(article(mini), {
        capture: capture(GWS_MINI_GRANT_URL + '?other'),
      })
    ).toThrow();
  });
});

const request: IngestAflTradeExternalPageRequest = {
  ...capture(GWS_MINI_GRANT_URL),
  environment: 'non_production',
  provider: 'official_afl',
  competition: 'AFLM',
  anchorSeasonYear: 2009,
  discoveryFromSeasonYear: null,
  draftPathway: null,
  dataset: 'issuing references',
  datasetVersion: 'v1',
  accessMechanism: 'public_html',
  capabilityId: 'official-afl-issuing-award',
  maximumBytes: 1000000,
};
describe('issuing reference capture scope', () => {
  it('accepts exact original-grant scope with later observation time', () => {
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...request,
        sourceUrl: ABLETT_COMPONENT_URL,
        anchorSeasonYear: 2010,
      })
    ).not.toThrow();
  });
  it.each([
    { provider: 'draftguru' },
    { draftPathway: 'national' },
    { discoveryFromSeasonYear: 2009 },
    { anchorSeasonYear: 2011 },
    { sourceUrl: GWS_MINI_GRANT_URL + '/amp' },
    { parserVersion: 'unreviewed/v1' },
    { effectiveAt: '2008-01-01T00:00:00.000Z' },
    { effectiveAt: 'invalid' },
  ] as Partial<IngestAflTradeExternalPageRequest>[])('rejects scope mutation %j', (mutation) => {
    expect(() => validateAflTradeExternalCaptureScope({ ...request, ...mutation })).toThrow();
  });
});

describe('official article fetch boundary', () => {
  const settings = { validators: null, maximumBytes: 100, timeoutMs: 1000 };
  it('allows the reviewed GWS article and forbids other club pages before fetching', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response('article', { headers: { 'content-type': 'text/html' } })
      );
    await expect(
      captureOfficialAflPage({ ...settings, url: GWS_MINI_GRANT_URL, fetchImpl })
    ).resolves.toMatchObject({ status: 'captured' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const url of [
      GWS_MINI_GRANT_URL + '/amp',
      GWS_MINI_GRANT_URL + '?x=1',
      GWS_MINI_GRANT_URL.replace('/777331/', '/1/'),
      GWS_MINI_GRANT_URL.replace('https:', 'http:'),
    ]) {
      await expect(captureOfficialAflPage({ ...settings, url, fetchImpl })).rejects.toThrow();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'GET' });
  });
  it('enforces actual decoded byte limits', async () => {
    await expect(
      captureOfficialAflPage({
        ...settings,
        url: GWS_MINI_GRANT_URL,
        fetchImpl: async () =>
          new Response('x'.repeat(101), { headers: { 'content-type': 'text/html' } }),
      })
    ).rejects.toThrow('byte limit');
  });
});
