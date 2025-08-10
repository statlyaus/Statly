import type { Player } from '@/types/players';
import PlayerStatsDisplay from './PlayerStatsDisplay';

interface PlayerDetailProps {
  player: Player;
}

export default function PlayerDetail({ player }: PlayerDetailProps) {
  const { name, team, position } = player;

  let bio: string;
  if (position && team) {
    bio = `${name} plays ${position} for ${team}.`;
  } else if (team) {
    bio = `${name} plays for ${team}.`;
  } else if (position) {
    bio = `${name} is a ${position}.`;
  } else {
    bio = 'Biography information is unavailable.';
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Biography</h2>
        <p className="text-neutral-700">{bio}</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold">Statistics</h2>
        <PlayerStatsDisplay player={player} />
      </div>
    </section>
  );
}
