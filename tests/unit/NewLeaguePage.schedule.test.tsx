import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NewLeaguePage from '@/app/(app)/leagues/new/page';

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'commissioner-1' } }),
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getBrowserTimeZone: () => 'Australia/Melbourne',
}));

describe('NewLeaguePage draft schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-29T07:00:00.000Z'));
    mocks.fetchApi.mockResolvedValue({ success: true, data: { id: 'league-1' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('keeps submission actionable and focuses the missing required league name', () => {
    render(<NewLeaguePage />);

    const leagueName = screen.getByLabelText(/League name/);
    const createLeague = screen.getByRole('button', { name: 'Create league' });

    expect(createLeague).toBeEnabled();
    fireEvent.click(createLeague);

    expect(leagueName).toHaveFocus();
    expect(leagueName).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a league name.')).toBeInTheDocument();
    expect(screen.getByText('Complete the highlighted field')).toBeInTheDocument();
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });

  it('matches the API minimum and clears the prompt when the name is corrected', async () => {
    render(<NewLeaguePage />);

    const leagueName = screen.getByLabelText(/League name/);
    const createLeague = screen.getByRole('button', { name: 'Create league' });

    fireEvent.change(leagueName, { target: { value: 'AB' } });
    fireEvent.click(createLeague);

    expect(leagueName).toHaveFocus();
    expect(screen.getByText('League name must be at least 3 characters.')).toBeInTheDocument();
    expect(mocks.fetchApi).not.toHaveBeenCalled();

    fireEvent.change(leagueName, { target: { value: 'AFL' } });

    expect(leagueName).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Complete the highlighted field')).not.toBeInTheDocument();

    fireEvent.click(createLeague);
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
  });

  it('focuses an incomplete optional schedule when the commissioner tries to submit it', () => {
    render(<NewLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'Accessible AFL League' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add draft schedule' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Schedule the draft for tomorrow at 7:00 pm' })
    );

    const startTime = screen.getByLabelText('Start time');
    fireEvent.change(startTime, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    expect(startTime).toHaveFocus();
    expect(screen.getByText('Choose both a draft date and start time.')).toBeInTheDocument();
    expect(
      screen.getByText('Review the draft date, time, and time zone before continuing.')
    ).toBeInTheDocument();
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });

  it('submits the resolved UTC instant from the shared optional schedule field', async () => {
    const { container } = render(<NewLeaguePage />);

    expect(screen.getByText('Draft not scheduled')).toBeInTheDocument();
    expect(container.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'Accessible AFL League' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add draft schedule' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Schedule the draft for tomorrow at 7:00 pm' })
    );
    const sidebarDraftValue = screen
      .getByText('Draft', { selector: 'p' })
      .parentElement?.querySelector('p.mt-1');
    expect(sidebarDraftValue).toHaveTextContent('Thursday 30 July 2026 at 7:00 pm AEST');
    expect(sidebarDraftValue).not.toHaveClass('capitalize');
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));

    const [, request] = mocks.fetchApi.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toMatchObject({
      name: 'Accessible AFL League',
      draftDate: '2026-07-30T09:00:00.000Z',
      timeZone: 'Australia/Melbourne',
    });
    expect(mocks.push).toHaveBeenCalledWith('/leagues/league-1');
  });
  it('shows the reason the server refused the league', async () => {
    mocks.fetchApi.mockRejectedValue(
      Object.assign(new Error('League size must be 4-20 teams'), { status: 400 })
    );
    render(<NewLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'Accessible AFL League' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    expect(await screen.findByText('League size must be 4-20 teams')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a server failure',
      Object.assign(new Error('HTTP 500: Internal Server Error'), { status: 500 }),
    ],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('keeps the generic retry message for %s', async (_label, failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fetchApi.mockRejectedValue(failure);
    render(<NewLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'Accessible AFL League' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));

    expect(
      await screen.findByText('Failed to create league. Please try again.')
    ).toBeInTheDocument();
  });

  it('offers no Bloodsucker format while it is held back (flag off)', () => {
    render(<NewLeaguePage />);

    expect(screen.queryByRole('option', { name: 'Bloodsucker' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No Losers' })).toBeInTheDocument();
  });

  it('creates a Bloodsucker league with rolling waivers and no weekly option (BR-03)', async () => {
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER', 'true');
    render(<NewLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'Bloodsucker League' },
    });
    fireEvent.change(screen.getByLabelText(/League format/), {
      target: { value: 'BLOODSUCKER' },
    });

    expect(screen.getByRole('option', { name: /weekly/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));

    const [, request] = mocks.fetchApi.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toMatchObject({
      leagueFormat: 'BLOODSUCKER',
      waiverRule: 'rolling',
    });
  });

  it('explains No Losers and creates it with the standard weekly waivers (No Losers BR-04)', async () => {
    render(<NewLeaguePage />);

    fireEvent.change(screen.getByLabelText(/League name/), {
      target: { value: 'No Losers League' },
    });
    fireEvent.change(screen.getByLabelText(/League format/), {
      target: { value: 'NO_LOSERS' },
    });

    expect(screen.getByText(/a draw or a loss by 1 to 5 points counts half/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /weekly/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));

    const [, request] = mocks.fetchApi.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toMatchObject({
      leagueFormat: 'NO_LOSERS',
      waiverRule: 'weekly',
    });
  });

  it('holds the league name to the API maximum of 50 characters', () => {
    render(<NewLeaguePage />);

    expect(screen.getByLabelText(/League name/)).toHaveAttribute('maxLength', '50');
  });
});
