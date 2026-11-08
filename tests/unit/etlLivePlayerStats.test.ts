import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  query: vi.fn((ref: unknown) => ref),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/firebase/clientFirestore', () => ({ db: {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { getLivePlayerStats } from '@/lib/etlIntegration';

describe('getLivePlayerStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a failed ETL read instead of inventing zero-stat rows from players', async () => {
    firestore.getDocs.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(getLivePlayerStats(2026)).rejects.toThrow('permission-denied');
    expect(firestore.collection.mock.calls.map(([, name]) => name)).toEqual(['player_match_stats']);
  });

  it('returns no rows when the ETL has none, without reading players', async () => {
    firestore.getDocs.mockResolvedValueOnce({ docs: [] });

    await expect(getLivePlayerStats(2026)).resolves.toEqual([]);
    expect(firestore.collection.mock.calls.map(([, name]) => name)).toEqual(['player_match_stats']);
  });
});
