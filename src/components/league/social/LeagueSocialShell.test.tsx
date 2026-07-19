import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import LeagueSocialShell from './LeagueSocialShell';

const controller = {
  summary: {
    leagueId: 'league-1',
    seasonId: 'season-1',
    canManage: false,
    canPublish: false,
    standardsAccepted: true,
    mutedUntil: null,
    unread: { chat: 2, board: 3 },
    latestSequence: { chat: 4, board: 7 },
    categories: [],
  },
  messages: [],
  posts: [],
  threads: {},
  messagesCursor: null,
  postsCursor: null,
  loading: false,
  loadingEarlierMessages: false,
  loadingMorePosts: false,
  sendingMessage: false,
  creatingPost: false,
  error: null,
  submitError: null,
  retry: vi.fn(),
  loadEarlierMessages: vi.fn(),
  loadMorePosts: vi.fn(),
  sendMessage: vi.fn(),
  createPost: vi.fn(),
  loadReplies: vi.fn(),
  createReply: vi.fn(),
  markRead: vi.fn().mockResolvedValue(undefined),
  postSort: 'latestActivity' as const,
  setPostSort: vi.fn(),
};

vi.mock('./useLeagueSocial', () => ({
  useLeagueSocial: () => controller,
}));

describe('LeagueSocialShell', () => {
  it('exposes chat and board as keyboard-navigable tabs with separate unread labels', async () => {
    const user = userEvent.setup();
    render(<LeagueSocialShell leagueId="league-1" currentUserId="user-1" />);

    const chatTab = screen.getByRole('tab', { name: /chat 2 unread/i });
    const boardTab = screen.getByRole('tab', { name: /message board 3 unread/i });
    expect(chatTab).toHaveAttribute('aria-selected', 'true');

    chatTab.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(boardTab).toHaveFocus());
    expect(boardTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No discussions yet')).toBeInTheDocument();
  });
});
