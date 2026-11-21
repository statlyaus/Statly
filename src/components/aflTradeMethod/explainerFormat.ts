import type { Pool } from './dawsonExample';

export const POOLS: readonly Pool[] = ['off', 'mid', 'def'];
export const POOL_NAME: Record<Pool, string> = { off: 'Attack', mid: 'Midfield', def: 'Defence' };
/** Each part's fill: attack cobalt, midfield sun, defence ink (semantic roles, never hex). */
export const POOL_FILL: Record<Pool, string> = {
  off: 'bg-primary',
  mid: 'bg-warning',
  def: 'bg-foreground',
};

/** A true minus sign, and no "−0.0". */
const minus = (s: string) => (/^-0(\.0+)?$/u.test(s) ? s.slice(1) : s.replace('-', '−'));
const fmt = (n: number, dp: number) =>
  minus(n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const f0 = (n: number) => fmt(n, 0);
export const f1 = (n: number) => fmt(n, 1);
export const f2 = (n: number) => fmt(n, 2);
export const f3 = (n: number) => fmt(n, 3);
export const f4 = (n: number) => fmt(n, 4);
/** Rounds to `dp` decimals as a number, matching what the formatters print. */
export const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
export const pct = (n: number) =>
  `${(n * 100).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * Rounds values to 2 decimals so the shown values add up exactly to the total rounded to 2 decimals
 * (largest remainder).
 */
export function roundToTotal(values: readonly number[], total: number): number[] {
  const cents = values.map((v) => v * 100);
  const floors = cents.map(Math.floor);
  let left = Math.round(total * 100) - floors.reduce((a, b) => a + b, 0);
  const order = cents
    .map((c, i) => ({ rest: c - (floors[i] ?? 0), i }))
    .sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors.map((c) => c / 100);
}

/** His attack, midfield and defence PAV rounded so they add up to his rounded season total. */
export function roundParts(parts: Record<Pool, number>, total: number): Record<Pool, number> {
  const [off = 0, mid = 0, def = 0] = roundToTotal([parts.off, parts.mid, parts.def], total);
  return { off, mid, def };
}
