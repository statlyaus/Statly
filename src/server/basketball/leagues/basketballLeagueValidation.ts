import { z } from 'zod';

import { daysBetween, isEasternDate, lastFantasyWeek } from '@/lib/basketball/fantasyWeeks';
import {
  BASKETBALL_CATEGORY_IDS,
  BASKETBALL_PLATFORMS,
  BASKETBALL_SCORING_FORMATS,
  countStarterSlots,
} from '@/types/basketball';

import { toValidationError } from './basketballLeagueErrors';

/** Players per paste or batch add: enough for every rostered player in a 16-team league. */
export const MAX_ROSTER_BATCH = 250;
export const MAX_PASTE_CHARACTERS = 40_000;
export const MAX_SEASON_DAYS = 200;
export const MAX_ROSTER_SLOTS_TOTAL = 25;
export const MAX_TWO_WEEK_MATCHUPS = 3;
export const PLAYER_SEARCH_DEFAULT_LIMIT = 20;

/** Parse untrusted input or throw a 400 `BasketballLeagueError` carrying field errors. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw toValidationError(parsed.error);
  return parsed.data;
}

const name = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');
const id = z.string().trim().min(1, 'Required').max(128);
export const easternDate = z.string().refine(isEasternDate, 'Use a real date as YYYY-MM-DD');
const category = z.enum(BASKETBALL_CATEGORY_IDS);
// Every slot type is required, on create and on update, so a partial rosterSlots object is rejected
// rather than silently zeroing the slots it leaves out. Stored rosterSlotsJson is always complete.
const slotCount = z.number('Use 0 to 10').int().min(0, 'Use 0 to 10').max(10, 'Use 0 to 10');

export const rosterSlotsSchema = z
  .strictObject({
    PG: slotCount,
    SG: slotCount,
    G: slotCount,
    SF: slotCount,
    PF: slotCount,
    F: slotCount,
    C: slotCount,
    UTIL: slotCount,
    BN: slotCount,
    IL: slotCount,
  })
  .superRefine((slots, context) => {
    if (countStarterSlots(slots) < 1) {
      context.addIssue({ code: 'custom', message: 'Add at least one starting slot' });
    }
    const total = Object.values(slots).reduce((sum, count) => sum + count, 0);
    if (total > MAX_ROSTER_SLOTS_TOTAL) {
      context.addIssue({
        code: 'custom',
        message: `Use at most ${MAX_ROSTER_SLOTS_TOTAL} roster spots in total`,
      });
    }
  });

const settingsShape = {
  name,
  platform: z.enum(BASKETBALL_PLATFORMS),
  format: z.enum(BASKETBALL_SCORING_FORMATS),
  categories: z.array(category).min(1, 'Choose at least one category'),
  puntCategories: z.array(category),
  teamCount: z.number().int().min(2, 'Use 2 to 30 teams').max(30, 'Use 2 to 30 teams'),
  rosterSlots: rosterSlotsSchema,
  weekOneStartsOn: easternDate,
  regularSeasonEndsOn: easternDate,
  auctionBudget: z.number().int().min(1, 'Use 1 to 10000').max(10_000, 'Use 1 to 10000').nullable(),
  /** Fantasy weeks that span 14 Eastern dates, such as the All-Star break matchup. */
  twoWeekMatchups: z
    .array(z.number().int().min(1, 'Weeks start at 1'))
    .max(MAX_TWO_WEEK_MATCHUPS, `List at most ${MAX_TWO_WEEK_MATCHUPS} two-week matchups`),
};

type SettingsRuleInput = Pick<
  z.output<z.ZodObject<typeof settingsShape>>,
  'categories' | 'puntCategories' | 'weekOneStartsOn' | 'regularSeasonEndsOn' | 'twoWeekMatchups'
>;

function checkSettings(value: SettingsRuleInput, context: z.RefinementCtx): void {
  if (new Set(value.categories).size !== value.categories.length) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'List each category once' });
  }
  const punts = new Set(value.puntCategories);
  if (punts.size !== value.puntCategories.length) {
    context.addIssue({ code: 'custom', path: ['puntCategories'], message: 'List each punt once' });
  }
  if (value.puntCategories.some((punt) => !value.categories.includes(punt))) {
    context.addIssue({
      code: 'custom',
      path: ['puntCategories'],
      message: 'Only punt categories the league counts',
    });
  } else if (value.categories.length > 0 && punts.size >= new Set(value.categories).size) {
    context.addIssue({
      code: 'custom',
      path: ['puntCategories'],
      message: 'Keep at least one category you are not punting',
    });
  }
  if (isEasternDate(value.weekOneStartsOn) && isEasternDate(value.regularSeasonEndsOn)) {
    const days = daysBetween(value.weekOneStartsOn, value.regularSeasonEndsOn);
    if (days <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['regularSeasonEndsOn'],
        message: 'The season must end after week one starts',
      });
    } else if (days > MAX_SEASON_DAYS) {
      context.addIssue({
        code: 'custom',
        path: ['regularSeasonEndsOn'],
        message: `The season can be at most ${MAX_SEASON_DAYS} days long`,
      });
    } else {
      const lastWeek = lastFantasyWeek(
        value.weekOneStartsOn,
        value.regularSeasonEndsOn,
        value.twoWeekMatchups
      );
      value.twoWeekMatchups.forEach((week, index) => {
        if (value.twoWeekMatchups.indexOf(week) !== index) {
          context.addIssue({
            code: 'custom',
            path: ['twoWeekMatchups', index],
            message: 'List each week once',
          });
        } else if (week > lastWeek) {
          context.addIssue({
            code: 'custom',
            path: ['twoWeekMatchups', index],
            message: `The season has ${lastWeek} weeks`,
          });
        }
      });
    }
  }
}

function duplicateIndexes(values: readonly string[]): number[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return [index];
    seen.add(key);
    return [];
  });
}

/** A league's stored settings; the full rule set, applied to create input and to merged updates. */
export const leagueSettingsSchema = z.strictObject(settingsShape).superRefine(checkSettings);
export type BasketballLeagueSettings = z.output<typeof leagueSettingsSchema>;

export const leaguePatchSchema = z.strictObject(settingsShape).partial();
export type BasketballLeaguePatch = z.output<typeof leaguePatchSchema>;

export const createLeagueSchema = z
  .strictObject({
    ...settingsShape,
    puntCategories: settingsShape.puntCategories.default([]),
    auctionBudget: settingsShape.auctionBudget.default(null),
    twoWeekMatchups: settingsShape.twoWeekMatchups.default([]),
    myTeamName: name,
    otherTeamNames: z.array(name).default([]),
  })
  .superRefine((value, context) => {
    checkSettings(value, context);
    if (value.otherTeamNames.length > value.teamCount - 1) {
      context.addIssue({
        code: 'custom',
        path: ['otherTeamNames'],
        message: `A ${value.teamCount}-team league has at most ${value.teamCount - 1} other teams`,
      });
    }
    for (const index of duplicateIndexes([value.myTeamName, ...value.otherTeamNames])) {
      context.addIssue({
        code: 'custom',
        path: ['otherTeamNames', index - 1],
        message: 'Use a different name for each team',
      });
    }
  });
export type CreateBasketballLeagueInput = z.output<typeof createLeagueSchema>;

export const teamsSchema = z
  .strictObject({
    teams: z
      .array(z.strictObject({ id: id.optional(), name }))
      .min(1, 'Keep your own team')
      .max(30),
  })
  .superRefine((value, context) => {
    for (const index of duplicateIndexes(value.teams.map((team) => team.name))) {
      context.addIssue({
        code: 'custom',
        path: ['teams', index, 'name'],
        message: 'Use a different name for each team',
      });
    }
    const ids = value.teams.map((team) => team.id ?? '');
    ids.forEach((teamId, index) => {
      if (teamId && ids.indexOf(teamId) !== index) {
        context.addIssue({
          code: 'custom',
          path: ['teams', index, 'id'],
          message: 'List each team once',
        });
      }
    });
  });
export type BasketballTeamsInput = z.output<typeof teamsSchema>;

export const rosterEntriesSchema = z
  .strictObject({
    entries: z
      .array(
        z.strictObject({
          playerId: id,
          teamId: id.nullable(),
          onInjuredList: z.boolean().optional(),
          acquiredOn: easternDate.optional(),
        })
      )
      .min(1, 'Add at least one player')
      .max(MAX_ROSTER_BATCH, `Add at most ${MAX_ROSTER_BATCH} players at a time`),
  })
  .superRefine((value, context) => {
    const ids = value.entries.map((entry) => entry.playerId);
    ids.forEach((playerId, index) => {
      if (ids.indexOf(playerId) !== index) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'playerId'],
          message: 'List each player once',
        });
      }
    });
  });
export type BasketballRosterEntriesInput = z.output<typeof rosterEntriesSchema>;

export const rosterSpotPatchSchema = z
  .strictObject({
    teamId: id.nullable().optional(),
    onInjuredList: z.boolean().optional(),
    acquiredOn: easternDate.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');
export type BasketballRosterSpotPatch = z.output<typeof rosterSpotPatchSchema>;

/** A fantasy week: a number, or the digits of a URL segment. */
export const weekSchema = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)], {
    error: 'Use a whole week number',
  })
  .pipe(z.number().int('Use a whole week number').min(1, 'Weeks start at 1'));

export const matchupSchema = z.strictObject({ opponentTeamId: id });

export const pasteSchema = z.strictObject({
  text: z
    .string()
    .min(1, 'Paste at least one name')
    .max(MAX_PASTE_CHARACTERS, 'Paste at most 40,000 characters'),
});

export const playerSearchSchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(60),
  limit: z.coerce.number().int().min(1).max(50).default(PLAYER_SEARCH_DEFAULT_LIMIT),
});
