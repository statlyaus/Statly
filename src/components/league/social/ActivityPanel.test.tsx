import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SocialMessage } from '@/types/social';

import ActivityPanel from './ActivityPanel';

const activity: SocialMessage = {
  id: 'activity-1',
  leagueId: 'league-1',
  seasonId: 'season-1',
  type: 'system',
  content: 'Alex drafted Jordan Example.',
  author: null,
  relatedEntityId: 'pick-1',
  createdAt: '2026-07-19T10:01:00.000Z',
  moderationStatus: 'active',
  isOwn: false,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ActivityPanel>> = {}) {
  const props: React.ComponentProps<typeof ActivityPanel> = {
    activity: [],
    hasEarlierActivity: false,
    loading: false,
    loadingEarlier: false,
    onRetry: vi.fn(),
    onLoadEarlier: vi.fn(),
    ...overrides,
  };
  return render(<ActivityPanel {...props} />);
}

describe('ActivityPanel', () => {
  it('uses a flat feed presentation in compact mode', () => {
    renderPanel({ compact: true });

    const region = screen.getByRole('region', { name: 'League activity' });
    expect(region).not.toHaveClass('border');
  });

  it('renders an empty state and earlier-activity pagination', async () => {
    const user = userEvent.setup();
    const onLoadEarlier = vi.fn();
    const { rerender } = renderPanel();
    expect(screen.getByText('No league activity yet')).toBeInTheDocument();

    rerender(
      <ActivityPanel
        activity={[activity]}
        hasEarlierActivity
        loading={false}
        loadingEarlier={false}
        onRetry={vi.fn()}
        onLoadEarlier={onLoadEarlier}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Load earlier activity' }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it('offers contextual discussion without making activity part of chat', async () => {
    const user = userEvent.setup();
    const onDiscuss = vi.fn();
    renderPanel({ activity: [activity], onDiscuss });

    expect(screen.getByText('Alex drafted Jordan Example.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discuss' }));
    expect(onDiscuss).toHaveBeenCalledWith(activity);
  });

  it('uses restrained semantic accents with an icon and visible event label', () => {
    const events: SocialMessage[] = [
      activity,
      { ...activity, id: 'activity-2', content: 'Taylor was added to the roster.' },
      { ...activity, id: 'activity-3', content: 'Morgan was dropped from the roster.' },
      { ...activity, id: 'activity-4', content: 'A trade completed between two teams.' },
      { ...activity, id: 'activity-5', content: 'Waiver claim submitted and pending.' },
      { ...activity, id: 'activity-6', content: 'Transaction failed and was reversed.' },
      { ...activity, id: 'activity-7', content: 'Commissioner changed league settings.' },
    ];

    renderPanel({ activity: events });

    const expectations = [
      ['Draft selection', 'draft', 'border-l-brand-bar'],
      ['Player added', 'addition', 'border-l-success'],
      ['Player removed', 'removal', 'border-l-muted-foreground'],
      ['Trade completed', 'trade', 'border-l-primary'],
      ['Waiver pending', 'waiver', 'border-l-warning-text'],
      ['Transaction issue', 'error', 'border-l-destructive-text'],
      ['Commissioner change', 'commissioner', 'border-l-brand-bar'],
    ] as const;

    for (const [label, kind, accent] of expectations) {
      const labelElement = screen.getByText(label);
      expect(labelElement.parentElement?.querySelector('svg')).toBeInTheDocument();
      expect(labelElement.closest('article')).toHaveAttribute('data-activity-kind', kind);
      expect(labelElement.closest('article')).toHaveClass(accent, 'bg-card');
    }
  });
});
