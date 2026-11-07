import type { DraftPlayer } from '@/types/draft';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { CategoryDirection } from '@/types/leagues';

export type PlayerSortKey =
  'statlyZ' | 'name' | 'position' | 'club' | 'adp' | `category:${FantasyCategoryKey}`;

export type CategoryDirections = Partial<Record<FantasyCategoryKey, CategoryDirection>>;

function getCategorySortValue(player: DraftPlayer, category: FantasyCategoryKey): number | null {
  const value = player.stats?.[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Best first: highest unless the league scores the category LOW_WINS. Missing values sort last. */
function compareNullableScores(
  aValue: number | null,
  bValue: number | null,
  aName: string,
  bName: string,
  direction: CategoryDirection = 'HIGH_WINS'
): number {
  if (aValue === null && bValue === null) return aName.localeCompare(bName);
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  const difference = direction === 'LOW_WINS' ? aValue - bValue : bValue - aValue;
  return difference || aName.localeCompare(bName);
}

export function sortDraftPlayers(
  players: DraftPlayer[],
  sortBy: PlayerSortKey,
  categoryDirections: CategoryDirections = {}
): DraftPlayer[] {
  return [...players].sort((a, b) => {
    if (sortBy === 'statlyZ') {
      const aScore = typeof a.statlyZScore === 'number' ? a.statlyZScore : null;
      const bScore = typeof b.statlyZScore === 'number' ? b.statlyZScore : null;
      return compareNullableScores(aScore, bScore, a.name, b.name);
    }

    if (sortBy === 'adp') {
      return (a.adp ?? Number.MAX_SAFE_INTEGER) - (b.adp ?? Number.MAX_SAFE_INTEGER);
    }

    if (sortBy.startsWith('category:')) {
      const category = sortBy.slice('category:'.length) as FantasyCategoryKey;
      return compareNullableScores(
        getCategorySortValue(a, category),
        getCategorySortValue(b, category),
        a.name,
        b.name,
        categoryDirections[category]
      );
    }

    const textSort = sortBy as 'name' | 'position' | 'club';
    return a[textSort].localeCompare(b[textSort]);
  });
}
