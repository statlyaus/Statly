/**
 * #1343 (BR-35, E1, NFR-5, NFR-8): the commissioner's cancel and redo control. The reason is
 * mandatory and labelled, every refusal shows its code and the server's message, and success shows
 * only after the server commits.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: fetchMock }));

import {
  BiteCommissionerPanel,
  type BiteReviewView,
} from '@/components/league/bloodsucker/BiteCommissionerPanel';

const player = (id: string, name: string) => ({ id, name, position: 'MID', club: 'GWS' });
const review: BiteReviewView = {
  biteId: 'bite-1',
  round: 3,
  status: 'EXECUTED',
  bloodsucker: { memberId: 'bs', teamName: 'Night Shift' },
  victim: { memberId: 'victim', teamName: 'Brunswick Bats' },
  takenPlayer: { id: 'v-1', name: 'Max Gawn' },
  returnedPlayer: { id: 'b-1', name: 'Tim English' },
  cancelledReason: null,
  actions: ['cancel', 'redo'],
  refusal: null,
  victimPlayers: [player('v-1', 'Max Gawn'), player('v-2', 'Harris Andrews')],
  returnPlayers: [player('b-1', 'Tim English'), player('b-2', 'Sam Darcy')],
};
const ENDPOINT = '/api/leagues/league-1/bites/bite-1/commissioner';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const posted = () =>
  JSON.parse(
    String(
      (
        fetchMock.mock.calls.find(
          ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
        )?.[1] as RequestInit
      ).body
    )
  ) as Record<string, unknown>;
const reason = () => screen.getByRole('textbox', { name: /Reason/ });

beforeEach(() => {
  fetchMock.mockReset();
});

describe('BiteCommissionerPanel', () => {
  it('says what happened and offers cancel and redo on an executed bite', () => {
    render(<BiteCommissionerPanel leagueId="league-1" initial={review} />);

    expect(
      screen.getByRole('heading', { level: 1, name: "Night Shift's bite on Brunswick Bats" })
    ).toBeInTheDocument();
    expect(screen.getByText(/took Max Gawn and sent back Tim English/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cancel the bite/ })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Redo it with different players/ })
    ).toBeInTheDocument();
    expect(reason()).toBeRequired();
    expect(reason()).toHaveAccessibleDescription(expect.stringContaining('500 characters'));
  });

  it('refuses to send without a reason, says so, and moves focus to the reason', () => {
    render(<BiteCommissionerPanel leagueId="league-1" initial={review} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel the bite' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not saved. Check what you entered (INVALID_INPUT). Give a reason'
    );
    expect(reason()).toHaveFocus();
    expect(reason()).toBeInvalid();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels with the reason and shows success only after the server commits', async () => {
    let commit: (value: Response) => void = () => undefined;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => (commit = resolve)))
      .mockReturnValueOnce(
        json(200, {
          ...review,
          status: 'CANCELLED',
          actions: [],
          cancelledReason: 'Scored with the wrong stats.',
          refusal: { code: 'BITE_NOT_OPEN', message: 'This bite is finished.' },
        })
      );
    render(<BiteCommissionerPanel leagueId="league-1" userId="user-1" initial={review} />);

    fireEvent.change(reason(), { target: { value: '  Scored with the wrong stats.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the bite' }));

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.queryByText(/^Done\./)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
      'user-1'
    );
    expect(posted()).toEqual({ action: 'cancel', reason: 'Scored with the wrong stats.' });

    commit(
      new Response(JSON.stringify({ biteId: 'bite-1', status: 'CANCELLED' }), { status: 200 })
    );

    expect(await screen.findByText(/^Done\. The bite is cancelled/)).toBeInTheDocument();
    // The reloaded review has nothing left to do, so the form goes.
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(screen.getByText('Cancelled.')).toBeInTheDocument();
    expect(screen.getByText(/Scored with the wrong stats\./)).toBeInTheDocument();
  });

  it('redoes a bite with a new pair, and asks for both players first', async () => {
    fetchMock.mockReturnValueOnce(json(200, { biteId: 'bite-1' })).mockReturnValueOnce(
      json(200, {
        ...review,
        takenPlayer: { id: 'v-2', name: 'Harris Andrews' },
        returnedPlayer: { id: 'b-2', name: 'Sam Darcy' },
      })
    );
    render(<BiteCommissionerPanel leagueId="league-1" initial={review} />);

    fireEvent.click(screen.getByRole('radio', { name: /Redo it with different players/ }));
    fireEvent.change(reason(), { target: { value: 'Wrong player taken.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redo the bite' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check what you entered (INVALID_INPUT). Choose one player to take and one to send back.'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Take from Brunswick Bats' }), {
      target: { value: 'v-2' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Send back from Night Shift' }), {
      target: { value: 'b-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Redo the bite' }));

    expect(await screen.findByText(/^Done\. The bite is redone/)).toBeInTheDocument();
    expect(posted()).toEqual({
      action: 'redo',
      reason: 'Wrong player taken.',
      takenPlayerId: 'v-2',
      returnedPlayerId: 'b-2',
    });
    expect(
      await screen.findByText(/took Harris Andrews and sent back Sam Darcy/)
    ).toBeInTheDocument();
  });

  it.each([
    [409, 'ROUND_IN_PROGRESS', 'Round 4 is in progress.', 'A round is in progress'],
    [403, 'FORBIDDEN', 'You are part of this bite.', 'You cannot do this'],
    [409, 'A_CODE_FROM_LATER', 'Something new.', 'The server refused this'],
  ])('shows a %s %s refusal with its code and message', async (status, code, error, heading) => {
    fetchMock
      .mockReturnValueOnce(json(status, { code, error }))
      .mockReturnValueOnce(json(200, review));
    render(<BiteCommissionerPanel leagueId="league-1" initial={review} />);

    fireEvent.change(reason(), { target: { value: 'A reason.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the bite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Not saved. ${heading} (${code}). ${error}`
    );
    expect(screen.queryByText(/^Done\./)).not.toBeInTheDocument();
    expect(reason()).toHaveValue('A reason.');
  });

  it('says honestly when the server could not be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<BiteCommissionerPanel leagueId="league-1" initial={review} />);

    fireEvent.change(reason(), { target: { value: 'A reason.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the bite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server could not be reached (NETWORK_ERROR). Refresh to see whether it saved.'
    );
  });

  it('offers only cancel on an open bite', () => {
    render(
      <BiteCommissionerPanel
        leagueId="league-1"
        initial={{
          ...review,
          status: 'OPEN',
          takenPlayer: null,
          returnedPlayer: null,
          actions: ['cancel'],
        }}
      />
    );

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/ends unused and is never given back/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel the bite' })).toBeInTheDocument();
  });

  it('shows why there is nothing to do, with the code, and no form', () => {
    render(
      <BiteCommissionerPanel
        leagueId="league-1"
        initial={{
          ...review,
          actions: [],
          refusal: {
            code: 'FORBIDDEN',
            message:
              'You are part of this bite, so another commissioner or the owner must change it.',
          },
        }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'You cannot do this (FORBIDDEN). You are part of this bite, so another commissioner or the owner must change it.'
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
