import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger }));

import { errorResponse } from '@/lib/apiResponse';

describe('errorResponse observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not log expected client outcomes as server failures', async () => {
    const response = errorResponse('Forbidden', 403, 'FORBIDDEN');

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { message: 'Forbidden', code: 'FORBIDDEN' },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs unexpected server failures with structured context', () => {
    const cause = new Error('connection refused');

    errorResponse('Database unavailable', 503, 'SERVICE_UNAVAILABLE', undefined, cause);

    expect(logger.error).toHaveBeenCalledWith('API Error (503): Database unavailable', cause, {
      code: 'SERVICE_UNAVAILABLE',
      details: undefined,
    });
  });
});
