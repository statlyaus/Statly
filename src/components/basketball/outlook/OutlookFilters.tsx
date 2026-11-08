'use client';

import { useOptimistic } from 'react';

import { fieldLabelStyles, fieldStyles } from '@/components/ui/controlStyles';

import type { SearchParams } from '../analysis/searchParams';
import { useParamNavigation } from '../analysis/useParamNavigation';
import { SORTS, type OutlookQuery, type OutlookShow, type OutlookTableView } from './outlookView';

const VIEW_OPTIONS: { value: OutlookTableView; param: string | null; label: string }[] = [
  { value: 'NEXT5', param: null, label: 'Next 5 games' },
  { value: 'ROS', param: 'ros', label: 'Rest of season' },
];

const SHOW_OPTIONS: { value: OutlookShow; param: string | null; label: string }[] = [
  { value: 'RELEVANT', param: null, label: 'Rostered and top free agents' },
  { value: 'MINE', param: 'mine', label: 'My players' },
  { value: 'OPPONENT', param: 'opponent', label: "This week's opponent" },
  { value: 'FREE_AGENTS', param: 'fa', label: 'Free agents' },
  { value: 'ROSTERED', param: 'rostered', label: 'All rostered players' },
  { value: 'ALL', param: 'all', label: 'All players' },
];

type FilterState = Pick<OutlookQuery, 'view' | 'show'>;

/** The table's projection and who it lists; the choice lives in the URL so the server renders it. */
export function OutlookFilters({
  path,
  params,
  query,
}: {
  path: string;
  params: SearchParams;
  query: Pick<OutlookQuery, 'view' | 'show' | 'sort'>;
}) {
  const { update, pending } = useParamNavigation(path, params);
  // Shown at once; the server render that follows the URL change confirms it.
  const [state, setState] = useOptimistic<FilterState, Partial<FilterState>>(
    { view: query.view, show: query.show },
    (current, patch) => ({ ...current, ...patch })
  );

  return (
    <form
      aria-label="Outlook table filters"
      aria-busy={pending}
      onSubmit={(event) => event.preventDefault()}
      className="grid gap-3 sm:flex sm:items-end"
    >
      <div role="group" aria-label="Projection" className="flex">
        {VIEW_OPTIONS.map((option, index) => {
          const pressed = state.view === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                if (pressed) return;
                // A sort the other view lacks would silently fall back: drop it with its direction.
                const keep =
                  query.sort === 'name' || Object.hasOwn(SORTS[option.value], query.sort);
                update({ view: option.param, ...(keep ? {} : { sort: null, dir: null }) }, () =>
                  setState({ view: option.value })
                );
              }}
              className={`min-h-9 flex-1 border border-border px-3 text-sm font-semibold focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none ${
                index === 0 ? 'rounded-l-md' : '-ml-px rounded-r-md'
              } ${
                pressed
                  ? 'bg-brand-bar text-brand-bar-foreground'
                  : 'bg-background text-foreground hover:bg-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <label className={`${fieldLabelStyles} sm:w-64`}>
        Show
        <select
          value={state.show}
          onChange={(event) => {
            const show = event.target.value as OutlookShow;
            const option = SHOW_OPTIONS.find((candidate) => candidate.value === show);
            update({ show: option?.param ?? null }, () => setState({ show }));
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
      <p aria-live="polite" className="sr-only">
        {pending ? 'Updating players…' : ''}
      </p>
    </form>
  );
}
