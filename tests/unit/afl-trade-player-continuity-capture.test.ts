// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { captureOfficialAflPage } from '../../src/server/aflTradeIntelligence/source/officialAflPageCapture';
import { OFFICIAL_AFL_PLAYER_CONTINUITY_SOURCES } from '../../src/server/aflTradeIntelligence/source/officialAflPlayerContinuitySourceScope';

const capture = (url: string, fetchImpl: typeof fetch, maximumBytes = 128) =>
  captureOfficialAflPage({ url, fetchImpl, maximumBytes, timeoutMs: 1000, validators: null });

describe('reviewed player continuity source capture', () => {
  it.each(OFFICIAL_AFL_PLAYER_CONTINUITY_SOURCES)(
    'retains bounded HTML bytes for %s',
    async (url) => {
      const bytes = '<article>continuity fixture</article>';
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(bytes, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        );
      const result = await capture(url, fetchImpl);
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error('Expected captured bytes');
      expect(result.contentSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(fetchImpl).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          method: 'GET',
          redirect: 'error',
          signal: expect.any(AbortSignal),
        })
      );
    }
  );

  it.each(OFFICIAL_AFL_PLAYER_CONTINUITY_SOURCES)(
    'rejects URL variants before fetch for %s',
    async (url) => {
      for (const invalid of [
        url + '?extra=1',
        url + '#fragment',
        url + '/',
        url.replace('https:', 'http:'),
        url.replace('.com.au/', '.com.au.example.com/'),
        url.replace('/news/', '/news/999/'),
        'https://www.portadelaidefc.com.au/club/history/unreviewed',
      ]) {
        if (invalid === url) continue;
        const fetchImpl = vi.fn<typeof fetch>();
        await expect(capture(invalid, fetchImpl)).rejects.toThrow(
          'outside the approved article path'
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      }
    }
  );

  it('preserves media and streaming size checks on the non-article history page', async () => {
    const url = 'https://www.portadelaidefc.com.au/club/history/past-players';
    const wrongMedia = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('%PDF', {
        headers: { 'content-type': 'application/pdf' },
      })
    );
    await expect(capture(url, wrongMedia)).rejects.toThrow('unsupported content type');
    const tooLarge = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('too much HTML', {
        headers: { 'content-type': 'text/html' },
      })
    );
    await expect(capture(url, tooLarge, 4)).rejects.toThrow('byte limit');
  });
});
