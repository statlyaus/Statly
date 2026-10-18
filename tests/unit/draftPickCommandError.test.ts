import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {},
}));
vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {},
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: vi.fn(),
}));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/devAuth', () => ({ isServerDevelopmentAuthEnabled: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { splitDraftCommandError } from '@/server/draft/api/handlePickCommand';

describe('splitDraftCommandError', () => {
  it('keeps a detail that contains a colon', () => {
    expect(splitDraftCommandError('conflict:Pick slot 3: taken')).toEqual([
      'conflict',
      'Pick slot 3: taken',
    ]);
  });

  it('treats a message without a kind as internal', () => {
    expect(splitDraftCommandError('boom')).toEqual(['internal', 'boom']);
  });
});
