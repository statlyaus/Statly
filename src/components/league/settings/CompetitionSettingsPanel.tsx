'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type { LeagueFixtureGenerationMode } from '@/types/leagues';

type CompetitionRules = {
  seasonStartAflRound: number;
  regularSeasonRounds: number;
  finalsTeams: 0 | 4 | 6 | 8;
  fixtureGenerationMode: 'AUTOMATIC' | 'MANUAL';
  lockPolicy: 'INDIVIDUAL_GAME_START' | 'THURSDAY_7PM_AEST';
  leagueTimeZone: string;
  interchangeSlots: number;
  standingsTieBreakCategory: FantasyCategoryKey;
  excludedAflRounds: number[];
};

type CompetitionSnapshot = {
  canManage: boolean;
  teamCount: number;
  rosterSize: number;
  categories: FantasyCategoryKey[];
  status: string;
  fixtureVersion: number;
  publishedAt: string | null;
  rules: CompetitionRules;
  rounds: Array<{
    id: string;
    round: number;
    aflRound: number | null;
    phase: 'REGULAR' | 'FINALS';
    status: string;
    startsAt: string | null;
    fallbackLockAt: string | null;
    matchups: Array<{
      id: string;
      bracketKey: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      byeTeam: string | null;
    }>;
  }>;
  audit: Array<{ id: string; eventType: string; actorTeamName: string | null; createdAt: string }>;
};

interface CompetitionSettingsPanelProps {
  leagueId: string;
  currentUserId?: string;
  fixtureGenerationMode: LeagueFixtureGenerationMode;
  onFixtureGenerationModeChange: (mode: LeagueFixtureGenerationMode) => void;
}

function parseExcludedRounds(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => Number.parseInt(entry.trim(), 10))
        .filter((round) => Number.isInteger(round) && round > 0)
    ),
  ].sort((left, right) => left - right);
}

function formatDate(value: string | null) {
  if (!value) return 'Pending official AFL fixture data';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Pending official AFL fixture data' : date.toLocaleString();
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function CompetitionSettingsPanel({
  leagueId,
  currentUserId,
  fixtureGenerationMode,
  onFixtureGenerationModeChange,
}: CompetitionSettingsPanelProps) {
  const [snapshot, setSnapshot] = useState<CompetitionSnapshot | null>(null);
  const [rules, setRules] = useState<CompetitionRules | null>(null);
  const [excludedRounds, setExcludedRounds] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fallbackRound, setFallbackRound] = useState('');
  const [fallbackLockAt, setFallbackLockAt] = useState('');
  const loadGenerationRef = useRef(0);
  const loadAbortControllerRef = useRef<AbortController | null>(null);
  const mutationGenerationRef = useRef(0);
  const mutationAbortControllerRef = useRef<AbortController | null>(null);

  const isPublished = snapshot?.status !== 'SETUP';
  const canManage = Boolean(snapshot?.canManage);
  const editable = canManage && !isPublished && !isSaving;
  const effectiveRules = useMemo(
    () => (rules ? { ...rules, fixtureGenerationMode } : null),
    [fixtureGenerationMode, rules]
  );
  const preflightSummary = useMemo(() => {
    if (!snapshot || !effectiveRules) return null;
    return `${snapshot.teamCount} teams, ${effectiveRules.regularSeasonRounds} regular rounds, ${effectiveRules.finalsTeams || 'no'} finals teams, ${effectiveRules.interchangeSlots} interchange slots`;
  }, [effectiveRules, snapshot]);

  async function loadSnapshot() {
    const controller = new AbortController();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = controller;
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/competition`,
        { signal: controller.signal },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(payload.error ?? 'Failed to load competition.');
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;

      const nextSnapshot = payload.data as CompetitionSnapshot;
      setSnapshot(nextSnapshot);
      setRules(nextSnapshot.rules);
      onFixtureGenerationModeChange(nextSnapshot.rules.fixtureGenerationMode);
      setExcludedRounds(nextSnapshot.rules.excludedAflRounds.join(', '));
      setMessage(null);
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== loadGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Failed to load competition.');
    } finally {
      if (generation === loadGenerationRef.current) {
        if (loadAbortControllerRef.current === controller) loadAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    mutationAbortControllerRef.current?.abort();
    mutationAbortControllerRef.current = null;
    mutationGenerationRef.current += 1;
    setIsSaving(false);
    void loadSnapshot();
    return () => {
      loadAbortControllerRef.current?.abort();
      loadGenerationRef.current += 1;
      mutationAbortControllerRef.current?.abort();
      mutationGenerationRef.current += 1;
    };
  }, [currentUserId, leagueId]);

  async function saveRules() {
    if (!effectiveRules) return;
    const controller = new AbortController();
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    mutationAbortControllerRef.current?.abort();
    mutationAbortControllerRef.current = controller;
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/competition`,
        {
          method: 'PUT',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rules: {
              ...effectiveRules,
              excludedAflRounds: parseExcludedRounds(excludedRounds),
            },
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(payload.error ?? 'Failed to save competition rules.');
      if (controller.signal.aborted || generation !== mutationGenerationRef.current) return;
      const nextRules = payload.data.rules as CompetitionRules;
      setRules(nextRules);
      onFixtureGenerationModeChange(nextRules.fixtureGenerationMode);
      setMessage('Competition rules saved. Publish when the preflight is complete.');
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== mutationGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Failed to save competition rules.');
    } finally {
      if (generation === mutationGenerationRef.current) {
        if (mutationAbortControllerRef.current === controller) {
          mutationAbortControllerRef.current = null;
        }
        setIsSaving(false);
      }
    }
  }

  async function publish() {
    if (!effectiveRules) return;
    const controller = new AbortController();
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    mutationAbortControllerRef.current?.abort();
    mutationAbortControllerRef.current = controller;
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/competition`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rules: {
              ...effectiveRules,
              excludedAflRounds: parseExcludedRounds(excludedRounds),
            },
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(
          payload.details?.join(' ') ?? payload.error ?? 'Competition cannot be published.'
        );
      }
      if (controller.signal.aborted || generation !== mutationGenerationRef.current) return;
      setMessage(`Competition published as fixture version ${payload.data.fixtureVersion}.`);
      await loadSnapshot();
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== mutationGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Competition cannot be published.');
    } finally {
      if (generation === mutationGenerationRef.current) {
        if (mutationAbortControllerRef.current === controller) {
          mutationAbortControllerRef.current = null;
        }
        setIsSaving(false);
      }
    }
  }

  async function saveFallbackDeadline() {
    if (!fallbackRound || !fallbackLockAt) return;
    const controller = new AbortController();
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    mutationAbortControllerRef.current?.abort();
    mutationAbortControllerRef.current = controller;
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/competition`,
        {
          method: 'PATCH',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            round: Number(fallbackRound),
            fallbackLockAt: new Date(fallbackLockAt).toISOString(),
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to set the fallback deadline.');
      }
      if (controller.signal.aborted || generation !== mutationGenerationRef.current) return;
      setMessage('Round-wide fallback deadline saved.');
      setFallbackLockAt('');
      await loadSnapshot();
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== mutationGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Failed to set the fallback deadline.');
    } finally {
      if (generation === mutationGenerationRef.current) {
        if (mutationAbortControllerRef.current === controller) {
          mutationAbortControllerRef.current = null;
        }
        setIsSaving(false);
      }
    }
  }

  if (isLoading) {
    return (
      <div className="text-sm text-[color:var(--league-text-muted)]">
        Loading competition settings.
      </div>
    );
  }

  if (!snapshot || !rules) {
    return (
      <div role="status" aria-live="polite" className="text-sm text-destructive">
        {message ?? 'Competition settings are unavailable.'}
      </div>
    );
  }

  return (
    <section
      id="competition-rules"
      className="scroll-mt-6 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Competition Rules
          </h3>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">{preflightSummary}</p>
        </div>
        <span
          aria-label={`Competition status: ${snapshot.status}`}
          className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold text-[color:var(--league-text-muted)]"
        >
          {snapshot.status === 'PENDING' ? 'Published but pending' : snapshot.status}
        </span>
      </div>

      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-[color:var(--league-text)]"
        >
          {message}
        </p>
      ) : null}

      <fieldset
        disabled={!editable}
        className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3 disabled:opacity-70"
      >
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Start AFL round
          <input
            type="number"
            min="1"
            value={rules.seasonStartAflRound}
            onChange={(event) =>
              setRules({ ...rules, seasonStartAflRound: Number(event.target.value) || 1 })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Regular-season rounds
          <input
            type="number"
            min="1"
            value={rules.regularSeasonRounds}
            onChange={(event) =>
              setRules({ ...rules, regularSeasonRounds: Number(event.target.value) || 1 })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          Fixture generation
          <select
            value={fixtureGenerationMode}
            onChange={(event) =>
              onFixtureGenerationModeChange(event.target.value as LeagueFixtureGenerationMode)
            }
            className="h-10 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="AUTOMATIC">Automatic by league teams</option>
            <option value="MANUAL">Manual commissioner setup</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Finals teams
          <select
            value={rules.finalsTeams}
            onChange={(event) =>
              setRules({
                ...rules,
                finalsTeams: Number(event.target.value) as CompetitionRules['finalsTeams'],
              })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          >
            <option value={0}>No finals</option>
            <option value={4}>Top 4</option>
            <option value={6}>Top 6</option>
            <option value={8}>Top 8</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Lineup lock
          <select
            value={rules.lockPolicy}
            onChange={(event) =>
              setRules({
                ...rules,
                lockPolicy: event.target.value as CompetitionRules['lockPolicy'],
              })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          >
            <option value="INDIVIDUAL_GAME_START">Each player at AFL game start</option>
            <option value="THURSDAY_7PM_AEST">Thursday 7:00 pm AEST</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          League timezone
          <input
            value={rules.leagueTimeZone}
            onChange={(event) => setRules({ ...rules, leagueTimeZone: event.target.value })}
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Interchange slots
          <input
            type="number"
            min="0"
            value={rules.interchangeSlots}
            onChange={(event) =>
              setRules({ ...rules, interchangeSlots: Math.max(0, Number(event.target.value) || 0) })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Standings tie-break category
          <select
            value={rules.standingsTieBreakCategory}
            onChange={(event) =>
              setRules({
                ...rules,
                standingsTieBreakCategory: event.target.value as FantasyCategoryKey,
              })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          >
            {snapshot.categories.map((category) => (
              <option key={category} value={category}>
                {FANTASY_CATEGORIES[category]?.label ?? category}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)] md:col-span-2">
          Excluded AFL rounds
          <input
            value={excludedRounds}
            onChange={(event) => setExcludedRounds(event.target.value)}
            placeholder="For example: 3, 13"
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
          />
        </label>
      </fieldset>

      <div className="mt-5 flex flex-wrap gap-3">
        {canManage && !isPublished ? (
          <button
            type="button"
            onClick={() => void saveRules()}
            disabled={isSaving}
            className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--league-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
          >
            Save rules
          </button>
        ) : null}
        {canManage && !isPublished ? (
          <button
            type="button"
            onClick={() => void publish()}
            disabled={isSaving}
            className="rounded-md bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 disabled:opacity-60"
          >
            Publish competition
          </button>
        ) : null}
      </div>

      {isPublished ? (
        <div className="mt-6 space-y-4 border-t border-[color:var(--league-border)] pt-4 text-sm text-[color:var(--league-text-muted)]">
          <p>
            Fixture version {snapshot.fixtureVersion} was published{' '}
            {formatDate(snapshot.publishedAt)}. Rules are read-only after publication.
          </p>
          {canManage ? (
            <div className="grid gap-3 rounded-md border border-[color:var(--league-border)] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Round-wide fallback deadline
                <select
                  value={fallbackRound}
                  onChange={(event) => setFallbackRound(event.target.value)}
                  className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
                >
                  <option value="">Choose round</option>
                  {snapshot.rounds
                    .filter((competitionRound) => competitionRound.status !== 'NO_MATCHUP')
                    .map((competitionRound) => (
                      <option key={competitionRound.id} value={competitionRound.round}>
                        Round {competitionRound.round}
                        {competitionRound.fallbackLockAt ? ' (override set)' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Deadline
                <input
                  type="datetime-local"
                  value={fallbackLockAt}
                  onChange={(event) => setFallbackLockAt(event.target.value)}
                  className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
                />
              </label>
              <button
                type="button"
                onClick={() => void saveFallbackDeadline()}
                disabled={isSaving || !fallbackRound || !fallbackLockAt}
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
              >
                Set deadline
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
