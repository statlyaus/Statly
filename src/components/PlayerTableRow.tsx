'use client';

import { TeamLogo } from '@/components/TeamLogo';
import { tableClasses } from '@/components/ui/table';
import { getTeamAbbreviation } from '@/lib/teamLogos';

import { capitalizeWords, capitalizeFirstLetter } from '../lib/utils';

import type { Player } from '../types/players';

type PlayerTableRowProps = {
  player: Player;
  isMyPick: boolean;
  isWatched: boolean;
  isDrafted: boolean;
  onWatchToggle: (playerId: string) => void;
  onConfirmDraft: (player: Player) => void;
};

const PlayerTableRow = ({
  player,
  isMyPick,
  isWatched,
  isDrafted,
  onWatchToggle,
  onConfirmDraft,
}: PlayerTableRowProps) => {
  return (
    <tr
      className={`transition ${isDrafted ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40'}`}
    >
      <td className={`${tableClasses.td} font-medium`}>{capitalizeWords(player.name)}</td>
      <td className={`${tableClasses.td} text-muted-foreground`}>
        {player.team ? (
          <span className="inline-flex items-center gap-2" title={capitalizeWords(player.team)}>
            <TeamLogo team={player.team} size={20} withCircle decorative />
            <span>{getTeamAbbreviation(player.team)}</span>
          </span>
        ) : (
          '-'
        )}
      </td>
      <td className={`${tableClasses.td} text-muted-foreground`}>
        {capitalizeFirstLetter(player.position)}
      </td>
      <td className={`${tableClasses.td} w-8 px-2 text-center`}>
        <button
          onClick={() => onWatchToggle(player.id)}
          aria-label={`Toggle watch status for ${player.name}`}
          className={`text-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isWatched ? 'text-primary' : 'text-muted-foreground/45'}`}
        >
          ★
        </button>
      </td>
      <td className={`${tableClasses.td} w-24 text-right`}>
        <button
          onClick={() => onConfirmDraft(player)}
          disabled={!isMyPick || isDrafted}
          className="w-full px-4 py-2 text-sm font-semibold rounded transition
            bg-primary text-primary-foreground hover:bg-primary/90
            disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          Draft
        </button>
      </td>
    </tr>
  );
};

export default PlayerTableRow;
