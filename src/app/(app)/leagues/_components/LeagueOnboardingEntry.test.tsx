import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeagueOnboardingEntry } from './LeagueOnboardingEntry';

describe('LeagueOnboardingEntry', () => {
  it('renders create and join actions with guided copy', () => {
    render(
      <LeagueOnboardingEntry
        title="Start your league workspace"
        description="Create a competition or join one with an invite code."
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Start your league workspace' })
    ).toBeVisible();
    expect(screen.getByText('Create a competition or join one with an invite code.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
  });

  it('surfaces retryable errors without removing onboarding actions', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(
      <LeagueOnboardingEntry
        title="League list unavailable"
        description="Try again or continue by creating or joining a league."
        error={{
          title: 'Failed to load leagues',
          message: 'HTTP 500',
          retryLabel: 'Retry',
          onRetry,
        }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load leagues');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Create league' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Join league' })).toBeVisible();
  });
});
