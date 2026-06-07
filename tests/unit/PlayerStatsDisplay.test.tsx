import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CompactStatsRow } from '@/components/PlayerStatsDisplay';
import type { PlayerStats } from '@/types/fantasyCategories';

const playerStats: PlayerStats = {
  games: 20,
  kicks: 310,
  handballs: 0,
  marks: 0,
  tackles: 0,
  goals: 0,
  hitouts: 0,
  clearances: 0,
  inside50s: 0,
  rebound50s: 0,
  clangers: 0,
  contestedPossessions: 0,
  uncontestedPossessions: 0,
  freesFor: 0,
  freesAgainst: 0,
  onePercenters: 0,
  goalAssists: 0,
  timeOnGroundPct: 82.5,
  disposalEffPct: 0,
  turnovers: 0,
  intercepts: 0,
  metresGained: 0,
  contestedMarks: 0,
  effectiveDisposals: 0,
  scoreInvolvements: 0,
};

describe('CompactStatsRow', () => {
  it('shows a readable empty state when league stats are missing', () => {
    render(<CompactStatsRow selectedCategories={['kicks', 'marks']} />);

    expect(screen.getByText('League stats unavailable')).toBeInTheDocument();
    expect(screen.queryByText('K')).not.toBeInTheDocument();
    expect(screen.queryByText('M')).not.toBeInTheDocument();
  });

  it('renders finite values instead of NaN when stat payloads do not include games', () => {
    render(<CompactStatsRow stats={{ kicks: 310 }} selectedCategories={['kicks']} />);

    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('310.0')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('renders semantic compact stat pills for table scanning', () => {
    render(
      <CompactStatsRow stats={playerStats} selectedCategories={['kicks', 'timeOnGroundPct']} />
    );

    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('310.0')).toBeInTheDocument();
    expect(screen.getByText('TOG%')).toBeInTheDocument();
    expect(screen.getByText('82.5%')).toBeInTheDocument();

    expect(screen.getByText('K').closest('div')).toHaveClass('border-border', 'bg-background');
  });
});
