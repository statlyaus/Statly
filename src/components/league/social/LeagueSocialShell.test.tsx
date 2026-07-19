import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SocialMessage, SocialPost } from '@/types/social';

import LeagueSocialShell from './LeagueSocialShell';

const controller = {
  summary: {
    leagueId: 'league-1',
    seasonId: 'season-1',
    canManage: false,
    canPublish: true,
    standardsAccepted: true,
    mutedUntil: null,
    unread: { chat: 2, board: 3, activity: 4 },
    latestSequence: { chat: 4, board: 7, activity: 9 },
    categories: [],
  },
  messages: [],
  activity: [] as SocialMessage[],
  posts: [] as SocialPost[],
  threads: {},
  messagesCursor: null,
  activityCursor: null,
  postsCursor: null,
  loading: false,
  loadingEarlierMessages: false,
  loadingEarlierActivity: false,
  loadingMorePosts: false,
  sendingMessage: false,
  creatingPost: false,
  error: null,
  submitError: null,
  retry: vi.fn(),
  loadEarlierMessages: vi.fn(),
  loadEarlierActivity: vi.fn(),
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
  it('keeps three panels mounted and exposes keyboard tabs with separate unread labels', async () => {
    const user = userEvent.setup();
    render(<LeagueSocialShell leagueId="league-1" currentUserId="user-1" />);

    const chatTab = screen.getByRole('tab', { name: /chat 2 unread/i });
    const boardTab = screen.getByRole('tab', { name: /message board 3 unread/i });
    const activityTab = screen.getByRole('tab', { name: /activity 4 unread/i });
    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
    const chatComposer = screen.getByRole('textbox', { name: 'Message league chat' });
    await user.type(chatComposer, 'Preserve this draft');

    chatTab.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(boardTab).toHaveFocus());
    expect(boardTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No discussions yet')).toBeInTheDocument();

    await user.keyboard('{End}');
    await waitFor(() => expect(activityTab).toHaveFocus());
    expect(activityTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No league activity yet')).toBeInTheDocument();

    await user.keyboard('{Home}');
    await waitFor(() => expect(chatTab).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Message league chat' })).toHaveValue(
      'Preserve this draft'
    );
  });

  it('supports the compact header contract without removing preferences', () => {
    render(
      <LeagueSocialShell
        leagueId="league-1"
        currentUserId="user-1"
        title="Hidden title"
        showHeader={false}
      />
    );

    expect(screen.queryByRole('heading', { name: 'Hidden title' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Social notification preferences' })
    ).toBeInTheDocument();
  });

  it('marks only latest visible content read and waits while the shell is minimized', async () => {
    const user = userEvent.setup();
    controller.markRead.mockClear();
    const { rerender } = render(
      <LeagueSocialShell leagueId="league-1" currentUserId="user-1" visible={false} />
    );

    await user.click(screen.getByRole('tab', { name: /message board 3 unread/i }));
    await waitFor(() => expect(screen.getByText('No discussions yet')).toBeInTheDocument());
    expect(controller.markRead).not.toHaveBeenCalled();

    rerender(<LeagueSocialShell leagueId="league-1" currentUserId="user-1" visible />);
    await waitFor(() => expect(controller.markRead).toHaveBeenCalledWith('board'));
    expect(controller.markRead).not.toHaveBeenCalledWith('chat');
    expect(controller.markRead).not.toHaveBeenCalledWith('activity');
  });

  it('does not mark the whole board read while viewing one discussion thread', async () => {
    const post: SocialPost = {
      id: 'post-1',
      leagueId: 'league-1',
      seasonId: 'season-1',
      category: { id: 'category-1', key: 'general', name: 'General', position: 1 },
      author: {
        userId: 'user-2',
        displayName: 'Other Member',
        teamName: 'Other Team',
      },
      title: 'One discussion',
      body: 'This is not the whole board.',
      isPinned: false,
      isLocked: false,
      isAnnouncement: false,
      replyCount: 1,
      latestActivityAt: '2026-07-19T10:00:00.000Z',
      createdAt: '2026-07-19T09:00:00.000Z',
      updatedAt: '2026-07-19T10:00:00.000Z',
      moderationStatus: 'active',
      isOwn: false,
    };
    controller.posts = [post];
    controller.threads = {
      'post-1': { items: [], nextCursor: null, loading: false, error: null },
    };
    controller.markRead.mockClear();

    render(
      <LeagueSocialShell
        leagueId="league-1"
        currentUserId="user-1"
        initialView="board"
        initialPostId="post-1"
      />
    );

    expect(await screen.findByRole('heading', { name: 'One discussion' })).toBeInTheDocument();
    await waitFor(() => expect(controller.loadReplies).toHaveBeenCalledWith('post-1'));
    expect(controller.markRead).not.toHaveBeenCalledWith('board');

    controller.posts = [];
    controller.threads = {};
  });

  it('moves focus to Chat after starting a discussion from Activity', async () => {
    const user = userEvent.setup();
    const activity: SocialMessage = {
      id: 'activity-1',
      leagueId: 'league-1',
      seasonId: 'season-1',
      type: 'system',
      content: 'Player drafted',
      author: null,
      createdAt: '2026-07-19T10:00:00.000Z',
      moderationStatus: 'active',
      isOwn: false,
    };
    const onDiscussActivity = vi.fn();
    controller.activity = [activity];

    render(
      <LeagueSocialShell
        leagueId="league-1"
        currentUserId="user-1"
        initialView="activity"
        onDiscussActivity={onDiscussActivity}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Discuss' }));

    expect(onDiscussActivity).toHaveBeenCalledWith(activity);
    await waitFor(() => expect(screen.getByRole('tab', { name: /chat/i })).toHaveFocus());

    controller.activity = [];
  });

  it('removes fixed minimum heights in compact mode', () => {
    render(
      <LeagueSocialShell leagueId="league-1" currentUserId="user-1" compact showHeader={false} />
    );

    const shell = screen.getByLabelText('League social');
    expect(shell).toHaveClass('min-h-0');
    expect(shell).not.toHaveClass('min-h-[36rem]');
    const chatScroller = screen
      .getByRole('textbox', { name: 'Message league chat' })
      .closest('section')
      ?.querySelector('.overflow-y-auto');
    expect(chatScroller).toHaveClass('min-h-0');
    expect(chatScroller).not.toHaveClass('min-h-64');
  });
});
