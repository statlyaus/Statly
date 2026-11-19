import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const check = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { public: {} },
  withRateLimit: () => check,
}));

import { limitPublicTradeRequest } from '@/server/aflTradeIntelligence/runtime/publicTradeRateLimit';

const request = new NextRequest('http://localhost/api/draft-trades');

describe('public trade API rate limit', () => {
  it('lets a request within the budget through', async () => {
    check.mockResolvedValue({ success: true });
    await expect(limitPublicTradeRequest(request)).resolves.toBeNull();
  });

  it('answers the limiter status, headers and body when over budget', async () => {
    check.mockResolvedValue({
      success: false,
      status: 429,
      headers: { 'Retry-After': '30' },
      body: { success: false, error: { message: 'Too Many Requests' } },
    });

    const response = await limitPublicTradeRequest(request);

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('30');
  });

  it('guards every public trade route before any read', async () => {
    const { readFileSync } = await import('node:fs');
    const { globSync } = await import('node:fs');
    const routes = globSync('src/app/api/draft-trades/**/route.ts');
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const route of routes) {
      const source = readFileSync(route, 'utf8');
      const body = source.slice(source.indexOf('export async function GET'));
      expect(body.indexOf('limitPublicTradeRequest(request)'), route).toBeGreaterThan(0);
      expect(body.indexOf('limitPublicTradeRequest(request)'), route).toBeLessThan(
        body.indexOf('{\n') + 120
      );
    }
  });
});
