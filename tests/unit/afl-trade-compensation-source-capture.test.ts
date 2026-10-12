// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { captureOfficialAflPage } from '../../src/server/aflTradeIntelligence/source/officialAflPageCapture';
import { reviewedOfficialAflCompensationSource } from '../../src/server/aflTradeIntelligence/source/officialAflCompensationSourceScope';

const pdf =
  'https://resources.afl.com.au/afl/document/2019/12/05/961d597e-b5d8-42b6-9f66-f2518cdd279b/2013-AFL-Annual-Report-min.pdf';
const sources = [
  pdf,
  'https://resources.afl.com.au/afl/document/2019/12/05/59317d2f-a338-4833-a242-21f858d6fa81/AFL-Annual-Report-2012_web-min.pdf',
  'https://www.lions.com.au/news/730793/descendent-from-the-merger',
  'https://www.melbournefc.com.au/news/774653/afl-compensation-explained',
];
const capture = (url: string, fetchImpl: typeof fetch, maximumBytes = 128) =>
  captureOfficialAflPage({ url, fetchImpl, maximumBytes, timeoutMs: 1000, validators: null });

describe('compensation reference capture paths', () => {
  it.each(sources)('retains exact bytes and bounded request controls for %s', async (url) => {
    const mediaType = reviewedOfficialAflCompensationSource(url)?.mediaType;
    expect(mediaType).toBeDefined();
    const bytes = new TextEncoder().encode(
      mediaType === 'application/pdf' ? '%PDF-1.4 fixture' : '<article>fixture</article>'
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(bytes, { headers: { 'content-type': `${mediaType}; charset=utf-8` } })
      );
    const result = await capture(url, fetchImpl);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured bytes');
    expect(result.bytes).toEqual(bytes);
    expect(result.contentSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    `${pdf}?download=1`,
    `${pdf}#page=1`,
    pdf.replace('2013-AFL', '2014-AFL'),
    sources[2].replace('730793', '730794'),
    sources[3].replace('https:', 'http:'),
    sources[2].replace('www.lions.com.au', 'www.lions.com.au.example.com'),
  ])('rejects an unreviewed URL before fetch: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(capture(url, fetchImpl)).rejects.toThrow('outside the approved article path');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [pdf, 'text/html'],
    [sources[2], 'application/pdf'],
  ])('rejects mismatched media for %s', async (url, mediaType) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('fixture', { headers: { 'content-type': mediaType } }));
    await expect(capture(url, fetchImpl)).rejects.toThrow('unsupported content type');
  });

  it('bounds report bodies when content length is absent', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('%PDF-1.4 too large', { headers: { 'content-type': 'application/pdf' } })
      );
    await expect(capture(pdf, fetchImpl, 8)).rejects.toThrow('byte limit');
  });
});

describe('reviewed pre-draft order archive snapshots (issue 853)', () => {
  const archive =
    'https://web.archive.org/web/20231119230530id_/https://www.afl.com.au/draft/draft-order';

  it('fetches the exact approved snapshot as HTML without following redirects', async () => {
    const bytes = new TextEncoder().encode('<table>fixture</table>');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(bytes, { headers: { 'content-type': 'text/html;charset=utf-8' } })
      );
    const result = await capture(archive, fetchImpl);
    expect(result.status).toBe('captured');
    expect(fetchImpl).toHaveBeenCalledWith(archive, expect.objectContaining({ redirect: 'error' }));
  });

  it.each([
    archive.replace('230530', '230531'),
    archive.replace('id_/', '/'),
    'https://web.archive.org/web/20231119230530id_/https://www.afl.com.au/draft/draft-tracker',
  ])('refuses any other archive.org URL before fetch: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(capture(url, fetchImpl)).rejects.toThrow('outside the approved article path');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
