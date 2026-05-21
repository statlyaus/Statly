import { describe, expect, it, vi } from 'vitest';

const {
  draftCompletedFunction,
  draftRepairFunction,
  getHandler,
  inngestClient,
  postHandler,
  putHandler,
  serveMock,
  tradeVetoWindowSweepFunction,
} = vi.hoisted(() => ({
  draftCompletedFunction: { id: 'draft-completed-follow-up' },
  draftRepairFunction: { id: 'draft-repair-follow-up' },
  getHandler: vi.fn(),
  inngestClient: { id: 'statly' },
  postHandler: vi.fn(),
  putHandler: vi.fn(),
  serveMock: vi.fn(() => ({
    GET: getHandler,
    POST: postHandler,
    PUT: putHandler,
  })),
  tradeVetoWindowSweepFunction: { id: 'trade-veto-window-sweep' },
}));

vi.mock('inngest/next', () => ({
  serve: serveMock,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: inngestClient,
}));

vi.mock('@/server/inngest/functions/draftCompleted', () => ({
  draftCompletedFunction,
  draftRepairFunction,
}));

vi.mock('@/server/inngest/functions/tradeVetoWindowSweep', () => ({
  tradeVetoWindowSweepFunction,
}));

describe('/api/inngest route wiring', () => {
  it('exports handlers returned by serve with the configured client and functions', async () => {
    const route = await import('./route');

    expect(serveMock).toHaveBeenCalledWith({
      client: inngestClient,
      functions: [draftCompletedFunction, draftRepairFunction, tradeVetoWindowSweepFunction],
    });
    expect(route.runtime).toBe('nodejs');
    expect(route.GET).toBe(getHandler);
    expect(route.POST).toBe(postHandler);
    expect(route.PUT).toBe(putHandler);
  });
});
