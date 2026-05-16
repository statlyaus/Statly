'use client';

import React from 'react';

import { TeamLogo } from '@/components/TeamLogo';

import { Flame, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';

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
  ownership?: number;
  captain?: boolean;
  viceCaptain?: boolean;
};
// Accept a more permissive player-like shape when necessary
export type LoosePlayer = Partial<Player> & { id: string };
// To avoid import() type usage in callers, also export the handler type
export type RowKeyHandler = (
  e: React.KeyboardEvent<HTMLDivElement>,
  idx: number,
  player: LoosePlayer
) => void;

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

const rowClassName =
  'grid grid-cols-12 gap-4 rounded-md border border-border bg-card p-3 text-card-foreground shadow-sm transition-colors hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring';
const metadataClassName = 'text-xs text-muted-foreground';
const statusClassName =
  'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground';

const PlayerRow: React.FC<Props> = ({
  player,
  index,
  focused,
  setRef,
  onKeyDown,
  getInjuryIcon,
  getFormTrend,
}) => {
  const formTrend = getFormTrend(player.form);
  const recentForm = player.form.slice(-3).reduce((a, b) => a + b, 0) / 3 || 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`${rowClassName} ${focused ? 'ring-2 ring-ring' : ''}`}
      role="row"
      ref={(el) => setRef(el)}
      tabIndex={0}
      onKeyDown={(e) => onKeyDown(e, index, player)}
      aria-rowindex={index + 1}
      aria-selected={focused}
    >
      <div className="col-span-3">
        <div className="flex items-center gap-2">
          {player.captain && <Trophy className="h-4 w-4 text-foreground" aria-label="Captain" />}
          {player.viceCaptain && (
            <Flame className="h-4 w-4 text-foreground" aria-label="Vice Captain" />
          )}
          <div>
            <div className="font-medium text-foreground">{player.name}</div>
            <div className={`flex items-center gap-1.5 ${metadataClassName}`}>
              {player.team ? <TeamLogo team={player.team} size={16} withCircle decorative /> : null}
              <span>{player.team || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-2">
        <span className={statusClassName}>{player.position}</span>
      </div>

      <div className="col-span-2">
        <div className="font-medium text-foreground">
          {typeof player.averageScore === 'number'
            ? player.averageScore.toFixed(2)
            : player.averageScore}
        </div>
        <div className={metadataClassName}>Last: {player.lastGameScore}</div>
      </div>

      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <div className="font-medium text-foreground">{recentForm.toFixed(1)}</div>
          {formTrend === 'rising' && <TrendingUp className="h-4 w-4 text-foreground" />}
          {formTrend === 'falling' && <TrendingDown className="h-4 w-4 text-destructive" />}
        </div>
      </div>

      <div className="col-span-1">
        <div className="font-medium text-foreground">
          {typeof player.ownership === 'number' ? `${player.ownership}%` : '—'}
        </div>
      </div>

      <div className="col-span-1">
        <div
          className={`font-medium ${player.priceChange < 0 ? 'text-destructive' : 'text-foreground'}`}
        >
          {player.priceChange > 0 ? '+' : ''}${(player.priceChange / 1000).toFixed(0)}k
        </div>
      </div>

      <div className="col-span-1" role="cell">
        {getInjuryIcon(player.injuryStatus)}
      </div>
    </motion.div>
  );
};

export default React.memo(PlayerRow);
