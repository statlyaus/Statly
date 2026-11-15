/**
 * Bloodsucker 9/9 (#1286; US-6, NFR-5, NFR-8): the bite picker's honest states. Success shows only
 * after the server commits; a refusal shows its code; a lock disables every player with the reason.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: fetchMock }));

import { BitePicker, type BitePickerView } from '@/components/league/bloodsucker/BitePicker';

const NOW = '2026-11-14T00:00:00.000Z';
const picker: BitePickerView = {
  biteId: 'bite-1',
  round: 3,
  status: 'OPEN',
  version: 1,
  deadlineAt: '2026-11-15T02:05:00.000Z',
  serverNow: NOW,
  victim: { memberId: 'victim', teamName: 'Brunswick Bats' },
  score: '5-4',
  victimPlayers: [
    { id: 'v-ruc', name: 'Max Gawn', position: 'RUC', club: 'Melbourne', group: 'RUC', z: 1.2 },
    {
      id: 'v-bench',
      name: 'Harris Andrews',
      position: 'DEF',
      club: 'Brisbane',
      group: 'NON_SCORING',
      z: -0.4,
    },
  ],
  returnPlayers: [
    {
      id: 'b-ruc',
      name: 'Tim English',
      position: 'RUC',
      club: 'Western Bulldogs',
      group: 'RUC',
      z: null,
    },
  ],
  autoBitePreview: { takenPlayerId: 'v-ruc', returnedPlayerId: 'b-ruc' },
  blocked: null,
  takenPlayerId: null,
  returnedPlayerId: null,
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function choose() {
  fireEvent.click(screen.getByRole('radio', { name: /Max Gawn/ }));
  fireEvent.click(screen.getByRole('radio', { name: /Tim English/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Take Max Gawn, send back Tim English' }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  fetchMock.mockReset();
});

describe('BitePicker', () => {
  it('shows the countdown as words and previews the auto-bite', () => {
    render(<BitePicker leagueId="league-1" initial={picker} timeZone="Australia/Melbourne" />);

    expect(screen.getByText('Time left: 1 day, 2 hours and 5 minutes.')).toBeInTheDocument();
    expect(screen.getByText(/the system takes/)).toHaveTextContent(
      'the system takes Max Gawn (their highest Statly Z) and sends back Tim English'
    );
    expect(screen.getByRole('radio', { name: /Max Gawn.*Ruck/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Take from Brunswick Bats' })).toBeInTheDocument();
  });

  it('shows saving, then success only after the server commits', async () => {
    let commit: (value: Response) => void = () => undefined;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => (commit = resolve)))
      .mockReturnValueOnce(json(200, { ...picker, status: 'EXECUTED' }));
    render(<BitePicker leagueId="league-1" initial={picker} />);

    choose();

    expect(await screen.findByRole('button', { name: 'Saving the bite…' })).toBeDisabled();
    expect(screen.queryByText(/^Done\./)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ takenPlayerId: 'v-ruc', returnedPlayerId: 'b-ruc' }),
    });

    commit(new Response(JSON.stringify({ status: 'EXECUTED' }), { status: 200 }));
    expect(
      await screen.findByText('Done. You took Max Gawn and sent back Tim English.')
    ).toBeInTheDocument();
  });

  it('names the refusal code when the bite fails', async () => {
    fetchMock
      .mockReturnValueOnce(
        json(409, { code: 'ROUND_IN_PROGRESS', error: 'Round 4 is in progress.' })
      )
      .mockReturnValueOnce(json(200, picker));
    render(<BitePicker leagueId="league-1" initial={picker} />);

    choose();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The bite did not save. A round is in progress (ROUND_IN_PROGRESS). Round 4 is in progress.'
    );
    await waitFor(() => expect(screen.queryByText(/^Done\./)).not.toBeInTheDocument());
  });

  it.each([
    ['EARLIER_BITE_PENDING', 'An earlier bite comes first'],
    ['BITE_SUSPENDED', 'This bite is on hold'],
    ['ROUND_IN_PROGRESS', 'A round is in progress'],
    ['A_CODE_FROM_LATER', 'The server refused this'],
  ])('heads a %s block with what it is, not "Players are locked"', (code, heading) => {
    render(
      <BitePicker
        leagueId="league-1"
        initial={{ ...picker, blocked: { code, message: 'The reason from the server.' } }}
      />
    );

    const status = screen.getByText(/The reason from the server\./);
    expect(status).toHaveTextContent(`${heading} (${code}). The reason from the server.`);
    expect(status).not.toHaveTextContent(/locked/i);
  });

  it('shows a finished bite in a status this build does not know', () => {
    render(<BitePicker leagueId="league-1" initial={{ ...picker, status: 'UNPAIRABLE' }} />);

    expect(screen.getByText('Ended without a swap.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('disables every player with the reason while a round is in progress', () => {
    render(
      <BitePicker
        leagueId="league-1"
        initial={{
          ...picker,
          blocked: { code: 'ROUND_IN_PROGRESS', message: 'Round 4 is in progress.' },
        }}
      />
    );

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(
      screen.getByRole('group', { name: 'Take from Brunswick Bats' })
    ).toHaveAccessibleDescription(expect.stringContaining('Round 4 is in progress.'));
  });
});
