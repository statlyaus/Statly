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
import { formatTradeDateTime } from './tradeDateFormatting';

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
    mode: 'proposal' as const,
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
    expect(screen.getByRole('button', { name: 'Send proposal to AFL Legends' })).toHaveClass(
      'h-11'
    );
    expect(screen.queryByText(/injur|available to play/i)).not.toBeInTheDocument();
  });

  it('exposes a recipient-specific, programmatically focusable checkpoint heading', () => {
    const headingRef = createRef<HTMLHeadingElement>();
    render(<TradeReviewStep {...createProps({ headingRef })} />);

    const heading = screen.getByRole('heading', { level: 4, name: 'Send to AFL Legends?' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveClass('focus-visible:ring-[3px]');
    headingRef.current?.focus();
    expect(heading).toHaveFocus();
  });

  it('renders the four checkpoint facts with selected players, expiry, and deadline', () => {
    const deadline = formatTradeDateTime(rules.deadline!);
    const { rerender } = render(
      <TradeReviewStep {...createProps({ rules: { ...rules, offerExpiryHours: 1 } })} />
    );

    const checkpoint = screen.getByRole('region', { name: 'Send to AFL Legends?' });
    const summary = checkpoint.querySelector('dl');
    expect(summary).not.toBeNull();
    expect(Array.from(summary!.querySelectorAll('dt')).map((term) => term.textContent)).toEqual([
      'You send',
      'You receive',
      'Expires',
      'Deadline',
    ]);
    expect(summary!.querySelectorAll('dd')).toHaveLength(4);

    const rows = Array.from(summary!.querySelectorAll('dt')).map((term) => term.parentElement);
    expect(rows[0]).toHaveTextContent('Riley Rocker');
    expect(rows[0]).toHaveTextContent('Finley Forward');
    expect(rows[1]).toHaveTextContent('Alex Legend');
    expect(rows[1]).toHaveTextContent('Casey Legend');
    expect(rows[2]).toHaveTextContent(/1 hour after sending/i);
    expect(rows[3]).toHaveTextContent(deadline);

    rerender(
      <TradeReviewStep
        {...createProps({
          rules: { ...rules, deadline: null, offerExpiryHours: 2 },
        })}
      />
    );
    const updatedSummary = screen
      .getByRole('region', { name: 'Send to AFL Legends?' })
      .querySelector('dl');
    const updatedRows = Array.from(updatedSummary!.querySelectorAll('dt')).map(
      (term) => term.parentElement
    );
    expect(updatedRows[2]).toHaveTextContent(/2 hours after sending/i);
    expect(updatedRows[3]).toHaveTextContent('No league deadline');
  });

  it('describes the acceptance consequence for each league review policy', () => {
    const { rerender } = render(<TradeReviewStep {...createProps()} />);

    const immediateCheckpoint = screen.getByRole('region', { name: 'Send to AFL Legends?' });
    expect(immediateCheckpoint).toHaveTextContent(/AFL Legends accepts/i);
    expect(immediateCheckpoint).toHaveTextContent(/completes immediately/i);
    expect(immediateCheckpoint).toHaveTextContent(/Statly rechecks/i);

    rerender(
      <TradeReviewStep
        {...createProps({
          rules: { ...rules, reviewMode: 'admin' },
        })}
      />
    );
    const adminCheckpoint = screen.getByRole('region', { name: 'Send to AFL Legends?' });
    expect(adminCheckpoint).toHaveTextContent(/AFL Legends accepts/i);
    expect(adminCheckpoint).toHaveTextContent(/commissioner review/i);
    expect(adminCheckpoint).toHaveTextContent(/only after approval/i);
    expect(adminCheckpoint).not.toHaveTextContent(/completes immediately/i);

    rerender(
      <TradeReviewStep
        {...createProps({
          rules: { ...rules, reviewMode: 'veto', reviewHours: 24, vetoThreshold: 3 },
        })}
      />
    );
    const vetoCheckpoint = screen.getByRole('region', { name: 'Send to AFL Legends?' });
    expect(vetoCheckpoint).toHaveTextContent(/AFL Legends accepts/i);
    expect(vetoCheckpoint).toHaveTextContent(/24.?hour.*veto/i);
    expect(vetoCheckpoint).toHaveTextContent(/3.*votes?/i);
  });

  it('shows only meaningful package position deltas with a scope disclaimer', () => {
    render(<TradeReviewStep {...createProps()} />);

    const positionChange = screen.getByRole('region', { name: 'Package position change' });
    expect(
      within(positionChange).getByRole('heading', {
        level: 5,
        name: 'Package position change',
      })
    ).toHaveClass('text-base');
    expect(within(positionChange).getByText('MID −1')).toBeInTheDocument();
    expect(within(positionChange).getByText('DEF +1')).toBeInTheDocument();
    expect(within(positionChange).queryByText('FWD 0')).not.toBeInTheDocument();
    expect(
      within(positionChange).getByText(/Package balance only; not a lineup projection/i)
    ).toBeInTheDocument();
  });

  it('summarizes an all-zero package position change without an empty delta list', () => {
    const positionNeutralPlayers: TradePlayerDto[] = [
      { id: 'receive-mid', name: 'Morgan Mid', club: 'Essendon Bombers', position: 'MID' },
      { id: 'receive-fwd', name: 'Frank Forward', club: 'Fremantle Dockers', position: 'FWD' },
    ];
    render(
      <TradeReviewStep
        {...createProps({
          receivingPlayers: positionNeutralPlayers,
          receivingPlayerIds: positionNeutralPlayers.map(({ id }) => id),
        })}
      />
    );

    const positionChange = screen.getByRole('region', { name: 'Package position change' });
    expect(within(positionChange).getByText('No positional balance change')).toBeInTheDocument();
    expect(
      within(positionChange).queryByRole('list', { name: 'Position count changes' })
    ).not.toBeInTheDocument();
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
    render(
      <TradeReviewStep
        {...createProps({
          mode: 'counteroffer',
          onBack,
          onSubmit,
          onCancelCounter,
        })}
      />
    );

    const back = screen.getByRole('button', { name: 'Back to edit' });
    expect(screen.getByRole('heading', { name: 'Send to AFL Legends?' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Send counteroffer to AFL Legends' });
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

  it('keeps submission errors neutral without obscuring the checkpoint actions', () => {
    render(
      <TradeReviewStep
        {...createProps({
          error: 'The roster changed. Review the proposal again.',
        })}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The roster changed. Review the proposal again.');
    expect(alert).toHaveClass('bg-[color:var(--trade-warning-soft)]');
    expect(alert.className).not.toMatch(/trade-(?:send|receive|positive|negative)/);
    expect(screen.getByRole('textbox', { name: 'Message (optional)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back to edit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send proposal to AFL Legends' })).toBeEnabled();
  });

  it('disables review controls and keeps the pending label recipient-specific while sending', () => {
    render(
      <TradeReviewStep
        {...createProps({
          mode: 'counteroffer',
          isSubmitting: true,
          onCancelCounter: vi.fn(),
        })}
      />
    );

    expect(screen.getByRole('textbox', { name: 'Message (optional)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel counteroffer' })).toBeDisabled();
    const sending = screen.getByRole('button', {
      name: 'Sending counteroffer to AFL Legends…',
    });
    expect(sending).toBeDisabled();
    expect(sending).toHaveClass('h-11');
    expect(screen.getByRole('region', { name: 'Send to AFL Legends?' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
  });

  it('keeps final actions in logical mobile order and a two-column responsive group', () => {
    render(<TradeReviewStep {...createProps()} />);

    const back = screen.getByRole('button', { name: 'Back to edit' });
    const submit = screen.getByRole('button', { name: 'Send proposal to AFL Legends' });
    const actions = back.parentElement;
    expect(actions).toBe(submit.parentElement);
    expect(actions).toHaveClass('grid', 'sm:grid-cols-2');
    expect(back.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses unique accessible heading relationships across multiple review instances', () => {
    render(
      <>
        <TradeReviewStep {...createProps()} />
        <TradeReviewStep {...createProps()} />
      </>
    );

    const headings = screen.getAllByRole('heading', { level: 4, name: 'Send to AFL Legends?' });
    const regions = screen.getAllByRole('region', { name: 'Send to AFL Legends?' });
    const headingIds = headings.map(({ id }) => id);
    expect(new Set(headingIds).size).toBe(2);
    expect(regions.map((region) => region.getAttribute('aria-labelledby'))).toEqual(headingIds);
    headingIds.forEach((id) => expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1));
  });
});
