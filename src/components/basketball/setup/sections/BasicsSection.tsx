'use client';

import { fieldStyles } from '@/components/ui/controlStyles';
import { BASKETBALL_PLATFORMS, type BasketballScoringFormat } from '@/types/basketball';

import { PLATFORM_LABELS } from '../../shell/basketballFormat';
import { Field, FieldError, FormSection, describedBy } from '../../shell/formParts';
import type { LeagueFormValues } from '../leagueForm';

import type { LeagueSectionProps } from './sectionProps';

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

export function BasicsSection({ values, update, error, ids }: LeagueSectionProps) {
  return (
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
  );
}
