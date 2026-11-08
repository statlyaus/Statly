'use client';

import { useMemo, useOptimistic, useState } from 'react';

import { buttonStyles, fieldLabelStyles, fieldStyles } from '@/components/ui/controlStyles';

import { formatSigned } from '../analysis/format';
import type { SearchParams } from '../analysis/searchParams';
import { useParamNavigation } from '../analysis/useParamNavigation';

export interface TradePlayerOption {
  playerId: string;
  fullName: string;
  teamCode: string | null;
  value: number;
  /** Who holds him: a team name, "Rostered elsewhere" or "Free agent". */
  holder: string;
}

const SEARCH_RESULTS = 8;

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Give from my roster, get from anyone else. Choices live in the URL; the server scores them. */
export function TradeBuilder({
  path,
  params,
  myPlayers,
  otherPlayers,
  give,
  get,
  max,
}: {
  path: string;
  params: SearchParams;
  myPlayers: TradePlayerOption[];
  otherPlayers: TradePlayerOption[];
  give: string[];
  get: string[];
  max: number;
}) {
  const { update, pending } = useParamNavigation(path, params);
  const [search, setSearch] = useState('');
  const [picks, setPicks] = useOptimistic({ give, get });
  const setSide = (key: 'give' | 'get', ids: string[]) =>
    update({ [key]: ids.join(',') || null }, () => setPicks({ ...picks, [key]: ids }));
  const byId = useMemo(
    () => new Map(otherPlayers.map((player) => [player.playerId, player])),
    [otherPlayers]
  );
  const results = useMemo(() => {
    const needle = normalise(search.trim());
    if (needle.length < 2) return [];
    return otherPlayers
      .filter(
        (player) =>
          !picks.get.includes(player.playerId) &&
          (normalise(player.fullName).includes(needle) ||
            normalise(player.teamCode ?? '').includes(needle) ||
            normalise(player.holder).includes(needle))
      )
      .slice(0, SEARCH_RESULTS);
  }, [otherPlayers, search, picks.get]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2" aria-busy={pending}>
      <fieldset className="rounded-lg border border-border bg-card p-4">
        <legend className="px-1 font-display text-lg font-bold text-foreground">You give</legend>
        {myPlayers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add your players on the Roster page first.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {myPlayers.map((player) => {
              const checked = picks.give.includes(player.playerId);
              return (
                <li key={player.playerId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && picks.give.length >= max}
                      onChange={() =>
                        setSide(
                          'give',
                          checked
                            ? picks.give.filter((id) => id !== player.playerId)
                            : [...picks.give, player.playerId]
                        )
                      }
                      className="size-4 accent-brand-bar"
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                      {player.fullName}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {player.teamCode ?? ''}
                      </span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatSigned(player.value)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
        <legend className="px-1 font-display text-lg font-bold text-foreground">You get</legend>
        {picks.get.length > 0 ? (
          <ul className="divide-y divide-border" aria-label="Players you get">
            {picks.get.map((id) => {
              const player = byId.get(id);
              if (!player) return null;
              return (
                <li key={id} className="flex min-h-11 items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                    {player.fullName}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {player.holder}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatSigned(player.value)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSide(
                        'get',
                        picks.get.filter((other) => other !== id)
                      )
                    }
                    aria-label={`Remove ${player.fullName}`}
                    className={buttonStyles({ variant: 'ghost', size: 'xs' })}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {picks.get.length < max ? (
          <>
            <label className={fieldLabelStyles}>
              Find a player
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, NBA team or fantasy team"
                className={fieldStyles({ size: 'sm' })}
                maxLength={60}
              />
            </label>
            {search.trim().length >= 2 ? (
              results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No players match.</p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Search results">
                  {results.map((player) => (
                    <li key={player.playerId} className="flex min-h-11 items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {player.fullName}
                        <span className="ml-1.5 text-muted-foreground">
                          {player.teamCode ?? ''} · {player.holder}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatSigned(player.value)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSide('get', [...picks.get, player.playerId]);
                          setSearch('');
                        }}
                        aria-label={`Add ${player.fullName}`}
                        className={buttonStyles({ variant: 'outline', size: 'xs' })}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Type at least two letters. Anyone not on your roster can be picked.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Up to {max} players a side.</p>
        )}
      </fieldset>
    </div>
  );
}
