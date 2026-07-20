import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SocialMessage } from '@/types/social';

import LeagueChatPanel from './LeagueChatPanel';

const memberMessage: SocialMessage = {
  id: 'message-1',
  leagueId: 'league-1',
  seasonId: 'season-1',
  type: 'member',
  content: 'Review https://statly.dev/trade before voting.',
  author: {
    userId: 'user-1',
    memberId: 'member-1',
    displayName: 'Alex Smith',
    teamName: 'Smith Squad',
  },
  createdAt: '2026-07-19T10:00:00.000Z',
  moderationStatus: 'active',
  isOwn: false,
};

const systemMessage: SocialMessage = {
  ...memberMessage,
  id: 'message-2',
  type: 'system',
  content: 'Player drafted',
  author: null,
  createdAt: '2026-07-19T10:01:00.000Z',
};

const gifMessage: SocialMessage = {
  ...memberMessage,
  id: 'message-giphy',
  content: '',
  gif: { provider: 'giphy', id: 'xT9IgG50Fb7Mi0prBC' },
};

function renderPanel(messages: SocialMessage[] = []) {
  return render(
    <LeagueChatPanel
      messages={messages}
      hasEarlierMessages={false}
      loading={false}
      loadingEarlier={false}
      sending={false}
      canPublish
      canManage={false}
      onRetry={vi.fn()}
      onLoadEarlier={vi.fn()}
      onSend={vi.fn()}
      onReport={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe('LeagueChatPanel', () => {
  it('renders the empty state and an accessible composer', () => {
    renderPanel();
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message league chat' })).toHaveAttribute(
      'maxlength',
      '1000'
    );
  });

  it('renders safe external links and keeps system activity out of member chat', () => {
    renderPanel([memberMessage, systemMessage]);
    expect(screen.getByRole('link', { name: 'https://statly.dev/trade' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
    expect(screen.queryByText('Player drafted')).not.toBeInTheDocument();
    expect(screen.getByText('Alex Smith')).toBeInTheDocument();
    expect(screen.getByText('Smith Squad')).toBeInTheDocument();
  });

  it('renders a durable GIPHY fallback when the Web SDK key is not configured', async () => {
    renderPanel([gifMessage]);

    expect(await screen.findByRole('link', { name: 'View GIF on GIPHY' })).toHaveAttribute(
      'href',
      'https://giphy.com/gifs/xT9IgG50Fb7Mi0prBC'
    );
  });

  it('does not resolve or render GIF media after a message is removed', () => {
    renderPanel([
      {
        ...gifMessage,
        deletedAt: '2026-07-19T10:05:00.000Z',
        moderationStatus: 'removed',
      },
    ]);

    expect(screen.getByText('Message removed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /GIF/i })).not.toBeInTheDocument();
  });

  it('sends and clears structured discussion context only after a successful message', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onClearComposerContext = vi.fn();
    render(
      <LeagueChatPanel
        messages={[]}
        hasEarlierMessages={false}
        loading={false}
        loadingEarlier={false}
        sending={false}
        canPublish
        canManage={false}
        composerContext={{
          type: 'player',
          id: 'player-1',
          title: 'Jordan Example',
          subtitle: 'MID · Statly United',
          metadata: { status: 'Available' },
        }}
        onClearComposerContext={onClearComposerContext}
        onRetry={vi.fn()}
        onLoadEarlier={vi.fn()}
        onSend={onSend}
        onReport={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Message league chat' }), 'Worth a look');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith({
      content: 'Worth a look',
      context: expect.objectContaining({ type: 'player', id: 'player-1' }),
    });
    expect(onClearComposerContext).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Jordan Example')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });
});
