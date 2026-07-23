import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  TradePlayerDto,
  TradeRulesDto,
  TradeTeamDto,
} from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeReviewStep } from './TradeReviewStep';

const sendingPlayers: TradePlayerDto[] = [
  { id: 'send-mid', name: 'Riley Rocker', club: 'Richmond Tigers', position: 'MID' },
  { id: 'send-fwd', name: 'Finley Forward', club: 'Carlton Blues', position: 'FWD' },
];
const receivingPlayers: TradePlayerDto[] = [
  { id: 'receive-fwd', name: 'Alex Legend', club: 'Adelaide Crows', position: 'FWD' },
  { id: 'receive-def', name: 'Casey Legend', club: 'Collingwood Magpies', position: 'DEF' },
];

const viewerTeam: TradeTeamDto = {
  memberId: 'viewer',
  teamName: 'Robbo Rockers',
  teamLogoUrl: null,
  isViewer: true,
  players: sendingPlayers,
};
const partnerTeam: TradeTeamDto = {
  memberId: 'partner',
  teamName: 'AFL Legends',
  teamLogoUrl: null,
  isViewer: false,
  players: receivingPlayers,
};
const rules: TradeRulesDto = {
  limit: 10,
  reviewMode: 'none',
  deadline: '2026-08-15T12:00:00.000Z',
  offerExpiryHours: 2,
  reviewHours: 24,
  vetoThreshold: 3,
};
const playerStats: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [],
  playersById: {},
};

function createProps(overrides: Partial<React.ComponentProps<typeof TradeReviewStep>> = {}) {
  return {
    viewerTeam,
    partnerTeam,
    sendingPlayers,
    receivingPlayers,
    sendingPlayerIds: sendingPlayers.map(({ id }) => id),
    receivingPlayerIds: receivingPlayers.map(({ id }) => id),
    message: 'A balanced offer',
    rules,
    playerStats,
    isSubmitting: false,
    error: null,
    headingRef: createRef<HTMLHeadingElement>(),
    onMessageChange: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe('TradeReviewStep', () => {
  it('renders symmetric package cards with team, player, canonical club, and position identity', () => {
    render(<TradeReviewStep {...createProps()} />);

    const sendingPackage = screen.getByRole('region', { name: 'You send package' });
    const receivingPackage = screen.getByRole('region', { name: 'You receive package' });
    expect(within(sendingPackage).getByRole('heading', { level: 5, name: 'You send' })).toHaveClass(
      'text-base'
    );
    expect(within(sendingPackage).getByText('Robbo Rockers')).toBeInTheDocument();
    expect(within(sendingPackage).getByText('Riley Rocker')).toBeInTheDocument();
    expect(within(sendingPackage).getByText(/RIC · Richmond · MID/)).toBeInTheDocument();
    expect(
      within(receivingPackage).getByRole('heading', { level: 5, name: 'You receive' })
    ).toHaveClass('text-base');
    expect(within(receivingPackage).getByText('AFL Legends')).toBeInTheDocument();
    expect(within(receivingPackage).getByText('Alex Legend')).toBeInTheDocument();
    expect(within(receivingPackage).getByText(/ADL · Adelaide · FWD/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 5, name: 'Package comparison' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send proposal' })).toHaveClass('h-11');
    expect(screen.queryByText(/injur|available to play/i)).not.toBeInTheDocument();
  });

  it('exposes a programmatically focusable review heading', () => {
    const headingRef = createRef<HTMLHeadingElement>();
    render(<TradeReviewStep {...createProps({ headingRef })} />);

    const heading = screen.getByRole('heading', { level: 4, name: 'Review trade proposal' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveClass('focus-visible:ring-[3px]');
    expect(heading).toHaveClass('text-lg');
    headingRef.current?.focus();
    expect(heading).toHaveFocus();
  });

  it('formats the league deadline and pluralizes offer expiry', () => {
    const deadline = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(rules.deadline!));
    const { rerender } = render(
      <TradeReviewStep {...createProps({ rules: { ...rules, offerExpiryHours: 1 } })} />
    );

    expect(screen.getByText(deadline)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Expires 1 hour after sending or at the league deadline, whichever comes first'
      )
    ).toBeInTheDocument();

    rerender(
      <TradeReviewStep
        {...createProps({
          rules: { ...rules, deadline: null, offerExpiryHours: 2 },
        })}
      />
    );
    expect(screen.getByText('No league deadline')).toBeInTheDocument();
    expect(screen.getByText('Expires 2 hours after sending')).toBeInTheDocument();
  });

  it('shows neutral package position deltas, including zero, with a scope disclaimer', () => {
    render(<TradeReviewStep {...createProps()} />);

    const positionChange = screen.getByRole('region', { name: 'Package position change' });
    expect(
      within(positionChange).getByRole('heading', {
        level: 5,
        name: 'Package position change',
      })
    ).toHaveClass('text-base');
    expect(within(positionChange).getByText('MID −1')).toBeInTheDocument();
    expect(within(positionChange).getByText('FWD 0')).toBeInTheDocument();
    expect(within(positionChange).getByText('DEF +1')).toBeInTheDocument();
    expect(
      within(positionChange).getByText(/Package balance only; not a lineup projection/i)
    ).toBeInTheDocument();
  });

  it('keeps the optional message controlled with help text, limit, and count', () => {
    const onMessageChange = vi.fn();
    render(<TradeReviewStep {...createProps({ message: 'Hello', onMessageChange })} />);

    const message = screen.getByRole('textbox', { name: 'Message (optional)' });
    expect(message).toHaveValue('Hello');
    expect(message).toHaveAttribute('maxlength', '1000');
    expect(message).toHaveAccessibleDescription('Add context for the other team. 5 / 1000');
    fireEvent.change(message, { target: { value: 'A fair swap' } });
    expect(onMessageChange).toHaveBeenCalledWith('A fair swap');
  });

  it('wires edit, submit, and optional counteroffer actions without transport concerns', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSubmit = vi.fn();
    const onCancelCounter = vi.fn();
    render(<TradeReviewStep {...createProps({ onBack, onSubmit, onCancelCounter })} />);

    const back = screen.getByRole('button', { name: 'Back to edit' });
    const submit = screen.getByRole('button', { name: 'Send counteroffer' });
    const cancel = screen.getByRole('button', { name: 'Cancel counteroffer' });
    expect(back).toHaveClass('h-11');
    expect(submit).toHaveClass('h-11');
    await user.click(back);
    await user.click(submit);
    await user.click(cancel);
    expect(onBack).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onCancelCounter).toHaveBeenCalledOnce();
  });

  it('uses a neutral alert and disables review controls while sending', () => {
    render(
      <TradeReviewStep
        {...createProps({
          isSubmitting: true,
          error: 'The roster changed. Review the proposal again.',
          onCancelCounter: vi.fn(),
        })}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The roster changed. Review the proposal again.');
    expect(alert).toHaveClass('bg-[color:var(--trade-warning-soft)]');
    expect(alert.className).not.toMatch(/trade-(?:send|receive|positive|negative)/);
    expect(screen.getByRole('textbox', { name: 'Message (optional)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel counteroffer' })).toBeDisabled();
    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    expect(sending).toHaveClass('h-11');
  });

  it('uses unique accessible heading relationships across multiple review instances', () => {
    render(
      <>
        <TradeReviewStep {...createProps()} />
        <TradeReviewStep {...createProps()} />
      </>
    );

    const headings = screen.getAllByRole('heading', { level: 4, name: 'Review trade proposal' });
    const regions = screen.getAllByRole('region', { name: 'Review trade proposal' });
    const headingIds = headings.map(({ id }) => id);
    expect(new Set(headingIds).size).toBe(2);
    expect(regions.map((region) => region.getAttribute('aria-labelledby'))).toEqual(headingIds);
    headingIds.forEach((id) => expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1));
  });
});
