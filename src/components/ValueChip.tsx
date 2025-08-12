'use client';

import RankingDisplay from './RankingDisplay';

export type ValueChipProps = {
  playerId: string | number;
  compact?: boolean;
  className?: string;
};

export function ValueChip({ playerId, compact = false, className = '' }: ValueChipProps) {
  return (
    <RankingDisplay
      playerId={String(playerId)}
      variant="chip"
      compact={compact}
      className={className}
    />
  );
}

export default ValueChip;
