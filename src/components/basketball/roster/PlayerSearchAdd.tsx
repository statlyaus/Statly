'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { fieldStyles } from '@/components/ui/controlStyles';
import type { NbaPlayerSearchResult } from '@/server/basketball/leagues/basketballLeagueDto';

import { callBasketballApi } from '../shell/basketballApi';

const SEARCH_DELAY_MS = 200;

/**
 * Search NBA players by name and add the chosen one to the target team: a combobox over
 * `/api/basketball/players/search`. Arrow keys move through results, Enter adds, Escape closes.
 * Each result says where the player already sits in this league, because adding him moves him.
 */
export function PlayerSearchAdd({
  targetLabel,
  rosteredOn,
  disabled,
  onAdd,
}: {
  targetLabel: string;
  /** Where a player already sits in this league: a team name, or null when not rostered. */
  rosteredOn: (playerId: string) => string | null;
  disabled: boolean;
  onAdd: (player: NbaPlayerSearchResult) => Promise<boolean>;
}) {
  const id = useId();
  const listId = `${id}-results`;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NbaPlayerSearchResult[]>([]);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const latest = useRef(0);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await callBasketballApi<NbaPlayerSearchResult[]>(
        `/api/basketball/players/search?q=${encodeURIComponent(trimmed)}&limit=10`,
        'GET'
      );
      if (request !== latest.current) return;
      setLoading(false);
      setSearched(trimmed);
      if (result.ok) {
        setResults(result.data);
        setError(null);
      } else {
        setResults([]);
        setError(result.message);
      }
      setActive(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const shown = trimmed.length >= 2 && searched === trimmed ? results : [];
  const expanded = open && shown.length > 0;

  async function choose(player: NbaPlayerSearchResult) {
    if (disabled) return;
    const added = await onAdd(player);
    if (added) {
      setQuery('');
      setResults([]);
      setSearched('');
      setOpen(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (shown.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        event.key === 'ArrowDown'
          ? (current + 1) % shown.length
          : (current - 1 + shown.length) % shown.length
      );
    } else if (event.key === 'Enter') {
      if (!expanded) return;
      event.preventDefault();
      void choose(shown[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const status =
    trimmed.length === 0
      ? ''
      : trimmed.length < 2
        ? 'Type at least 2 letters.'
        : loading || searched !== trimmed
          ? 'Searching…'
          : error
            ? error
            : shown.length === 0
              ? `No active NBA players match “${trimmed}”.`
              : `${shown.length} ${shown.length === 1 ? 'player' : 'players'} found. Use the arrow keys, then Enter to add.`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        Search NBA players
      </label>
      <input
        id={id}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-describedby={`${id}-status`}
        placeholder="Player name"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={fieldStyles()}
      />
      <div className="relative">
        <ul
          id={listId}
          role="listbox"
          aria-label={`Players to add to ${targetLabel}`}
          hidden={!expanded}
          className="absolute left-0 right-0 top-1 z-20 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {shown.map((player, index) => {
            const on = rosteredOn(player.id);
            return (
              // The input owns the keyboard (arrows, Enter, Escape) as the combobox pattern requires.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={player.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep focus in the input so the list stays open while the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(player)}
                onMouseEnter={() => setActive(index)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm ${
                  index === active ? 'bg-accent text-accent-foreground' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="font-semibold">{player.fullName}</span>{' '}
                  <span className="text-muted-foreground">
                    {[player.teamCode, player.positions.join(', ')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {on ? `On ${on}` : `Add to ${targetLabel}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p id={`${id}-status`} aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
