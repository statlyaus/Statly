import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LeagueSetupChecklist } from './LeagueSetupChecklist';

describe('LeagueSetupChecklist', () => {
  it('renders setup progress, links, and inline actions', async () => {
    const onCopyInvite = vi.fn();
    const user = userEvent.setup();

    render(
      <LeagueSetupChecklist
        title="Finish league setup"
        description="Complete the essentials before draft night."
        steps={[
          {
            id: 'basics',
            title: 'League basics',
            detail: 'Name and scoring format are saved.',
            complete: true,
            action: { label: 'Open settings', href: '/leagues/league-1?tab=settings' },
          },
          {
            id: 'invites',
            title: 'Invite managers',
            detail: 'Share the invite link with your competition.',
            complete: false,
            action: { label: 'Copy invite link', onClick: onCopyInvite },
          },
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Finish league setup' })).toBeVisible();
    expect(screen.getByText('Complete')).toBeVisible();
    expect(screen.getByText('Needs attention')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=settings'
    );

    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(onCopyInvite).toHaveBeenCalledTimes(1);
  });
});
