import type { Player } from '@/types/players';

/**
 * Return the top `count` players sorted by `stats.aflFantasy` without sorting
 * the entire input list. Uses an insertion approach with a fixed-size array.
 */
export function getTopPlayersByFantasy(
  players: Player[],
  count = 5,
): Player[] {
  const top: Player[] = [];

  for (const p of players) {
    const fantasy = Number(p.stats?.aflFantasy) || 0;

    let inserted = false;
    for (let i = 0; i < top.length; i++) {
      const cur = Number(top[i].stats?.aflFantasy) || 0;
      if (fantasy > cur) {
        top.splice(i, 0, p);
        inserted = true;
        break;
      }
    }
    if (!inserted) top.push(p);
    if (top.length > count) top.pop();
  }

  return top;
}
