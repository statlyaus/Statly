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
      'The bite did not save (ROUND_IN_PROGRESS). Round 4 is in progress.'
    );
    await waitFor(() => expect(screen.queryByText(/^Done\./)).not.toBeInTheDocument());
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
