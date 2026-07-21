import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SocialBoardCategory, SocialPost } from '@/types/social';

import MessageBoardPanel from './MessageBoardPanel';

const category: SocialBoardCategory = {
  id: 'category-1',
  key: 'general',
  name: 'General',
  position: 1,
};

const announcement: SocialPost = {
  id: 'post-1',
  leagueId: 'league-1',
  seasonId: 'season-1',
  category,
  author: {
    userId: 'commissioner-1',
    displayName: 'Commissioner',
    teamName: 'League Office',
  },
  title: 'Official league update',
  body: 'Important details for every manager.',
  isPinned: true,
  isLocked: true,
  isAnnouncement: true,
  replyCount: 2,
  latestActivityAt: '2026-07-20T10:00:00.000Z',
  createdAt: '2026-07-20T09:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  moderationStatus: 'active',
  isOwn: false,
};

function renderBoard(overrides: Partial<React.ComponentProps<typeof MessageBoardPanel>> = {}) {
  return render(
    <MessageBoardPanel
      posts={[announcement]}
      categories={[category]}
      loading={false}
      loadingMore={false}
      creating={false}
      hasMore={false}
      canPublish
      canManage
      onRetry={vi.fn()}
      onLoadMore={vi.fn()}
      onSelectPost={vi.fn()}
      onCreatePost={vi.fn()}
      sort="latestActivity"
      onSortChange={vi.fn()}
      {...overrides}
    />
  );
}

describe('MessageBoardPanel colour hierarchy', () => {
  it('distinguishes announcements, pinned posts, and locked posts with labels and semantic tokens', () => {
    renderBoard();

    expect(screen.getByRole('button', { name: /open discussion/i })).toHaveClass(
      'border-l-social-brand-strong',
      'bg-social-surface'
    );
    expect(screen.getByText('Announcement')).toHaveClass(
      'bg-social-brand-strong',
      'text-social-brand-foreground'
    );
    expect(screen.getByText('Pinned')).toHaveClass('bg-social-brand-soft');
    expect(screen.getByText('Locked')).toHaveClass('bg-social-surface-subtle');
  });

  it('gives unavailable publishing an explicit disabled colour state', () => {
    renderBoard({ canPublish: false });

    expect(screen.getByRole('button', { name: 'New post' })).toHaveClass(
      'disabled:bg-social-disabled-bg',
      'disabled:text-social-disabled-text'
    );
  });
});
