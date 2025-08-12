import type { Player } from '@/types/players';
import PlayerStatsDisplay from './PlayerStatsDisplay';
import type { PlayerStats } from '@/types/fantasyCategories';

interface PlayerDetailProps {
  player: Player;
}

export default function PlayerDetail({ player }: PlayerDetailProps) {
  const { name, team, position } = player;

  // Convert player stats to PlayerStats format safely
  const convertToPlayerStats = (stats: Record<string, unknown> | undefined): PlayerStats | undefined => {
    if (!stats) return undefined;
    
    // Create a basic PlayerStats object with default values
    const playerStats: PlayerStats = {
      games: Number(stats.games) || 0,
      kicks: Number(stats.kicks) || 0,
      handballs: Number(stats.handballs) || 0,
      marks: Number(stats.marks) || 0,
      tackles: Number(stats.tackles) || 0,
      goals: Number(stats.goals) || 0,
      hitouts: Number(stats.hitouts) || 0,
      clearances: Number(stats.clearances) || 0,
      inside50s: Number(stats.inside50s) || 0,
      rebound50s: Number(stats.rebound50s) || 0,
      clangers: Number(stats.clangers) || 0,
      contestedPossessions: Number(stats.contestedPossessions) || 0,
      uncontestedPossessions: Number(stats.uncontestedPossessions) || 0,
      freesFor: Number(stats.freesFor) || 0,
      freesAgainst: Number(stats.freesAgainst) || 0,
      onePercenters: Number(stats.onePercenters) || 0,
      goalAssists: Number(stats.goalAssists) || 0,
      timeOnGroundPct: Number(stats.timeOnGroundPct) || 0,
      disposalEffPct: Number(stats.disposalEffPct) || 0,
      turnovers: Number(stats.turnovers) || 0,
      intercepts: Number(stats.intercepts) || 0,
      metresGained: Number(stats.metresGained) || 0,
      contestedMarks: Number(stats.contestedMarks) || 0,
      effectiveDisposals: Number(stats.effectiveDisposals) || 0,
      scoreInvolvements: Number(stats.scoreInvolvements) || 0,
    };
    
    return playerStats;
  };

  const playerStats = convertToPlayerStats(player.stats);

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
        <PlayerStatsDisplay 
          stats={playerStats} 
          selectedCategories={['goals', 'kicks', 'handballs', 'marks', 'tackles']} 
        />
      </div>
    </section>
  );
}
