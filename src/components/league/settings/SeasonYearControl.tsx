'use client';

import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { defaultLeagueSeasonYear, SEASON_CHANGE_LOCKED_MESSAGE } from '@/server/leagues/seasonYear';

const SELECT_CLASS =
  'h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]';

/** The AFL season the league plays; the commissioner can change it only while in setup. */
export function SeasonYearControl({
  leagueId,
  currentUserId,
}: {
  leagueId: string;
  currentUserId?: string;
}) {
  const [year, setYear] = useState<number | null>(null);
  const [inSetup, setInSetup] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${leagueId}/season-state`,
          { signal: controller.signal },
          currentUserId
        );
        const payload = await response.json();
        if (controller.signal.aborted || !response.ok || !payload.success) return;
        setYear(typeof payload.data.season?.year === 'number' ? payload.data.season.year : null);
        setInSetup(payload.data.competitionStatus === 'SETUP');
      } catch {
        // The control stays empty; the rest of the settings page still works.
      }
    })();
    return () => controller.abort();
  }, [leagueId, currentUserId]);

  const defaultYear = defaultLeagueSeasonYear(new Date());
  const options = [...new Set([year, defaultYear - 1, defaultYear, defaultYear + 1])]
    .filter((option): option is number => typeof option === 'number')
    .sort((left, right) => left - right);

  const changeYear = async (nextYear: number) => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/season-state`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: nextYear }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setMessage(payload.error ?? 'Failed to change the season.');
        return;
      }
      setYear(payload.data.year);
      setMessage(`Season changed to ${payload.data.year}.`);
    } catch {
      setMessage('Failed to change the season.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
      <label htmlFor={`season-year-${leagueId}`}>Season</label>
      <select
        id={`season-year-${leagueId}`}
        value={year ?? ''}
        disabled={!inSetup || isSaving || year === null}
        onChange={(event) => void changeYear(Number.parseInt(event.target.value, 10))}
        className={SELECT_CLASS}
      >
        {year === null && <option value="">Loading</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {year !== null && !inSetup && (
        <span className="text-xs font-normal text-[color:var(--league-text-muted)]">
          {SEASON_CHANGE_LOCKED_MESSAGE}
        </span>
      )}
      {message && (
        <span role="status" className="text-xs font-normal text-[color:var(--league-text-muted)]">
          {message}
        </span>
      )}
    </div>
  );
}
