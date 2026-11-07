'use client';

import { fieldStyles } from '@/components/ui/controlStyles';

import { Field, FormSection, describedBy } from '../../shell/formParts';

import type { LeagueSectionProps } from './sectionProps';

export function TeamsSection({
  values,
  update,
  error,
  ids,
  create,
}: LeagueSectionProps & { create: boolean }) {
  return (
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
  );
}
