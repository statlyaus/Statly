import PlayerSummaryCard from './PlayerSummaryCard';
import PlayerStatsDisplay from './PlayerStatsDisplay';
import type { Player } from '@/types';

interface PlayerDetailProps {
  player?: Player | null;
}

export default function PlayerDetail({ player }: PlayerDetailProps) {
  if (!player) {
    return (
      <section aria-label="Player overview" className="p-4">
        <p className="text-neutral-600">No player data available.</p>
      </section>
    );
  }

  const statsKeys: (keyof Player)[] = [
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

  const hasStats = statsKeys.some(
    (key) => player[key] !== undefined && player[key] !== null,
  );

  return (
    <section aria-labelledby="player-profile" className="space-y-6">
      <h1 id="player-profile" className="sr-only">
        {player.name}
      </h1>

      <PlayerSummaryCard player={player} />

      {hasStats ? (
        <div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Season stats
          </h2>
          <PlayerStatsDisplay player={player} />
        </div>
      ) : (
        <p className="text-neutral-600">No statistics available for this player.</p>
      )}
    </section>
  );
}

