import type { MetadataRoute } from 'next';

const baseUrl =
  process.env.NEXT_PUBLIC_APP_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_BASE_URL ||
  'https://statly.com.au';

const publicRoutes = [
  '/',
  '/fantasy',
  '/players',
  '/player-rankings',
  '/rankings',
  '/stats',
  '/matches',
  '/live-scoring',
  '/live-stats',
  '/draft/trades',
  '/draft/clubs',
  '/privacy',
  '/terms',
  '/data-deletion',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return publicRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified,
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1 : 0.7,
  }));
}
