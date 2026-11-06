import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import WaiverFAABSystem, {
  type WaiverClaimSubmitResult,
} from '@/components/waivers/WaiverFAABSystem';

vi.mock('@/lib/timezone', () => ({
  formatInTimezone: (value: Date | string) => new Date(value).toISOString(),
  getBrowserTimeZone: () => 'Australia/Melbourne',
}));

const player = {
  id: 'player-1',
  name: 'Darcy Cameron',
  team: 'COL',
  position: 'RUC',
  statlyZScore: 6.85,
  stats: { goals: 0.2, tackles: 4.8, inside50s: 1.1 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function placeBid(
  user: ReturnType<typeof userEvent.setup>,
  bid: string
): Promise<HTMLElement> {
  const table = screen.getByRole('table', { name: 'Available waiver players' });
  await user.click(within(table).getByRole('button', { name: 'Claim Darcy Cameron' }));
  const bidInput = within(table).getByLabelText('FAAB bid');
  fireEvent.change(bidInput, { target: { value: bid } });
  await user.click(within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Place bid' })
  );
  return table;
}

describe('WaiverFAABSystem claim submission', () => {
  it('keeps the bid and shows the server error when the claim fails', async () => {
    const user = userEvent.setup();
    const onSubmitClaim = vi.fn(async (): Promise<WaiverClaimSubmitResult> => ({
      ok: false,
      error: 'Insufficient FAAB remaining',
    }));

    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        currentBalance={75}
        totalBudget={100}
        onSubmitClaim={onSubmitClaim}
      />
    );

    const table = await placeBid(user, '12');

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient FAAB remaining');
    expect(onSubmitClaim).toHaveBeenCalledWith(expect.objectContaining({ bidAmount: 12 }));
    expect(within(table).getByLabelText('FAAB bid')).toHaveValue(12);
    expect(
      within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' })
    ).toBeEnabled();
  });

  it('shows a pending state, then the claim the server stored, before resetting the form', async () => {
    const user = userEvent.setup();
    const response = deferred<WaiverClaimSubmitResult>();
    const onSubmitClaim = vi.fn(() => response.promise);

    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        currentBalance={75}
        totalBudget={100}
        onSubmitClaim={onSubmitClaim}
      />
    );

    const table = await placeBid(user, '9');

    const pendingButton = within(table).getByRole('button', {
      name: 'Submit claim for Darcy Cameron',
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveTextContent('Submitting');
    expect(within(table).getByLabelText('FAAB bid')).toHaveValue(9);
    expect(screen.queryByText(/Claim stored/)).toBeNull();

    response.resolve({
      ok: true,
      claim: { id: 'claim-7', playerName: 'Darcy Cameron', bidAmount: 9 },
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Claim stored: Darcy Cameron, bid $9.'
    );
    expect(within(table).queryByLabelText('FAAB bid')).toBeNull();
  });

  it('shows the balance as unavailable and blocks bids when it fails to load', async () => {
    const user = userEvent.setup();
    const onSubmitClaim = vi.fn();

    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        totalBudget={100}
        onSubmitClaim={onSubmitClaim}
      />
    );

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('$100')).toBeNull();

    const table = screen.getByRole('table', { name: 'Available waiver players' });
    await user.click(within(table).getByRole('button', { name: 'Claim Darcy Cameron' }));
    expect(
      within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' })
    ).toBeDisabled();
    expect(within(table).getByText(/FAAB balance is unavailable/)).toBeInTheDocument();
    expect(onSubmitClaim).not.toHaveBeenCalled();
  });

  it('says FAAB is not used in a league with no budget and still allows claims', async () => {
    const user = userEvent.setup();

    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        onSubmitClaim={vi.fn()}
      />
    );

    expect(screen.getByText('Not used')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();

    const table = screen.getByRole('table', { name: 'Available waiver players' });
    await user.click(within(table).getByRole('button', { name: 'Claim Darcy Cameron' }));
    expect(
      within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' })
    ).toBeEnabled();
  });

  it('shows the loading state, not Unavailable, while the first balance load is in flight', async () => {
    const user = userEvent.setup();

    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        balanceStatus="loading"
        onSubmitClaim={vi.fn()}
      />
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(screen.queryByText('Not used')).toBeNull();

    const table = screen.getByRole('table', { name: 'Available waiver players' });
    await user.click(within(table).getByRole('button', { name: 'Claim Darcy Cameron' }));
    expect(
      within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' })
    ).toBeDisabled();
  });

  it('shows Unavailable when the waiver data failed before the league settings loaded', () => {
    render(
      <WaiverFAABSystem
        availablePlayers={[player]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        balanceStatus="failed"
      />
    );

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});
