import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: firestoreMocks.collection,
  },
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: firestoreMocks.collection,
  },
}));

describe('league list route architecture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('lists only public leagues by default', async () => {
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'public-league',
          data: () => ({ name: 'Open League', type: 'public' }),
        },
      ],
    });
    const limit = vi.fn(() => ({ get }));
    const where = vi.fn(() => ({ limit }));
    const directLimit = vi.fn(() => ({ get }));

    firestoreMocks.collection.mockReturnValue({ where, limit: directLimit });

    const { GET } = await import('../../src/app/api/leagues/route');
    const response = await GET(new Request('https://statly.test/api/leagues') as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ id: 'public-league', name: 'Open League', type: 'public' }]);
    expect(where).toHaveBeenCalledWith('type', '==', 'public');
    expect(directLimit).not.toHaveBeenCalled();
  });
});
