import { describe, expect, test, vi } from 'vitest';

interface MockRef {
  set: (data: unknown) => Promise<void>;
  get: () => Promise<{ exists: boolean; data: () => unknown }>;
}

interface MockCollection {
  doc: (id: string) => MockRef;
}

interface MockAdminDb {
  collection: (name: string) => MockCollection;
}

describe('Firestore Admin watchlist helpers', () => {
  test('sets and retrieves watchlist data using admin SDK', async () => {
    const userId = 'user1';
    const playerIds = ['player1', 'player2'];

    const set = vi.fn(async () => {});
    const snapshotData = { playerIds };
    const get = vi.fn(async () => ({ exists: true, data: () => snapshotData }));
    const doc = vi.fn((): MockRef => ({ set, get }));
    const collection = vi.fn((): MockCollection => ({ doc }));
    const adminDb: MockAdminDb = { collection };

    const ref = adminDb.collection('watchlists').doc(userId);
    await ref.set({ playerIds });

    const snapshot = await ref.get();
    const data = snapshot.exists ? snapshot.data() : null;

    expect(collection).toHaveBeenCalledWith('watchlists');
    expect(doc).toHaveBeenCalledWith(userId);
    expect(set).toHaveBeenCalledWith({ playerIds });
    expect(get).toHaveBeenCalled();
    expect(data).toEqual(snapshotData);
  });
});
