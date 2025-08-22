import React from 'react';
import { motion } from 'framer-motion';
import {
  TrophyIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  averageScore: number;
  lastGameScore: number;
  projectedScore: number;
  form: number[];
  injuryStatus?: string;
  priceChange: number;
  captain?: boolean;
  viceCaptain?: boolean;
};
// Accept a more permissive player-like shape when necessary
export type LoosePlayer = Partial<Player> & { id: string };
// To avoid import() type usage in callers, also export the handler type
export type RowKeyHandler = (e: React.KeyboardEvent<HTMLDivElement>, idx: number, player: LoosePlayer) => void;

interface Props {
  player: Player;
  index: number;
  focused: boolean;
  setRef: (el: HTMLDivElement | null) => void;
  // Accept a broad player shape to remain compatible with callers using the app's Player type
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, idx: number, player: LoosePlayer) => void;
  getInjuryIcon: (status?: string) => React.ReactNode;
  getFormTrend: (form: number[]) => 'rising' | 'falling' | 'stable';
}

const PlayerRow: React.FC<Props> = ({ player, index, focused, setRef, onKeyDown, getInjuryIcon, getFormTrend }) => {
  const formTrend = getFormTrend(player.form);
  const recentForm = player.form.slice(-3).reduce((a, b) => a + b, 0) / 3 || 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`grid grid-cols-12 gap-4 p-4 border-b border-gray-100 hover:bg-gray-50 ${focused ? 'ring-2 ring-blue-200' : ''}`}
      role="row"
      ref={(el) => setRef(el)}
      tabIndex={0}
      onKeyDown={(e) => onKeyDown(e, index, player)}
      aria-rowindex={index + 1}
      aria-selected={focused}
    >
      <div className="col-span-3">
        <div className="flex items-center gap-2">
          {player.captain && <TrophyIcon className="w-4 h-4 text-yellow-500" title="Captain" />}
          {player.viceCaptain && <FireIcon className="w-4 h-4 text-orange-500" title="Vice Captain" />}
          <div>
            <div className="font-medium text-gray-900">{player.name}</div>
            <div className="text-sm text-gray-500">{player.team}</div>
          </div>
        </div>
      </div>

      <div className="col-span-2">
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            player.position === 'FWD'
              ? 'bg-red-100 text-red-800'
              : player.position === 'MID'
                ? 'bg-green-100 text-green-800'
                : player.position === 'DEF'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-purple-100 text-purple-800'
          }`}
        >
          {player.position}
        </span>
      </div>

      <div className="col-span-2">
        <div className="font-medium text-gray-900">{player.averageScore}</div>
        <div className="text-sm text-gray-500">Last: {player.lastGameScore}</div>
      </div>

      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <div className="font-medium text-gray-900">{recentForm.toFixed(1)}</div>
          {formTrend === 'rising' && <ArrowTrendingUpIcon className="w-4 h-4 text-green-500" />}
          {formTrend === 'falling' && <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />}
        </div>
      </div>

      <div className="col-span-2">
        <div className={`font-medium ${player.priceChange > 0 ? 'text-green-600' : player.priceChange < 0 ? 'text-red-600' : 'text-gray-600'}`}>
          {player.priceChange > 0 ? '+' : ''}${(player.priceChange / 1000).toFixed(0)}k
        </div>
      </div>

      <div className="col-span-1" role="cell">{getInjuryIcon(player.injuryStatus)}</div>
    </motion.div>
  );
};

export default React.memo(PlayerRow);
