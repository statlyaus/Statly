import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  getDraftMembershipAccess: vi.fn(),
  ensureReady: vi.fn(),
  buildRoomSnapshot: vi.fn(),
}));

vi.mock('@/server/leagues/membership', () => ({
  getDraftMembershipAccess: dependencies.getDraftMembershipAccess,
}));

vi.mock('@/server/draft/services/DraftClockCoordinator', () => ({
  draftClockCoordinator: { ensureReady: dependencies.ensureReady },
}));

vi.mock('@/server/draft/services/DraftProjectionService', () => ({
  draftProjectionService: { buildRoomSnapshot: dependencies.buildRoomSnapshot },
}));

import {
  DraftAuthorizedReadService,
  DraftReadAccessError,
} from '@/server/draft/services/DraftAuthorizedReadService';

describe('DraftAuthorizedReadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getDraftMembershipAccess.mockResolvedValue({ isMember: true });
  });

  it('returns a LIVE snapshot only after its converged clock revision is ready', async () => {
    dependencies.ensureReady.mockResolvedValue({
      repaired: true,
      receipt: { token: { stateRevision: 8 } },
    });
    dependencies.buildRoomSnapshot.mockResolvedValue({
      revision: 8,
      state: { status: 'LIVE' },
    });

    const snapshot = await new DraftAuthorizedReadService().buildRoomSnapshot('draft-1', 'user-1');

    expect(snapshot).toMatchObject({ revision: 8, state: { status: 'LIVE' } });
    expect(dependencies.ensureReady).toHaveBeenCalledWith('draft-1');
    expect(dependencies.buildRoomSnapshot).toHaveBeenCalledWith('draft-1', 'user-1', 8);
  });

  it('rejects a non-member before attempting clock convergence', async () => {
    dependencies.getDraftMembershipAccess.mockResolvedValue({ isMember: false });

    await expect(
      new DraftAuthorizedReadService().buildRoomSnapshot('draft-1', 'outsider')
    ).rejects.toBeInstanceOf(DraftReadAccessError);

    expect(dependencies.ensureReady).not.toHaveBeenCalled();
    expect(dependencies.buildRoomSnapshot).not.toHaveBeenCalled();
  });
});
