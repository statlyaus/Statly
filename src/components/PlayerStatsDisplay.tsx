import type { Player } from '@/types/players';

interface PlayerStatsDisplayProps {
  player: Player;
}

// A helper to format stat keys into more readable labels
const formatStatKey = (key: string): string => {
  if (key === 'avg') return 'Average';
  if (key === 'inside50s') return 'Inside 50s';
  if (key === 'rebound50s') return 'Rebound 50s';
  if (key === 'contestedPossessions') return 'Contested Possessions';
  return key.charAt(0).toUpperCase() + key.slice(1);
};

export default function PlayerStatsDisplay({ player }: PlayerStatsDisplayProps) {
  // Define which stats to display and in what order.
  const statsToDisplay: (keyof Player)[] = [
    'avg',
    'kicks',
    'handballs',
    'marks',
    'tackles',
    'goals',
    'hitouts',
    'clearances',
    'inside50s',
    'rebound50s',
    'contestedPossessions',
  ];

  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-8">
      {statsToDisplay.map((key) => {
        const value = player[key];
        if (value === null || value === undefined) return null;

        return (
          <div key={key} className="flex flex-col-reverse">
            <dt className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {formatStatKey(key)}
            </dt>
            <dd className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
              {key === 'avg' ? (value as number).toFixed(1) : value.toString()}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
