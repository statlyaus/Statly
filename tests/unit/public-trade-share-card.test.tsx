import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAflTradeStoryBundleSource } from '@/server/aflTradeIntelligence/development/tradeStoryBundle';

import { sampleTradeStoryBundle } from '../fixtures/aflTradeStorySampleBundle';

/**
 * A trade link shared on Reddit, X, Facebook or in a chat shows the trade's share card: the trade
 * page names it in its Open Graph and X tags, and /afl/trades/<id>/share-card draws it from the
 * owner-approved bundle only.
 */

const { loadStoryMock, imageResponseMock } = vi.hoisted(() => ({
  loadStoryMock: vi.fn(),
  imageResponseMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/aflTradeIntelligence/publication/publicTradeStoryReads', () => ({
  publicTradeStoryReads: { loadStory: loadStoryMock },
}));
// Satori needs Next's runtime to load its WebAssembly; the card's drawing is checked by its model.
vi.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options: unknown) {
      super('png', { headers: { 'content-type': 'image/png' } });
      imageResponseMock(element, options);
    }
  },
}));

import { generateMetadata } from '../../src/app/(public)/afl/trades/[tradeId]/page';
import { GET } from '../../src/app/(public)/afl/trades/[tradeId]/share-card/route';

const source = createAflTradeStoryBundleSource(sampleTradeStoryBundle(), { audience: 'public' });
const first = source.list().stories[0]!;
const available = <T,>(value: T) => ({ available: true as const, value });
const params = (tradeId: string) => ({ params: Promise.resolve({ tradeId }) });
const card = (tradeId: string) => GET(new Request('https://statly.com.au/'), params(tradeId));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trade share card', () => {
  it('draws the approved trade at 1200 × 630 with the brand fonts', async () => {
    loadStoryMock.mockResolvedValue(available(source.load(first.tradeId)));
    const response = await card(encodeURIComponent(first.tradeId));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const [, options] = imageResponseMock.mock.calls[0]!;
    expect(options).toMatchObject({ width: 1200, height: 630 });
    expect(
      options.fonts.map(({ name, weight }: { name: string; weight: number }) => `${name} ${weight}`)
    ).toEqual(['Geist 700', 'Geist 800', 'Saira 400']);
    expect(options.fonts.every(({ data }: { data: Buffer }) => data.length > 10_000)).toBe(true);
  });

  it('is not found for an unknown or malformed trade', async () => {
    loadStoryMock.mockResolvedValue(available(null));
    expect((await card('trade:not-in-the-bundle')).status).toBe(404);
    expect((await card('%E0%A4%A')).status).toBe(404);
    expect(imageResponseMock).not.toHaveBeenCalled();
  });

  it('is unavailable while no approved bundle is served', async () => {
    loadStoryMock.mockResolvedValue({ available: false });
    const response = await card(first.tradeId);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is named by the trade page for Open Graph and X, with alt text', async () => {
    loadStoryMock.mockResolvedValue(available(source.load(first.tradeId)));
    const metadata = await generateMetadata(params(first.tradeId));
    const image = {
      url: `/afl/trades/${encodeURIComponent(first.tradeId)}/share-card`,
      width: 1200,
      height: 630,
      alt: expect.stringMatching(new RegExp(`^Share card for the ${first.year} `, 'u')),
    };
    expect(metadata.metadataBase?.toString()).toBe('https://statly.com.au/');
    expect(metadata.openGraph).toMatchObject({ images: [image] });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });
});
