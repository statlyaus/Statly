import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export const STATLY_Z_DESCRIPTION =
  "Statly Z combines a player's results across your league's scoring categories. Higher is better. It updates as the available player pool changes; Partial means some category data is missing.";

type StatlyZInput = {
  statlyZScore?: number;
  statlyZBreakdown?: Array<{ category: FantasyCategoryKey; value: number; zScore: number }>;
  statlyZMissingCategories?: FantasyCategoryKey[];
};

export type StatlyZPresentation = {
  state: 'complete' | 'partial' | 'no-data' | 'pending';
  value: string;
  accessibleLabel: string;
};

function formatStatlyZScore(score: number): string {
  const rounded = Number(score.toFixed(2));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

export function getStatlyZPresentation(player: StatlyZInput): StatlyZPresentation {
  const missingCategories = Array.isArray(player.statlyZMissingCategories)
    ? player.statlyZMissingCategories
    : null;
  const breakdown = Array.isArray(player.statlyZBreakdown) ? player.statlyZBreakdown : null;
  const hasNoUsableData =
    missingCategories !== null &&
    missingCategories.length > 0 &&
    breakdown !== null &&
    breakdown.length === 0;

  if (hasNoUsableData) {
    return {
      state: 'no-data',
      value: '—',
      accessibleLabel: 'Statly Z unavailable because category data is missing',
    };
  }

  if (typeof player.statlyZScore !== 'number' || !Number.isFinite(player.statlyZScore)) {
    return {
      state: 'pending',
      value: 'Pending',
      accessibleLabel: 'Statly Z pending',
    };
  }

  const value = formatStatlyZScore(player.statlyZScore);
  if (missingCategories && missingCategories.length > 0) {
    return {
      state: 'partial',
      value,
      accessibleLabel: `Statly Z ${value}, partial category coverage`,
    };
  }

  return {
    state: 'complete',
    value,
    accessibleLabel: `Statly Z ${value}`,
  };
}
