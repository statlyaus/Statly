import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeLeague: undefined as string | undefined,
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'active_league' && mocks.activeLeague ? { value: mocks.activeLeague } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import RostersPage from '@/app/(app)/rosters/page';

describe('/rosters', () => {
  beforeEach(() => {
    mocks.activeLeague = undefined;
    mocks.redirect.mockClear();
  });

  it("sends the user to the active league's roster tab", async () => {
    mocks.activeLeague = 'league/1';

    await expect(RostersPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/leagues/league%2F1?tab=roster');
  });

  it('sends the user to their leagues when no league is active', async () => {
    await expect(RostersPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard#leagues');
  });
});
