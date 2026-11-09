import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RoundMatchesPage from '@/app/(app)/matches/[round]/page';

const mocks = vi.hoisted(() => ({
  getRoundMatchesResult: vi.fn(),
}));

// The page reads the fixture the ETL writes to `matches`; the retired MatchEvent collection must
// never be read again.
vi.mock('@/lib/firebaseAdmin', () => ({
  get adminDb() {
    throw new Error('The matches page must read the fixture through etlRoundData');
  },
}));

vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatchesResult: mocks.getRoundMatchesResult,
}));

vi.mock('@/components/RoundMatches', () => ({
  RoundMatches: ({
    round,
    initialMatches,
  }: {
    round: number;
    initialMatches?: { id: string; homeTeam: string; awayTeam: string; status: string }[];
  }) => (
    <div>
      Round matches {round}
      {initialMatches?.map((match) => (
        <p key={match.id}>
          {match.id}: {match.homeTeam} v {match.awayTeam} ({match.status})
        </p>
      ))}
    </div>
  ),
}));

function page(round: string, season?: string) {
  return RoundMatchesPage({
    params: Promise.resolve({ round }),
    searchParams: Promise.resolve(season ? { season } : {}),
  });
}

describe('RoundMatchesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [] });
  });

  it('renders a non-interactive Previous control for the opening round', async () => {
    render(await page('0'));

    const previous = screen.getByRole('button', { name: '← Previous' });
    expect(previous).toBeDisabled();
    expect(previous).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute('href', '/matches/1');
    expect(screen.getByText('Round matches 0')).toBeVisible();
  });

  it('renders normal Previous and Next links after the opening round', async () => {
    render(await page('2'));

    expect(screen.getByRole('link', { name: '← Previous' })).toHaveAttribute('href', '/matches/1');
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute('href', '/matches/3');
    expect(screen.getByText('Round matches 2')).toBeVisible();
  });

  it('keeps a chosen season on the round links', async () => {
    render(await page('2', '2025'));

    expect(mocks.getRoundMatchesResult).toHaveBeenCalledWith(2025, 2);
    expect(screen.getByRole('link', { name: '← Previous' })).toHaveAttribute(
      'href',
      '/matches/1?season=2025'
    );
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute(
      'href',
      '/matches/3?season=2025'
    );
  });

  it('preloads the fixture matches the ETL wrote, earliest first', async () => {
    mocks.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [
        {
          match_uid: '2025-R25-GCS-GWS',
          season: 2025,
          round_number: 25,
          home_team: 'Gold Coast',
          away_team: 'GWS',
          start_time_utc: '2025-09-06T09:40:00.000Z',
          status: 'final',
        },
        {
          match_uid: '2025-R25-COL-ADE',
          season: 2025,
          round_number: 25,
          home_team: 'Collingwood',
          away_team: 'Adelaide',
          start_time_utc: '2025-09-05T09:40:00.000Z',
          status: 'final',
        },
      ],
    });

    render(await page('25', '2025'));

    expect(mocks.getRoundMatchesResult).toHaveBeenCalledWith(2025, 25);
    expect(screen.getAllByText(/^2025-R25-/).map((element) => element.textContent)).toEqual([
      '2025-R25-COL-ADE: Collingwood v Adelaide (final)',
      '2025-R25-GCS-GWS: Gold Coast v GWS (final)',
    ]);
  });

  it('rejects an invalid round or season', async () => {
    render(await page('-1'));
    expect(screen.getByText('Invalid round parameter.')).toBeVisible();

    render(await page('1', 'next'));
    expect(screen.getByText('Invalid season parameter.')).toBeVisible();
    expect(mocks.getRoundMatchesResult).not.toHaveBeenCalled();
  });
});
