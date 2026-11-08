'use client';

import { fieldStyles } from '@/components/ui/controlStyles';
import { isEasternDate, lastFantasyWeek } from '@/lib/basketball/fantasyWeeks';

import { Field, FormSection, describedBy } from '../../shell/formParts';

import type { LeagueSectionProps } from './sectionProps';

export function CalendarSection({ values, update, error, ids }: LeagueSectionProps) {
  const datesValid =
    isEasternDate(values.weekOneStartsOn) &&
    isEasternDate(values.regularSeasonEndsOn) &&
    values.regularSeasonEndsOn > values.weekOneStartsOn;
  const weekCount = datesValid
    ? lastFantasyWeek(values.weekOneStartsOn, values.regularSeasonEndsOn)
    : null;

  return (
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
  );
}
