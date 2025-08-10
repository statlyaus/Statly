import type { Player } from '../types/players';
import { capitalizeWords, capitalizeFirstLetter } from '../lib/utils';

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
      className={`border-t transition ${isDrafted ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
    >
      <td className="px-3 py-2 font-medium text-gray-800">{capitalizeWords(player.name)}</td>
      <td className="px-3 py-2 text-gray-600">{capitalizeFirstLetter(player.team)}</td>
      <td className="px-3 py-2 text-gray-600">{capitalizeFirstLetter(player.position)}</td>
      <td className="px-2 py-2 text-center w-8">
        <button
          onClick={() => onWatchToggle(player.id)}
          aria-label={`Toggle watch status for ${player.name}`}
          className={`text-lg ${isWatched ? 'text-yellow-600' : 'text-gray-300'} transition`}
        >
          ★
        </button>
      </td>
      <td className="px-3 py-2 text-right w-24">
        <button
          onClick={() => onConfirmDraft(player)}
          disabled={!isMyPick || isDrafted}
          className="w-full px-4 py-2 text-sm font-semibold rounded transition
            disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-blue-600
            bg-blue-600 text-white hover:bg-blue-700"
        >
          Draft
        </button>
      </td>
    </tr>
  );
};

export default PlayerTableRow;
