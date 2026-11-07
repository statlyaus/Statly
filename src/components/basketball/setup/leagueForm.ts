import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import {
  BASKETBALL_CATEGORY_IDS,
  BASKETBALL_ROSTER_SLOTS,
  NINE_CATEGORY_PRESET,
  YAHOO_DEFAULT_ROSTER_SLOTS,
  type BasketballCategoryId,
  type BasketballPlatform,
  type BasketballRosterSlot,
  type BasketballRosterSlotCounts,
  type BasketballScoringFormat,
} from '@/types/basketball';

import type { SummaryError } from '../shell/formParts';

/**
 * Defaults for a new league. Change these each NBA season: week one starts on the Monday of the
 * season's first week (Yahoo's default) and the regular season ends on the NBA's last regular-season
 * day.
 */
export const NEW_LEAGUE_DEFAULTS = {
  platform: 'YAHOO' as BasketballPlatform,
  format: 'H2H_MOST_CATEGORIES' as BasketballScoringFormat,
  teamCount: 12,
  weekOneStartsOn: '2026-10-19',
  regularSeasonEndsOn: '2027-04-11',
};

export type LeagueFormMode = 'create' | 'edit';

/** What the inputs hold: text for number fields, so a cleared field stays empty while typing. */
export interface LeagueFormValues {
  name: string;
  platform: BasketballPlatform;
  format: BasketballScoringFormat;
  categories: BasketballCategoryId[];
  puntCategories: BasketballCategoryId[];
  teamCount: string;
  myTeamName: string;
  /** One name per line. */
  otherTeamNames: string;
  rosterSlots: Record<BasketballRosterSlot, string>;
  weekOneStartsOn: string;
  regularSeasonEndsOn: string;
  /** Comma-separated week numbers. */
  twoWeekMatchups: string;
  auctionBudget: string;
}

function slotsToText(slots: BasketballRosterSlotCounts): Record<BasketballRosterSlot, string> {
  return Object.fromEntries(
    BASKETBALL_ROSTER_SLOTS.map((slot) => [slot, String(slots[slot])])
  ) as Record<BasketballRosterSlot, string>;
}

export function yahooDefaultSlotText(): Record<BasketballRosterSlot, string> {
  return slotsToText(YAHOO_DEFAULT_ROSTER_SLOTS);
}

export function newLeagueValues(): LeagueFormValues {
  return {
    name: '',
    platform: NEW_LEAGUE_DEFAULTS.platform,
    format: NEW_LEAGUE_DEFAULTS.format,
    categories: [...NINE_CATEGORY_PRESET],
    puntCategories: [],
    teamCount: String(NEW_LEAGUE_DEFAULTS.teamCount),
    myTeamName: '',
    otherTeamNames: '',
    rosterSlots: yahooDefaultSlotText(),
    weekOneStartsOn: NEW_LEAGUE_DEFAULTS.weekOneStartsOn,
    regularSeasonEndsOn: NEW_LEAGUE_DEFAULTS.regularSeasonEndsOn,
    twoWeekMatchups: '',
    auctionBudget: '',
  };
}

export function leagueValuesFromDetail(league: BasketballLeagueDetail): LeagueFormValues {
  return {
    name: league.name,
    platform: league.platform,
    format: league.format,
    categories: [...league.categories],
    puntCategories: [...league.puntCategories],
    teamCount: String(league.teamCount),
    myTeamName: '',
    otherTeamNames: '',
    rosterSlots: slotsToText(league.rosterSlots),
    weekOneStartsOn: league.weekOneStartsOn,
    regularSeasonEndsOn: league.regularSeasonEndsOn,
    twoWeekMatchups: league.twoWeekMatchups.join(', '),
    auctionBudget: league.auctionBudget === null ? '' : String(league.auctionBudget),
  };
}

export type FieldErrors = Record<string, string[]>;

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * The request body, or the fields that are not numbers. Every other rule (ranges, dates, punts,
 * duplicates) is the server's: it answers with field errors that the form shows in place.
 * All ten roster slot counts are always sent.
 */
export function toLeaguePayload(
  values: LeagueFormValues,
  mode: LeagueFormMode
): { ok: true; payload: Record<string, unknown> } | { ok: false; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  const teamCount = wholeNumber(values.teamCount);
  if (teamCount === null) fieldErrors.teamCount = ['Enter the number of teams'];

  const rosterSlots = {} as Record<BasketballRosterSlot, number>;
  for (const slot of BASKETBALL_ROSTER_SLOTS) {
    const count = wholeNumber(values.rosterSlots[slot]);
    if (count === null) fieldErrors[`rosterSlots.${slot}`] = ['Enter a number from 0 to 10'];
    else rosterSlots[slot] = count;
  }

  const weekTokens = values.twoWeekMatchups.split(/[\s,]+/).filter(Boolean);
  const twoWeekMatchups = weekTokens.map(wholeNumber);
  if (twoWeekMatchups.some((week) => week === null)) {
    fieldErrors.twoWeekMatchups = ['Use week numbers separated by commas, such as 17'];
  }

  const auctionBudget =
    values.auctionBudget.trim() === '' ? null : wholeNumber(values.auctionBudget);
  if (values.auctionBudget.trim() !== '' && auctionBudget === null) {
    fieldErrors.auctionBudget = ['Enter a whole-dollar budget, or leave it empty'];
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const payload: Record<string, unknown> = {
    name: values.name,
    platform: values.platform,
    format: values.format,
    categories: BASKETBALL_CATEGORY_IDS.filter((id) => values.categories.includes(id)),
    puntCategories: BASKETBALL_CATEGORY_IDS.filter(
      (id) => values.puntCategories.includes(id) && values.categories.includes(id)
    ),
    teamCount,
    rosterSlots,
    weekOneStartsOn: values.weekOneStartsOn,
    regularSeasonEndsOn: values.regularSeasonEndsOn,
    twoWeekMatchups,
    auctionBudget,
  };
  if (mode === 'create') {
    payload.myTeamName = values.myTeamName;
    payload.otherTeamNames = otherTeamNameList(values.otherTeamNames);
  }
  return { ok: true, payload };
}

export function otherTeamNameList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The form control each API error path belongs to (`rosterSlots.PG` has its own input). */
export function fieldKeyOf(path: string): string {
  const [head, next] = path.split('.');
  return head === 'rosterSlots' && next ? `rosterSlots.${next}` : head;
}

export function fieldIdOf(key: string): string {
  return `bb-league-${key.replace('.', '-')}`;
}

/** Field errors grouped by control, with a list-item prefix where the API names an entry. */
export function groupFieldErrors(fieldErrors: FieldErrors, values: LeagueFormValues): FieldErrors {
  const grouped: FieldErrors = {};
  const others = otherTeamNameList(values.otherTeamNames);
  for (const [path, messages] of Object.entries(fieldErrors)) {
    const key = fieldKeyOf(path);
    const [head, index] = path.split('.');
    const prefix =
      head === 'otherTeamNames' && index !== undefined && others[Number(index)]
        ? `${others[Number(index)]}: `
        : head === 'twoWeekMatchups' && index !== undefined
          ? `Week ${values.twoWeekMatchups.split(/[\s,]+/).filter(Boolean)[Number(index)] ?? ''}: `
          : '';
    (grouped[key] ??= []).push(...messages.map((message) => `${prefix}${message}`));
  }
  return grouped;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'League name',
  platform: 'Platform',
  format: 'Scoring format',
  categories: 'Categories',
  puntCategories: 'Punts',
  teamCount: 'Number of teams',
  myTeamName: 'Your team name',
  otherTeamNames: 'Other teams',
  rosterSlots: 'Roster slots',
  weekOneStartsOn: 'Week 1 starts',
  regularSeasonEndsOn: 'Regular season ends',
  twoWeekMatchups: 'Two-week matchups',
  auctionBudget: 'Auction budget',
};

/** Summary lines in form order, each pointing at its control. */
export function summaryErrors(grouped: FieldErrors): SummaryError[] {
  const order = Object.keys(FIELD_LABELS);
  const rank = (key: string) => {
    const index = order.indexOf(key.split('.')[0]);
    return index === -1 ? order.length : index;
  };
  return Object.keys(grouped)
    .sort((left, right) => rank(left) - rank(right))
    .flatMap((key) => {
      const [head, slot] = key.split('.');
      const label = slot ? `${slot} slots` : (FIELD_LABELS[head] ?? head);
      return grouped[key].map((message) => ({
        fieldId: fieldIdOf(key),
        message: `${label}: ${message}`,
      }));
    });
}
