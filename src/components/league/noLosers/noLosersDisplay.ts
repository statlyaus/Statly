import type { CategoryResult } from '@/components/scores/MatchupScore';

/**
 * Display text for the No Losers screens (#1296, BR-40 to BR-42). Every state has words, never
 * colour alone (NFR-8). Values come from the server's stored breakdown; nothing is recomputed here.
 */

export type NoLosersPlayerResult =
  | {
      status: 'COUNTED';
      clubResult: 'WIN' | 'DRAW' | 'LOSS' | 'ABANDONED' | string;
      margin: number | null;
      multiplier: number;
    }
  | { status: 'RESULT_PENDING' }
  | { status: 'UNRESOLVED' };

export interface NoLosersResultLabel {
  /** One character for the badge. */
  badge: string;
  tone: CategoryResult;
  /** Short visible text, e.g. "Zeroed: lost by 20". */
  text: string;
  /** The full sentence for screen readers. */
  srText: string;
}

export function noLosersResultLabel(result: NoLosersPlayerResult): NoLosersResultLabel {
  if (result.status === 'RESULT_PENDING') {
    return {
      badge: '?',
      tone: 'pending',
      text: 'Result pending',
      srText: 'Result pending: raw stats count until the official result is stored',
    };
  }
  if (result.status === 'UNRESOLVED') {
    return {
      badge: '!',
      tone: 'pending',
      text: 'Result unavailable',
      srText: "Result unavailable: the player's club cannot be matched to its game",
    };
  }
  const by = result.margin === null ? null : Math.abs(result.margin);
  if (result.clubResult === 'ABANDONED') {
    return {
      badge: 'A',
      tone: 'drawn',
      text: 'Abandoned: counted',
      srText: 'Game abandoned: counted in full',
    };
  }
  if (result.clubResult === 'WIN') {
    return {
      badge: 'W',
      tone: 'won',
      text: by === null ? 'Won' : `Won by ${by}`,
      srText: `Counted in full: club won${by === null ? '' : ` by ${by}`}`,
    };
  }
  if (result.clubResult === 'DRAW') {
    return { badge: 'D', tone: 'drawn', text: 'Half: drew', srText: 'Half counted: club drew' };
  }
  if (result.multiplier === 0.5) {
    return {
      badge: 'L',
      tone: 'lost',
      text: by === null ? 'Half: close loss' : `Half: lost by ${by}`,
      srText: `Half counted: club lost${by === null ? '' : ` by ${by}`}, under a goal`,
    };
  }
  return {
    badge: 'L',
    tone: 'lost',
    text: by === null ? 'Zeroed: club lost' : `Zeroed: lost by ${by}`,
    srText: `Zeroed: club lost${by === null ? '' : ` by ${by}`}, not counted`,
  };
}

export interface ClubRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** "8-3-1" (wins-losses-draws). */
export function formatClubRecord(record: ClubRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`;
}

export function clubRecordSrText(record: ClubRecord): string {
  const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return `Club record ${part(record.wins, 'win', 'wins')}, ${part(record.losses, 'loss', 'losses')}, ${part(record.draws, 'draw', 'draws')}`;
}
