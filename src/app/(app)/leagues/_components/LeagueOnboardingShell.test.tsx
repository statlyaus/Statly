import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LeagueOnboardingShell } from './LeagueOnboardingShell';

describe('LeagueOnboardingShell', () => {
  it('renders a guided league onboarding frame with actions and guidance', () => {
    render(
      <LeagueOnboardingShell
        eyebrow="League setup"
        title="Create your league"
        description="Set the format, invite managers, and move straight into draft setup."
        primaryAction={{ href: '/leagues/new', label: 'Create league', active: true }}
        secondaryAction={{ href: '/leagues/join', label: 'Join league' }}
        steps={[
          { title: 'Choose format', description: 'Pick teams and scoring before inviting managers.' },
          { title: 'Draft next', description: 'After setup you will land in the draft workspace.' },
        ]}
        summary={[
          { label: 'Typical setup', value: '2 min' },
          { label: 'Next screen', value: 'Draft hub' },
        ]}
      >
        <form aria-label="Create league form">
          <button type="submit">Create league</button>
        </form>
      </LeagueOnboardingShell>
    );

    expect(screen.getByRole('heading', { name: 'Create your league' })).toBeVisible();
    expect(
      screen.getByText('Set the format, invite managers, and move straight into draft setup.')
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
    expect(screen.getByText('Choose format')).toBeVisible();
    expect(screen.getByText('Draft next')).toBeVisible();
    expect(screen.getByText('Typical setup')).toBeVisible();
    expect(screen.getByText('2 min')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Create league form' })).toBeVisible();
  });
});
