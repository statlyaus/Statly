import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const firestore = vi.hoisted(() => ({ get: vi.fn(), orderBy: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: () => ({
      orderBy: (...args: unknown[]) => {
        firestore.orderBy(...args);
        return {
          limit: (n: number) => {
            firestore.limit(n);
            return { get: firestore.get };
          },
        };
      },
    }),
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const snapshotOf = (season: unknown) => ({ docs: [{ data: () => ({ season }) }] });
const NOW = Date.parse('2026-11-18T00:00:00Z');

describe('current AFL stats season', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('is the latest season in the ingested match stats', async () => {
    firestore.get.mockResolvedValue(snapshotOf(2026));
    const { resolveCurrentStatsSeason } = await import('./currentStatsSeason');

    await expect(resolveCurrentStatsSeason(NOW)).resolves.toBe(2026);
    expect(firestore.orderBy).toHaveBeenCalledWith('season', 'desc');
    expect(firestore.limit).toHaveBeenCalledWith(1);
  });

  it('caches for an hour, then reads again', async () => {
    firestore.get.mockResolvedValueOnce(snapshotOf(2025)).mockResolvedValueOnce(snapshotOf(2026));
    const { resolveCurrentStatsSeason } = await import('./currentStatsSeason');

    await expect(resolveCurrentStatsSeason(NOW)).resolves.toBe(2025);
    await expect(resolveCurrentStatsSeason(NOW + 30 * 60 * 1000)).resolves.toBe(2025);
    await expect(resolveCurrentStatsSeason(NOW + 61 * 60 * 1000)).resolves.toBe(2026);
  });

  it('falls back to the calendar year without caching when the read fails or is empty', async () => {
    firestore.get
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ docs: [] });
    const { resolveCurrentStatsSeason } = await import('./currentStatsSeason');

    await expect(resolveCurrentStatsSeason(NOW)).resolves.toBe(2026);
    await expect(resolveCurrentStatsSeason(NOW)).resolves.toBe(2026);
    expect(firestore.get).toHaveBeenCalledTimes(2);
  });
});
