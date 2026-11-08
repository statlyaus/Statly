import type { EasternDate } from '@/lib/basketball/fantasyWeeks';
import type { BasketballPlatform, BasketballScoringFormat } from '@/types/basketball';

/** Labels and date text shared by the basketball pages. Pure: safe on server and client. */

export const PLATFORM_LABELS: Record<BasketballPlatform, string> = {
  YAHOO: 'Yahoo',
  ESPN: 'ESPN',
  SLEEPER: 'Sleeper',
  FANTRAX: 'Fantrax',
  OTHER: 'Other',
};

export const FORMAT_LABELS: Record<BasketballScoringFormat, string> = {
  H2H_MOST_CATEGORIES: 'H2H most categories',
  H2H_EACH_CATEGORY: 'H2H each category',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: EasternDate) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return {
    weekday: WEEKDAYS[value.getUTCDay()],
    day: value.getUTCDate(),
    month: MONTHS[value.getUTCMonth()],
    year: value.getUTCFullYear(),
  };
}

/** "Mon 2 Nov": US Eastern game and week dates are dates, never times. */
export function formatEasternDate(date: EasternDate): string {
  const { weekday, day, month } = parts(date);
  return `${weekday} ${day} ${month}`;
}

/** "2 Nov 2026" */
export function formatLongDate(date: EasternDate): string {
  const { day, month, year } = parts(date);
  return `${day} ${month} ${year}`;
}

/** "2–8 Nov", or "26 Oct – 1 Nov" across a month end. */
export function formatDateSpan(start: EasternDate, end: EasternDate): string {
  const from = parts(start);
  const to = parts(end);
  return from.month === to.month
    ? `${from.day}–${to.day} ${to.month}`
    : `${from.day} ${from.month} – ${to.day} ${to.month}`;
}

/** "Week 3 · 2–8 Nov" */
export function formatWeekLabel(week: { week: number; start: EasternDate; end: EasternDate }) {
  return `Week ${week.week} · ${formatDateSpan(week.start, week.end)}`;
}

/** "just now", "40 min ago", "3 h ago", "2 days ago". */
export function formatTimeAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function basketballLeagueHref(leagueId: string, section = ''): string {
  return `/basketball/${encodeURIComponent(leagueId)}${section ? `/${section}` : ''}`;
}
