'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { buttonStyles, fieldLabelStyles, fieldStyles } from '@/components/ui/controlStyles';
import { getBasketballCategory, type BasketballCategoryId } from '@/types/basketball';

import { sendBasketballCommand } from '../analysis/basketballApi';
import type { SearchParams } from '../analysis/searchParams';
import { useParamNavigation } from '../analysis/useParamNavigation';
import { MINUTE_FLOORS, PLAYER_POSITIONS, type PlayersQuery } from './playersView';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

export function PlayersControls({
  path,
  params,
  leagueId,
  userId,
  categories,
  leaguePunts,
  punts,
  query,
}: {
  path: string;
  params: SearchParams;
  leagueId: string;
  userId: string;
  categories: BasketballCategoryId[];
  leaguePunts: BasketballCategoryId[];
  /** The punts the table uses now (what-if or league). */
  punts: BasketballCategoryId[];
  query: Pick<PlayersQuery, 'freeAgentsOnly' | 'position' | 'minMinutes' | 'search'>;
}) {
  const router = useRouter();
  const { update, pending } = useParamNavigation(path, params);
  const [search, setSearch] = useState(query.search);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => update({ q: search.trim() || null, limit: null }), 300);
    return () => clearTimeout(timer);
    // Only the typed text should trigger a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const whatIf = !sameSet(punts, leaguePunts);
  const togglePunt = (categoryId: BasketballCategoryId) => {
    const next = punts.includes(categoryId)
      ? punts.filter((punt) => punt !== categoryId)
      : [...punts, categoryId];
    setMessage(null);
    update({
      punts: sameSet(next, leaguePunts) ? null : next.join(',') || 'none',
      limit: null,
    });
  };

  const savePunts = async () => {
    setSaving(true);
    setMessage(null);
    const result = await sendBasketballCommand(
      `/api/basketball/leagues/${encodeURIComponent(leagueId)}`,
      'PATCH',
      { puntCategories: punts },
      userId
    );
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: 'error', text: `Punts not saved. ${result.message}` });
      return;
    }
    setMessage({ tone: 'ok', text: 'Saved as the league’s punts.' });
    update({ punts: null });
    router.refresh();
  };

  return (
    <form
      aria-label="Player filters"
      aria-busy={pending}
      onSubmit={(event) => event.preventDefault()}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className={fieldLabelStyles}>
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Player or team, e.g. Jokic or DEN"
            className={fieldStyles({ size: 'sm' })}
            maxLength={60}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabelStyles}>
            Position
            <select
              value={query.position ?? ''}
              onChange={(event) => update({ pos: event.target.value || null, limit: null })}
              className={fieldStyles({ size: 'sm' })}
            >
              <option value="">Any</option>
              {PLAYER_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabelStyles}>
            Minutes
            <select
              value={query.minMinutes}
              onChange={(event) =>
                update({ mpg: event.target.value === '0' ? null : event.target.value, limit: null })
              }
              className={fieldStyles({ size: 'sm' })}
            >
              {MINUTE_FLOORS.map((floor) => (
                <option key={floor} value={floor}>
                  {floor === 0 ? 'Any' : `${floor}+ MPG`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={query.freeAgentsOnly}
            onChange={(event) => update({ fa: event.target.checked ? '1' : null, limit: null })}
            className="size-4 accent-brand-bar"
          />
          Free agents only
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">
          Punts{' '}
          <span className="font-normal text-muted-foreground">
            {whatIf ? '(trying a what-if; not saved)' : '(your league’s saved punts)'}
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((categoryId) => {
            const punted = punts.includes(categoryId);
            const lastCounted = !punted && punts.length >= categories.length - 1;
            return (
              <button
                key={categoryId}
                type="button"
                aria-pressed={punted}
                disabled={lastCounted}
                onClick={() => togglePunt(categoryId)}
                title={lastCounted ? 'Keep at least one category' : undefined}
                className={`${buttonStyles({ variant: punted ? 'primary' : 'outline', size: 'sm' })} min-w-14`}
              >
                <span className={punted ? 'line-through' : ''}>
                  {getBasketballCategory(categoryId).shortLabel}
                </span>
                <span className="sr-only">{punted ? ', punted' : ', counted'}</span>
              </button>
            );
          })}
        </div>
        {whatIf ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={savePunts}
              disabled={saving}
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
            >
              {saving ? 'Saving…' : 'Save as league punts'}
            </button>
            <button
              type="button"
              onClick={() => update({ punts: null, limit: null })}
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            >
              Back to saved punts
            </button>
          </div>
        ) : null}
        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`text-sm ${message.tone === 'error' ? 'text-result-loss' : 'text-foreground'}`}
          >
            {message.text}
          </p>
        ) : null}
      </fieldset>
      <p aria-live="polite" className="sr-only">
        {pending ? 'Updating the table' : ''}
      </p>
    </form>
  );
}
