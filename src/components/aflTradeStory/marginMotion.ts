import type { TreeMarginPoint } from './tradeTreeModel';

/**
 * The maths behind the margin rail's intro (owner, 2026-11-28): one eased clock, a smooth curve
 * through every checkpoint, and the rail's scale. Pure, so the rail, the phone strip and the tests
 * share it.
 */

/** The intro's length in milliseconds; values start arriving at `ARRIVE` of it. */
export const INTRO_MS = 3400;
export const ARRIVE = 0.82;

/** Ease in and out: slow off the mark, slow into the finish, no stop between seasons. */
export const ease = (q: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, q)));

/**
 * The value at a fractional position along the points (Catmull-Rom through each point), so the knob
 * glides rather than steps. Position 0 is the first point, `points.length - 1` the last.
 */
export function marginAt(values: readonly number[], position: number): number {
  const count = values.length;
  if (count === 0) return 0;
  if (count === 1 || position <= 0) return values[0]!;
  if (position >= count - 1) return values[count - 1]!;
  const at = Math.floor(position);
  const f = position - at;
  const p0 = values[Math.max(0, at - 1)]!;
  const p1 = values[at]!;
  const p2 = values[at + 1]!;
  const p3 = values[Math.min(count - 1, at + 2)]!;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
  );
}

/** Linear between the points: where the lanes' reveal has got to. */
export function linearAt(values: readonly number[], position: number): number {
  const count = values.length;
  if (count === 0) return 0;
  if (count === 1 || position <= 0) return values[0]!;
  if (position >= count - 1) return values[count - 1]!;
  const at = Math.floor(position);
  return values[at]! + (values[at + 1]! - values[at]!) * (position - at);
}

/** The rail's scale: the largest margin rounded up to a multiple of 20, never under 20. */
export const railTop = (points: readonly TreeMarginPoint[]) =>
  Math.max(20, Math.ceil(Math.max(...points.map(({ value }) => Math.abs(value))) / 20) * 20);

/**
 * The margin as the page writes a net: "+55.0", with "*" while a leg is not in yet (as `netText`
 * does), or "Level". The club ahead is a separate line, so no club name is ever cut short.
 */
export function marginText(value: number, pendingCount = 0): string {
  if (Math.abs(value) < 0.05) return 'Level';
  return `+${Math.abs(value).toFixed(1)}${pendingCount > 0 ? '*' : ''}`;
}

/** The club ahead at this value, or null when level. */
export const leaderOf = (value: number, upper: string, lower: string) =>
  Math.abs(value) < 0.05 ? null : value > 0 ? upper : lower;
