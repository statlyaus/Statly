import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

type MatchData = {
  season?: number;
  round: number;
  totalValue: number;
  opposition: string;
  categories?: Record<string, number>;
};

type Props = {
  playerName: string;
  matchData: MatchData[];
  seasonGames?: number;
  hasAggregateStats?: boolean;
};

const PlayerChart: React.FC<Props> = ({
  playerName,
  matchData,
  seasonGames = 0,
  hasAggregateStats = false,
}) => {
  // Sort by round and create chart data
  const sortedMatches = [...matchData].sort(
    (a, b) => (a.season ?? 0) - (b.season ?? 0) || a.round - b.round
  );
  const seasons = Array.from(
    new Set(sortedMatches.map((match) => match.season).filter((season): season is number => typeof season === 'number'))
  );
  const hasMultipleSeasons = seasons.length > 1;
  const seasonLabel =
    seasons.length === 0
      ? 'Season'
      : seasons.length === 1
        ? `${seasons[0]} season`
        : `${Math.min(...seasons)}-${Math.max(...seasons)}`;
  const getShortRoundLabel = (round: number) => (round > 0 ? `R${round}` : 'TBC');
  const getFullRoundLabel = (round: number) => (round > 0 ? `R${round}` : 'Round TBC');
  const labels = sortedMatches.map((match) => {
    const roundLabel = getShortRoundLabel(match.round);
    return hasMultipleSeasons && match.season
      ? `${String(match.season).slice(-2)} ${roundLabel}`
      : roundLabel;
  });
  const fullLabels = sortedMatches.map((match) =>
    `${match.season ? `${match.season} ` : ''}${getFullRoundLabel(match.round)} vs ${match.opposition}`
  );
  const values = sortedMatches.map((match) => match.totalValue);
  const hasValueTrend = values.some((value) => value !== 0);
  const categoryAverages = [
    ['goals', 'Goals'],
    ['tackles', 'Tackles'],
    ['clearances', 'Clearances'],
    ['inside50s', 'Inside 50s'],
    ['marks', 'Marks'],
    ['disposals', 'Disposals'],
  ]
    .map(([key, label]) => {
      const categoryValues = sortedMatches
        .map((match) => match.categories?.[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const average =
        categoryValues.length > 0
          ? categoryValues.reduce((sum, value) => sum + value, 0) / categoryValues.length
          : null;
      return { key, label, average };
    })
    .filter((category) => category.average !== null);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-card-foreground">Recent Performance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {playerName} - Statly category value by round
          </p>
        </div>
        <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          {seasonLabel}
        </span>
      </div>

      <div className="mt-4 h-56">
        {sortedMatches.length > 0 && hasValueTrend ? (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: 'Statly Value',
                  data: values,
                  borderColor: '#2563eb',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  fill: true,
                  tension: 0.4,
                  pointBackgroundColor: '#2563eb',
                  pointBorderColor: '#ffffff',
                  pointBorderWidth: 2,
                  pointRadius: 4,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: false,
                },
                tooltip: {
                  callbacks: {
                    title: (context) => fullLabels[context[0].dataIndex] ?? context[0].label,
                    label: (context) =>
                      `Statly Value: ${context.parsed.y === null ? '-' : context.parsed.y.toFixed(2)}`,
                  },
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  grid: {
                    color: 'rgba(148, 163, 184, 0.25)',
                  },
                  title: {
                    display: true,
                    text: 'Statly Value',
                  },
                  ticks: {
                    maxTicksLimit: 5,
                  },
                },
                x: {
                  grid: {
                    display: false,
                  },
                  ticks: {
                    autoSkip: true,
                    maxRotation: 0,
                    maxTicksLimit: 8,
                  },
                  title: {
                    display: true,
                    text: hasMultipleSeasons ? 'Season / Round' : 'Round',
                  },
                },
              },
              interaction: {
                intersect: false,
                mode: 'index' as const,
              },
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-5 text-center">
            <div>
              <h3 className="text-base font-semibold text-card-foreground">
                {hasAggregateStats ? 'Season profile available' : 'No performance data yet'}
              </h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {hasAggregateStats
                  ? `${playerName} has aggregate season data${
                      seasonGames > 0 ? ` across ${seasonGames} games` : ''
                    }, but round-by-round value history is not available yet.`
                  : 'Category data will appear here once round-by-round logs are available.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {sortedMatches.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm md:grid-cols-4">
          {hasValueTrend ? (
            <>
              <div>
                <div className="text-muted-foreground">Avg Value</div>
                <div className="font-semibold text-card-foreground">
                  {(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Best Value</div>
                <div className="font-semibold text-card-foreground">{Math.max(...values).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Category Avgs</div>
                <div className="font-semibold text-card-foreground">
                  {categoryAverages.length || '-'}
                </div>
              </div>
            </>
          ) : (
            <>
              {categoryAverages.slice(0, 3).map((category) => (
                <div key={category.key}>
                  <div className="text-muted-foreground">{category.label}</div>
                  <div className="font-semibold text-card-foreground">
                    {category.average?.toFixed((category.average ?? 0) < 10 ? 1 : 0)}
                  </div>
                </div>
              ))}
            </>
          )}
          <div>
            <div className="text-muted-foreground">Match logs</div>
            <div className="font-semibold text-card-foreground">{sortedMatches.length}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerChart;
