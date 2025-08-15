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
} from 'chart.js';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

type MatchData = {
  round: number;
  totalValue: number;
  opposition: string;
};

type Props = {
  playerName: string;
  matchData: MatchData[];
};

const PlayerChart: React.FC<Props> = ({ playerName, matchData }) => {
  // Sort by round and create chart data
  const sortedMatches = [...matchData].sort((a, b) => a.round - b.round);
  const labels = sortedMatches.map((match) => `R${match.round} vs ${match.opposition}`);
  const values = sortedMatches.map((match) => match.totalValue);

  return (
    <div className="bg-white p-4 rounded shadow">
      <h2 className="text-xl font-bold mb-2">{playerName} - Season Performance</h2>
      <div className="mb-2 text-sm text-gray-600">
        9-Category Total Value by Round (2025 Season)
      </div>
      <Line
        data={{
          labels,
          datasets: [
            {
              label: 'Total Value (9-Category)',
              data: values,
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              fill: true,
              tension: 0.4,
              pointBackgroundColor: '#8b5cf6',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 2,
              pointRadius: 5,
            },
          ],
        }}
        options={{
          responsive: true,
          plugins: {
            legend: {
              display: true,
              position: 'top' as const,
            },
            tooltip: {
              callbacks: {
                title: (context) => context[0].label,
                label: (context) => `Total Value: ${context.parsed.y.toFixed(1)}`,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Total Value Points',
              },
            },
            x: {
              title: {
                display: true,
                text: 'Match (Round vs Opposition)',
              },
            },
          },
          interaction: {
            intersect: false,
            mode: 'index' as const,
          },
        }}
      />
      {sortedMatches.length > 0 && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500">Average:</div>
            <div className="font-semibold">
              {(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Best:</div>
            <div className="font-semibold text-green-600">{Math.max(...values).toFixed(1)}</div>
          </div>
          <div>
            <div className="text-gray-500">Worst:</div>
            <div className="font-semibold text-red-600">{Math.min(...values).toFixed(1)}</div>
          </div>
          <div>
            <div className="text-gray-500">Games:</div>
            <div className="font-semibold">{sortedMatches.length}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerChart;
