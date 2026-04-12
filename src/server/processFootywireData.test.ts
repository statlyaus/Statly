import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordUnresolvedPlayerStatRow, resolvePlayerIdentity } = vi.hoisted(() => ({
  recordUnresolvedPlayerStatRow: vi.fn(),
  resolvePlayerIdentity: vi.fn(),
}));

vi.mock('../../shared/db/prisma', () => ({
  prisma: {},
}));

vi.mock('../../shared/player-identity/playerIdentityResolver', () => ({
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
}));

vi.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: vi.fn(),
  credential: {
    cert: vi.fn(),
  },
  firestore: Object.assign(
    vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          set: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    })),
    {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'server-timestamp'),
      },
    }
  ),
}));

import { processPlayerRow } from '../../etl/processFootywireData';

describe('processPlayerRow quarantine flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKFILL_MODE = 'true';
    delete process.env.OBSERVE_ONLY;
    delete process.env.ETL_OBSERVE_MODE;
  });

  it('observes unresolved identities without writing quarantine rows', async () => {
    process.env.OBSERVE_ONLY = 'true';
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'unresolved',
      candidates: [],
      diagnostics: {
        playerName: 'Mystery Player',
        normalizedPlayerNames: ['mystery player'],
        normalizedTeam: 'western bulldogs',
      },
    });

    const result = await processPlayerRow({
      season: 2026,
      round: 1,
      team: 'Western Bulldogs',
      opposition: 'Carlton',
      player_name: 'Mystery Player',
    });

    expect(result).toBe('observed_quarantined_unresolved');
    expect(recordUnresolvedPlayerStatRow).not.toHaveBeenCalled();
  });

  it('quarantines unresolved identities into Prisma when observe mode is off', async () => {
    resolvePlayerIdentity.mockResolvedValue({
      outcome: 'unresolved',
      candidates: [],
      diagnostics: {
        playerName: 'Mystery Player',
        normalizedPlayerNames: ['mystery player'],
        normalizedTeam: 'western bulldogs',
      },
    });

    const result = await processPlayerRow({
      season: 2026,
      round: 1,
      team: 'Western Bulldogs',
      opposition: 'Carlton',
      player_name: 'Mystery Player',
    });

    expect(result).toBe('quarantined_unresolved');
    expect(recordUnresolvedPlayerStatRow).toHaveBeenCalledOnce();
  });
});
