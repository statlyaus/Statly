import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraftControls from '@/components/draft/DraftControls';

vi.mock('@/lib/authenticatedFetch', () => ({
  getAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));

vi.mock('@/components/ui/Modal', () => ({
  // Confirm straight away: this test is about what happens after the commissioner confirms.
  useConfirmation: () => ({
    confirm: ({ onConfirm }: { onConfirm: () => void | Promise<void> }) => void onConfirm(),
    ConfirmationModal: null,
  }),
}));

function refusal(message: string, status: number, code: string) {
  return new Response(
    JSON.stringify({ success: false, error: { message, code }, timestamp: 'now' }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

describe('DraftControls server reasons', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows the server's reason when a pause is refused", async () => {
    fetchMock.mockResolvedValue(
      refusal('Commissioner access required to pause drafts', 403, 'FORBIDDEN')
    );
    render(<DraftControls draftId="draft-1" draftStatus="LIVE" isLeagueOwner />);

    await userEvent.click(screen.getByRole('button', { name: 'Pause draft' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Commissioner access required to pause drafts'
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/draft-1/pause',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it("shows the server's reason when a resume is refused", async () => {
    fetchMock.mockResolvedValue(refusal('Only paused drafts can be resumed', 400, 'BAD_REQUEST'));
    render(<DraftControls draftId="draft-1" draftStatus="PAUSED" isLeagueOwner />);

    await userEvent.click(screen.getByRole('button', { name: 'Resume draft' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Only paused drafts can be resumed')
    );
  });
});
