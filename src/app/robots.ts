import type { MetadataRoute } from 'next';

const baseUrl =
  process.env.NEXT_PUBLIC_APP_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_BASE_URL ||
  'https://statly.com.au';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/cms/',
        '/wp/',
        '/wp2/',
        '/blog/',
        '/shop/',
        '/test/',
        '/wordpress/',
        '/xmlrpc.php',
        '/wp-includes/',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
