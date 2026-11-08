/**
 * Display formatting for the basketball analysis pages. Pure and isomorphic.
 */

import type { EasternDate } from '@/lib/basketball/fantasyWeeks';
import { categoryValue } from '@/lib/basketball/statLine';
import {
  getBasketballCategory,
  type BasketballCategoryId,
  type NbaStatLine,
} from '@/types/basketball';

const MINUS = '−';

/** Basketball percentage style: .489 (no leading zero). */
export function formatPct(value: number): string {
  return value.toFixed(3).replace(/^0/, '');
}

/** A category's value in a stat line: .489 for percentages ("–" with no attempts), else a count. */
export function formatCategory(
  categoryId: BasketballCategoryId,
  line: NbaStatLine,
  digits = 1
): string {
  const category = getBasketballCategory(categoryId);
  if (category.kind === 'PERCENT') {
    return line[category.attempted] > 0 ? formatPct(categoryValue(line, category)) : '–';
  }
  const value = line[category.stat];
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

/** A signed number with a real minus sign: +1.2, −0.8, 0.0. */
export function formatSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(digits)}`;
}

/** A category margin: percentage points as .012, counts to one decimal. */
export function formatMargin(categoryId: BasketballCategoryId, margin: number): string {
  if (getBasketballCategory(categoryId).kind === 'PERCENT') {
    const text = formatSigned(margin, 3);
    return text.replace(/^([+−]?)0\./, '$1.');
  }
  return formatSigned(margin, 1);
}

/** A probability as a whole percentage, never claiming certainty it does not have. */
export function formatChance(probability: number): string {
  if (probability >= 0.995 && probability < 1) return '>99%';
  if (probability <= 0.005 && probability > 0) return '<1%';
  return `${Math.round(probability * 100)}%`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** An Eastern game date as "Mon 2 Nov" (dates, not times). */
export function formatGameDate(date: EasternDate): string {
  return DATE_FORMAT.format(new Date(`${date}T00:00:00.000Z`)).replace(',', '');
}

export function formatDateRange(start: EasternDate, end: EasternDate): string {
  return `${formatGameDate(start)} – ${formatGameDate(end)}`;
}

/** "3 hours ago" style age of an ISO instant, for the stale-data notice. */
export function formatAge(iso: string, now: Date): string {
  const hours = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${Math.floor(hours)} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
