import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminWorkersClient from './AdminWorkersClient';

const workerPayload = {
  success: true,
  data: {
    stats: {
      workerCount: 1,
      totalJobsProcessed: 12,
      totalJobsFailed: 1,
      averageProcessingTime: 250,
      successRate: 0.92,
      workers: [
        {
          workerId: 'worker-1',
          jobsProcessed: 12,
          jobsFailed: 1,
          averageProcessingTime: 250,
          lastActivity: '2026-05-20T10:00:00.000Z',
        },
      ],
    },
    health: {
      healthy: true,
      workers: [{ id: 'worker-1', healthy: true }],
    },
  },
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('AdminWorkersClient degraded states', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows a non-fatal backend outage and retries worker data manually', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: 'Worker backend unavailable' }, false, 503)
      )
      .mockResolvedValue(jsonResponse(workerPayload));

    render(<AdminWorkersClient />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Worker backend unavailable');
    expect(screen.getByText('No workers')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('worker-1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
