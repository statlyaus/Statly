'use client';

import { useOptimistic } from 'react';

import { fieldLabelStyles, fieldStyles } from '@/components/ui/controlStyles';

import type { SearchParams } from '../analysis/searchParams';
import { useParamNavigation } from '../analysis/useParamNavigation';
import type { RotationQuery, RotationShow } from './rotationView';

const SHOW_OPTIONS: { value: RotationShow; param: string | null; label: string }[] = [
  { value: 'ALL', param: null, label: 'All players' },
  { value: 'MINE', param: 'mine', label: 'My players' },
  { value: 'FREE_AGENTS', param: 'fa', label: 'Free agents' },
];

type FilterState = Pick<RotationQuery, 'show' | 'team'>;

/** Who the player table lists; the choice lives in the URL so the server renders it. */
export function RotationFilters({
  path,
  params,
  teamCodes,
  query,
}: {
  path: string;
  params: SearchParams;
  teamCodes: string[];
  query: FilterState;
}) {
  const { update, pending } = useParamNavigation(path, params);
  // Shown at once; the server render that follows the URL change confirms it.
  const [view, setView] = useOptimistic<FilterState, Partial<FilterState>>(
    { show: query.show, team: query.team },
    (current, patch) => ({ ...current, ...patch })
  );

  return (
    <form
      aria-label="Player table filters"
      aria-busy={pending}
      onSubmit={(event) => event.preventDefault()}
      className="grid grid-cols-2 gap-3 sm:flex sm:items-end"
    >
      <label className={`${fieldLabelStyles} sm:w-44`}>
        Show
        <select
          value={view.show}
          onChange={(event) => {
            const show = event.target.value as RotationShow;
            const option = SHOW_OPTIONS.find((candidate) => candidate.value === show);
            update({ show: option?.param ?? null, limit: null }, () => setView({ show }));
          }}
          className={fieldStyles({ size: 'sm' })}
        >
          {SHOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className={`${fieldLabelStyles} sm:w-36`}>
        NBA team
        <select
          value={view.team ?? ''}
          onChange={(event) => {
            const team = event.target.value || null;
            update({ team, limit: null }, () => setView({ team }));
          }}
          className={fieldStyles({ size: 'sm' })}
        >
          <option value="">All teams</option>
          {teamCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <p aria-live="polite" className="sr-only">
        {pending ? 'Updating players…' : ''}
      </p>
    </form>
  );
}
