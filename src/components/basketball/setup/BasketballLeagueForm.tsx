'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import { lastFantasyWeek, isEasternDate } from '@/lib/basketball/fantasyWeeks';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import {
  BASKETBALL_CATEGORIES,
  BASKETBALL_PLATFORMS,
  BASKETBALL_ROSTER_SLOTS,
  EIGHT_CATEGORY_PRESET,
  NINE_CATEGORY_PRESET,
  type BasketballCategoryId,
  type BasketballScoringFormat,
} from '@/types/basketball';

import { callBasketballApi } from '../shell/basketballApi';
import { PLATFORM_LABELS, basketballLeagueHref } from '../shell/basketballFormat';
import {
  ErrorSummary,
  Field,
  FieldError,
  FieldHelp,
  FormSection,
  describedBy,
} from '../shell/formParts';
import {
  fieldIdOf,
  groupFieldErrors,
  leagueValuesFromDetail,
  newLeagueValues,
  summaryErrors,
  toLeaguePayload,
  yahooDefaultSlotText,
  type FieldErrors,
  type LeagueFormValues,
} from './leagueForm';

const FORMAT_OPTIONS: { value: BasketballScoringFormat; label: string; help: string }[] = [
  {
    value: 'H2H_MOST_CATEGORIES',
    label: 'H2H most categories',
    help: 'Whoever wins more categories wins the week. Statly shows your chance of winning it.',
  },
  {
    value: 'H2H_EACH_CATEGORY',
    label: 'H2H each category',
    help: 'Every category is its own win or loss. Statly shows your expected record for the week.',
  },
];

const PRESETS = [
  { id: 'nine', label: '9-category', categories: NINE_CATEGORY_PRESET },
  { id: 'eight', label: '8-category (no turnovers)', categories: EIGHT_CATEGORY_PRESET },
] as const;

const SLOT_HELP: Record<string, string> = { BN: 'Bench', IL: 'Injured list' };

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

type Props =
  { mode: 'create'; league?: undefined } | { mode: 'edit'; league: BasketballLeagueDetail };

/**
 * League settings for a new profile (POST, then the Roster page) or an existing one (PATCH, then a
 * refresh). Each setting says in one line what it changes in Statly. The server validates; its
 * field errors appear beside each field and in a summary that takes focus.
 */
export function BasketballLeagueForm({ mode, league }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<LeagueFormValues>(() =>
    league ? leagueValuesFromDetail(league) : newLeagueValues()
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  const summary = useMemo(() => summaryErrors(errors), [errors]);
  const error = (key: string) => errors[key]?.join(' ');
  const create = mode === 'create';

  function update<K extends keyof LeagueFormValues>(key: K, value: LeagueFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function toggleCategory(id: BasketballCategoryId, checked: boolean) {
    setValues((current) => ({
      ...current,
      categories: checked
        ? [...current.categories, id]
        : current.categories.filter((category) => category !== id),
      puntCategories: checked
        ? current.puntCategories
        : current.puntCategories.filter((category) => category !== id),
    }));
    setSaved(false);
  }

  function showErrors(fieldErrors: FieldErrors, messages: string[]) {
    setErrors(groupFieldErrors(fieldErrors, values));
    setFormErrors(messages);
    setFocusRequest((count) => count + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSaved(false);
    const built = toLeaguePayload(values, mode);
    if (!built.ok) {
      showErrors(built.fieldErrors, []);
      return;
    }

    setPending(true);
    const result = league
      ? await callBasketballApi<BasketballLeagueDetail>(
          `/api/basketball/leagues/${encodeURIComponent(league.id)}`,
          'PATCH',
          built.payload
        )
      : await callBasketballApi<BasketballLeagueDetail>(
          '/api/basketball/leagues',
          'POST',
          built.payload
        );

    if (!result.ok) {
      setPending(false);
      const hasFieldErrors = Object.keys(result.fieldErrors).length > 0;
      showErrors(
        result.fieldErrors,
        hasFieldErrors && result.formErrors.length === 0
          ? []
          : [...result.formErrors, result.message]
      );
      return;
    }

    setErrors({});
    setFormErrors([]);
    if (create) {
      // Keep the button busy while the Roster page loads.
      router.push(basketballLeagueHref(result.data.id, 'roster'));
      return;
    }
    setPending(false);
    setSaved(true);
    router.refresh();
  }

  const errorCount = summary.length + formErrors.length;
  const preset = PRESETS.find((option) => sameSet(option.categories, values.categories));
  const slotTotals = BASKETBALL_ROSTER_SLOTS.reduce(
    (totals, slot) => {
      const count = Number(values.rosterSlots[slot]) || 0;
      if (slot === 'BN') totals.bench += count;
      else if (slot === 'IL') totals.il += count;
      else totals.starters += count;
      return totals;
    },
    { starters: 0, bench: 0, il: 0 }
  );
  const datesValid =
    isEasternDate(values.weekOneStartsOn) &&
    isEasternDate(values.regularSeasonEndsOn) &&
    values.regularSeasonEndsOn > values.weekOneStartsOn;
  const weekCount = datesValid
    ? lastFantasyWeek(values.weekOneStartsOn, values.regularSeasonEndsOn)
    : null;

  const ids = {
    name: fieldIdOf('name'),
    platform: fieldIdOf('platform'),
    format: fieldIdOf('format'),
    categories: fieldIdOf('categories'),
    punts: fieldIdOf('puntCategories'),
    teamCount: fieldIdOf('teamCount'),
    myTeamName: fieldIdOf('myTeamName'),
    otherTeamNames: fieldIdOf('otherTeamNames'),
    rosterSlots: fieldIdOf('rosterSlots'),
    weekOne: fieldIdOf('weekOneStartsOn'),
    seasonEnd: fieldIdOf('regularSeasonEndsOn'),
    twoWeek: fieldIdOf('twoWeekMatchups'),
    budget: fieldIdOf('auctionBudget'),
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
      className="[&_[aria-invalid=true]]:border-destructive"
    >
      {errorCount > 0 ? (
        <div className="mb-2">
          <ErrorSummary
            ref={summaryRef}
            title={`Check ${errorCount} ${errorCount === 1 ? 'field' : 'fields'}`}
            formErrors={formErrors}
            errors={summary}
          />
        </div>
      ) : null}

      <FormSection
        id="bb-basics"
        title="League basics"
        summary="Tell Statly which league this is and how it decides a week."
      >
        <Field
          id={ids.name}
          label="League name"
          help="Shown at the top of every page for this league."
          error={error('name')}
        >
          <input
            id={ids.name}
            name="name"
            autoComplete="off"
            maxLength={60}
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            aria-invalid={error('name') ? true : undefined}
            aria-describedby={describedBy(ids.name, true, error('name'))}
            className={fieldStyles()}
          />
        </Field>

        <Field
          id={ids.platform}
          label="Platform"
          help="A label only. Statly doesn't connect to it: you enter teams and rosters here."
          error={error('platform')}
          className="sm:max-w-xs"
        >
          <select
            id={ids.platform}
            value={values.platform}
            onChange={(event) =>
              update('platform', event.target.value as LeagueFormValues['platform'])
            }
            aria-invalid={error('platform') ? true : undefined}
            aria-describedby={describedBy(ids.platform, true, error('platform'))}
            className={fieldStyles()}
          >
            {BASKETBALL_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
        </Field>

        <fieldset
          id={ids.format}
          tabIndex={-1}
          aria-describedby={describedBy(ids.format, undefined, error('format'))}
          className="flex flex-col gap-2 outline-none"
        >
          <legend className="text-sm font-semibold text-foreground">Scoring format</legend>
          {FORMAT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border border-border p-3 has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name="format"
                value={option.value}
                checked={values.format === option.value}
                onChange={() => update('format', option.value)}
                className="row-span-2 mt-0.5 size-4 accent-brand-bar focus:outline-none"
              />
              <span className="text-sm font-semibold text-foreground">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.help}</span>
            </label>
          ))}
          <FieldError id={ids.format} error={error('format')} />
        </fieldset>
      </FormSection>

      <FormSection
        id="bb-categories"
        title="Categories"
        summary="Statly values players and projects matchups only on the categories you count."
      >
        <fieldset
          id={ids.categories}
          tabIndex={-1}
          aria-describedby={describedBy(ids.categories, true, error('categories'))}
          className="flex flex-col gap-2 outline-none"
        >
          <legend className="text-sm font-semibold text-foreground">Counted categories</legend>
          <FieldHelp id={ids.categories}>Pick a preset, or tick categories one by one.</FieldHelp>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category preset">
            {PRESETS.map((option) => (
              <label
                key={option.id}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="category-preset"
                  checked={preset?.id === option.id}
                  onChange={() =>
                    setValues((current) => ({
                      ...current,
                      categories: [...option.categories],
                      puntCategories: current.puntCategories.filter((punt) =>
                        option.categories.includes(punt)
                      ),
                    }))
                  }
                  className="size-4 accent-brand-bar focus:outline-none"
                />
                {option.label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BASKETBALL_CATEGORIES.map((category) => (
              <label
                key={category.id}
                className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-md border border-border px-3 py-1.5 leading-tight has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  checked={values.categories.includes(category.id)}
                  onChange={(event) => toggleCategory(category.id, event.target.checked)}
                  className="row-span-2 size-4 accent-brand-bar focus:outline-none"
                />
                <span className="text-sm font-bold text-foreground">{category.shortLabel}</span>
                <span className="truncate text-xs text-muted-foreground">{category.label}</span>
              </label>
            ))}
          </div>
          <FieldError id={ids.categories} error={error('categories')} />
        </fieldset>

        <fieldset
          id={ids.punts}
          tabIndex={-1}
          aria-describedby={describedBy(ids.punts, true, error('puntCategories'))}
          className="flex flex-col gap-2 outline-none"
        >
          <legend className="text-sm font-semibold text-foreground">Punts (optional)</legend>
          <FieldHelp id={ids.punts}>
            Punted categories are left out of player value, so rankings favour players who help
            everywhere else. You can also try punts on the Players page.
          </FieldHelp>
          <div className="flex flex-wrap gap-2">
            {BASKETBALL_CATEGORIES.filter((category) =>
              values.categories.includes(category.id)
            ).map((category) => (
              <label
                key={category.id}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  checked={values.puntCategories.includes(category.id)}
                  onChange={(event) =>
                    update(
                      'puntCategories',
                      event.target.checked
                        ? [...values.puntCategories, category.id]
                        : values.puntCategories.filter((punt) => punt !== category.id)
                    )
                  }
                  className="size-4 accent-brand-bar focus:outline-none"
                />
                <span>
                  <span className="sr-only">Punt </span>
                  {category.shortLabel}
                </span>
              </label>
            ))}
          </div>
          <FieldError id={ids.punts} error={error('puntCategories')} />
        </fieldset>
      </FormSection>

      <FormSection
        id="bb-teams"
        title={create ? 'Teams' : 'League size'}
        summary={
          create
            ? 'Your team, and any others you want to track. You can add teams later.'
            : 'Team names are in the Teams section below.'
        }
      >
        <Field
          id={ids.teamCount}
          label="Number of teams"
          help="Sets replacement level: the more teams, the fewer useful players left as free agents."
          error={error('teamCount')}
          className="sm:max-w-xs"
        >
          <input
            id={ids.teamCount}
            type="number"
            inputMode="numeric"
            min={2}
            max={30}
            value={values.teamCount}
            onChange={(event) => update('teamCount', event.target.value)}
            aria-invalid={error('teamCount') ? true : undefined}
            aria-describedby={describedBy(ids.teamCount, true, error('teamCount'))}
            className={fieldStyles()}
          />
        </Field>
        {create ? (
          <>
            <Field
              id={ids.myTeamName}
              label="Your team name"
              help="Your roster, matchups and pickups are all worked out for this team."
              error={error('myTeamName')}
            >
              <input
                id={ids.myTeamName}
                autoComplete="off"
                maxLength={60}
                value={values.myTeamName}
                onChange={(event) => update('myTeamName', event.target.value)}
                aria-invalid={error('myTeamName') ? true : undefined}
                aria-describedby={describedBy(ids.myTeamName, true, error('myTeamName'))}
                className={fieldStyles()}
              />
            </Field>
            <Field
              id={ids.otherTeamNames}
              label="Other team names (optional)"
              help="One per line. Add this week's opponent at least, so Statly can project the matchup."
              error={error('otherTeamNames')}
            >
              <textarea
                id={ids.otherTeamNames}
                rows={4}
                value={values.otherTeamNames}
                onChange={(event) => update('otherTeamNames', event.target.value)}
                aria-invalid={error('otherTeamNames') ? true : undefined}
                aria-describedby={describedBy(ids.otherTeamNames, true, error('otherTeamNames'))}
                className={fieldStyles({ size: 'area' })}
              />
            </Field>
          </>
        ) : null}
      </FormSection>

      <FormSection
        id="bb-slots"
        title="Roster slots"
        summary="Decides which of your players count each day when more of them play than you can start."
      >
        <fieldset
          id={ids.rosterSlots}
          tabIndex={-1}
          aria-describedby={describedBy(ids.rosterSlots, true, error('rosterSlots'))}
          className="flex flex-col gap-3 outline-none"
        >
          <legend className="sr-only">Roster slots</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldHelp id={ids.rosterSlots}>
              {slotTotals.starters} starters, {slotTotals.bench} bench, {slotTotals.il} injured
              list. Bench and injured-list players never count.
            </FieldHelp>
            <button
              type="button"
              onClick={() => update('rosterSlots', yahooDefaultSlotText())}
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            >
              Use Yahoo default
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {BASKETBALL_ROSTER_SLOTS.map((slot) => {
              const key = `rosterSlots.${slot}`;
              const id = fieldIdOf(key);
              return (
                <div key={slot} className="flex min-w-0 flex-col gap-1">
                  <label
                    htmlFor={id}
                    className="text-xs font-bold text-foreground"
                    title={SLOT_HELP[slot]}
                  >
                    {slot}
                  </label>
                  <input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10}
                    value={values.rosterSlots[slot]}
                    onChange={(event) =>
                      update('rosterSlots', { ...values.rosterSlots, [slot]: event.target.value })
                    }
                    aria-invalid={error(key) ? true : undefined}
                    aria-describedby={describedBy(id, undefined, error(key))}
                    className={fieldStyles({ className: 'px-2 tabular-nums' })}
                  />
                  <FieldError id={id} error={error(key)} />
                </div>
              );
            })}
          </div>
          <FieldError id={ids.rosterSlots} error={error('rosterSlots')} />
        </fieldset>
      </FormSection>

      <FormSection
        id="bb-calendar"
        title="Calendar"
        summary="Fantasy weeks count US Eastern game dates, as Yahoo and ESPN do."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={ids.weekOne}
            label="Week 1 starts"
            help="Each fantasy week runs seven days from this date."
            error={error('weekOneStartsOn')}
          >
            <input
              id={ids.weekOne}
              type="date"
              value={values.weekOneStartsOn}
              onChange={(event) => update('weekOneStartsOn', event.target.value)}
              aria-invalid={error('weekOneStartsOn') ? true : undefined}
              aria-describedby={describedBy(ids.weekOne, true, error('weekOneStartsOn'))}
              className={fieldStyles()}
            />
          </Field>
          <Field
            id={ids.seasonEnd}
            label="Regular season ends"
            help={
              datesValid
                ? `The last day of your fantasy regular season: ${weekCount} weeks.`
                : 'The last day of your fantasy regular season.'
            }
            error={error('regularSeasonEndsOn')}
          >
            <input
              id={ids.seasonEnd}
              type="date"
              value={values.regularSeasonEndsOn}
              onChange={(event) => update('regularSeasonEndsOn', event.target.value)}
              aria-invalid={error('regularSeasonEndsOn') ? true : undefined}
              aria-describedby={describedBy(ids.seasonEnd, true, error('regularSeasonEndsOn'))}
              className={fieldStyles()}
            />
          </Field>
        </div>
        <Field
          id={ids.twoWeek}
          label="Two-week matchups (optional)"
          help="Week numbers that last 14 days, such as an All-Star break matchup. Later weeks start seven days later."
          error={error('twoWeekMatchups')}
          className="sm:max-w-xs"
        >
          <input
            id={ids.twoWeek}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 17"
            value={values.twoWeekMatchups}
            onChange={(event) => update('twoWeekMatchups', event.target.value)}
            aria-invalid={error('twoWeekMatchups') ? true : undefined}
            aria-describedby={describedBy(ids.twoWeek, true, error('twoWeekMatchups'))}
            className={fieldStyles()}
          />
        </Field>
      </FormSection>

      <FormSection id="bb-auction" title="Auction" summary="Only for auction drafts and keepers.">
        <Field
          id={ids.budget}
          label="Auction budget"
          help="Optional. With a budget, the Players page shows each player's auction dollar value."
          error={error('auctionBudget')}
          className="sm:max-w-xs"
        >
          <input
            id={ids.budget}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="e.g. 200"
            value={values.auctionBudget}
            onChange={(event) => update('auctionBudget', event.target.value)}
            aria-invalid={error('auctionBudget') ? true : undefined}
            aria-describedby={describedBy(ids.budget, true, error('auctionBudget'))}
            className={fieldStyles()}
          />
        </Field>
      </FormSection>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-end">
        {saved ? (
          <p role="status" className="text-sm font-medium text-foreground sm:mr-auto">
            Settings saved.
          </p>
        ) : null}
        {create ? (
          <Link href="/basketball" className={buttonStyles({ variant: 'outline' })}>
            Cancel
          </Link>
        ) : null}
        <button type="submit" disabled={pending} className={buttonStyles({ variant: 'primary' })}>
          {pending
            ? create
              ? 'Creating…'
              : 'Saving…'
            : create
              ? 'Create league'
              : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
