import { expect, it, vi } from 'vitest';
import { captureOfficialAflPage } from '@/server/aflTradeIntelligence/source/officialAflPageCapture';
import {
  OFFICIAL_AFL_2010_REPORT,
  parseOfficialAflDraft2010PdfFacts,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2010PdfFacts';

it('rejects claimed PDF digests without the actual reviewed bytes', () => {
  const parsed = parseOfficialAflDraft2010PdfFacts({
    bytes: new TextEncoder().encode('%PDF-1.7 forged report'),
    anchorSeasonYear: 2010,
    capture: {
      captureId: `source-capture:${'1'.repeat(64)}`,
      artifactId: `artifact:${'2'.repeat(64)}`,
      contentSha256: OFFICIAL_AFL_2010_REPORT.sha256,
      mediaType: 'application/pdf',
      sourceUrl: OFFICIAL_AFL_2010_REPORT.url,
      capturedAt: '2026-09-14T00:00:00.000Z',
      effectiveAt: '2026-09-14T00:00:00.000Z',
      parserVersion: 'fixture/v1',
      fieldManifestSha256: '3'.repeat(64),
    },
  });
  expect(parsed.evidence).toHaveLength(0);
  expect(parsed.issues).toHaveLength(1);
});
it('captures exact reviewed PDF bytes with PDF content negotiation', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 255, 254]);
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(bytes, {
        headers: { 'content-type': 'application/pdf' },
      })
  );
  const result = await captureOfficialAflPage({
    url: OFFICIAL_AFL_2010_REPORT.url,
    validators: null,
    maximumBytes: 100,
    timeoutMs: 1000,
    fetchImpl,
  });
  expect(result).toMatchObject({ status: 'captured', bytes, mediaType: 'application/pdf' });
  expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Accept')).toBe('application/pdf');
});
it.each(['https://resources.afl.com.au/other.pdf', `${OFFICIAL_AFL_2010_REPORT.url}?x=1`])(
  'rejects unreviewed resource URL %s before retrieval',
  async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      captureOfficialAflPage({
        url,
        validators: null,
        maximumBytes: 100,
        timeoutMs: 1000,
        fetchImpl,
      })
    ).rejects.toThrow(/outside/);
    expect(fetchImpl).not.toHaveBeenCalled();
  }
);
it.each(['text/html', 'application/octet-stream'])(
  'rejects PDF response type %s',
  async (mediaType) => {
    await expect(
      captureOfficialAflPage({
        url: OFFICIAL_AFL_2010_REPORT.url,
        validators: null,
        maximumBytes: 100,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response('error page', {
            headers: { 'content-type': mediaType },
          }),
      })
    ).rejects.toThrow(/content type/);
  }
);
