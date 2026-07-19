'use client';

import { Plus, Trash2 } from 'lucide-react';
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
  teams: Array<{ id: string; teamName: string; draftSlot: number | null }>;
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
      homeMemberId: string | null;
      awayMemberId: string | null;
      byeMemberId: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      byeTeam: string | null;
    }>;
  }>;
  audit: Array<{ id: string; eventType: string; actorTeamName: string | null; createdAt: string }>;
};

type FixtureDraft = {
  matchupId: string | null;
  homeMemberId: string;
  awayMemberId: string;
  byeMemberId: string;
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
  const [fixtureDrafts, setFixtureDrafts] = useState<Record<string, FixtureDraft>>({});
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

  async function loadSnapshot({ preserveMessage = false }: { preserveMessage?: boolean } = {}) {
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
      setFixtureDrafts(
        Object.fromEntries(
          nextSnapshot.rounds.flatMap((competitionRound) => [
            ...competitionRound.matchups.map((matchup) => [
              matchup.id,
              {
                matchupId: matchup.id,
                homeMemberId: matchup.homeMemberId ?? '',
                awayMemberId: matchup.awayMemberId ?? '',
                byeMemberId: matchup.byeMemberId ?? '',
              },
            ]),
            [
              `new-${competitionRound.round}`,
              { matchupId: null, homeMemberId: '', awayMemberId: '', byeMemberId: '' },
            ],
          ])
        )
      );
      if (!preserveMessage) setMessage(null);
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
      await loadSnapshot({ preserveMessage: true });
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
            action: 'SET_DEADLINE',
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
      await loadSnapshot({ preserveMessage: true });
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

  async function saveFixture(round: number, draftKey: string) {
    const draft = fixtureDrafts[draftKey];
    if (!draft) return;
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
            action: 'SAVE_FIXTURE',
            round,
            fixture: {
              matchupId: draft.matchupId,
              homeMemberId: draft.homeMemberId || null,
              awayMemberId: draft.awayMemberId || null,
              byeMemberId: draft.byeMemberId || null,
            },
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to save the fixture.');
      }
      if (controller.signal.aborted || generation !== mutationGenerationRef.current) return;
      setMessage(
        `Round ${round} fixture saved. Any affected matchup score was cleared, and standings were recalculated when required.`
      );
      await loadSnapshot({ preserveMessage: true });
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== mutationGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Failed to save the fixture.');
    } finally {
      if (generation === mutationGenerationRef.current) {
        if (mutationAbortControllerRef.current === controller) {
          mutationAbortControllerRef.current = null;
        }
        setIsSaving(false);
      }
    }
  }

  async function deleteFixture(round: number, matchupId: string) {
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
            action: 'DELETE_FIXTURE',
            round,
            matchupId,
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to delete the fixture.');
      }
      if (controller.signal.aborted || generation !== mutationGenerationRef.current) return;
      setMessage(`Round ${round} fixture deleted.`);
      await loadSnapshot({ preserveMessage: true });
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== mutationGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Failed to delete the fixture.');
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
            <option value="THURSDAY_7PM_AEST">Thursday 7:00 pm in league timezone</option>
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
            <div className="grid gap-3 border border-[color:var(--league-border)] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
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
          <div className="border-t border-[color:var(--league-border)] pt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h4 className="font-semibold text-[color:var(--league-text)]">Fixtures</h4>
                <p className="mt-1">
                  Inspect every published round. Commissioners can add, replace, and remove
                  regular-season fixtures before finalization. Finals participants advance
                  automatically from results.
                </p>
              </div>
            </div>
            <div className="mt-4 divide-y divide-[color:var(--league-border)] border-y border-[color:var(--league-border)]">
              {snapshot.rounds.map((competitionRound) => {
                if (competitionRound.status === 'NO_MATCHUP') {
                  return (
                    <div key={competitionRound.id} className="px-3 py-4">
                      <p className="font-semibold text-[color:var(--league-text)]">
                        Round {competitionRound.round}: no matchup week
                      </p>
                    </div>
                  );
                }

                const isRoundReadOnly = competitionRound.status === 'FINAL';
                const rows = [
                  ...competitionRound.matchups.map((matchup) => ({
                    key: matchup.id,
                    matchup,
                  })),
                  ...(canManage && !isRoundReadOnly && competitionRound.phase === 'REGULAR'
                    ? [
                        {
                          key: `new-${competitionRound.round}`,
                          matchup: null,
                        },
                      ]
                    : []),
                ];

                return (
                  <section key={competitionRound.id} className="px-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h5 className="font-semibold text-[color:var(--league-text)]">
                        Round {competitionRound.round}
                        {competitionRound.aflRound
                          ? ` · AFL Round ${competitionRound.aflRound}`
                          : ''}
                      </h5>
                      <span className="text-xs font-semibold uppercase">
                        {competitionRound.phase}
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {rows.map(({ key, matchup }) => {
                        const draft = fixtureDrafts[key];
                        if (!draft) return null;
                        const label = matchup?.bracketKey
                          ? matchup.bracketKey.replaceAll('_', ' ')
                          : matchup
                            ? 'Fixture'
                            : 'New fixture';

                        return (
                          <div
                            key={key}
                            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
                          >
                            <label className="flex flex-col gap-1 font-medium text-[color:var(--league-text)]">
                              {label} home
                              <select
                                value={draft.homeMemberId}
                                disabled={
                                  !canManage ||
                                  isSaving ||
                                  isRoundReadOnly ||
                                  Boolean(matchup?.bracketKey)
                                }
                                onChange={(event) =>
                                  setFixtureDrafts((current) => ({
                                    ...current,
                                    [key]: {
                                      ...draft,
                                      homeMemberId: event.target.value,
                                      byeMemberId: event.target.value ? '' : draft.byeMemberId,
                                    },
                                  }))
                                }
                                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
                              >
                                <option value="">Unassigned</option>
                                {snapshot.teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.teamName}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 font-medium text-[color:var(--league-text)]">
                              Away
                              <select
                                value={draft.awayMemberId}
                                disabled={
                                  !canManage ||
                                  isSaving ||
                                  isRoundReadOnly ||
                                  Boolean(matchup?.bracketKey)
                                }
                                onChange={(event) =>
                                  setFixtureDrafts((current) => ({
                                    ...current,
                                    [key]: {
                                      ...draft,
                                      awayMemberId: event.target.value,
                                      byeMemberId: event.target.value ? '' : draft.byeMemberId,
                                    },
                                  }))
                                }
                                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
                              >
                                <option value="">Unassigned</option>
                                {snapshot.teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.teamName}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 font-medium text-[color:var(--league-text)]">
                              Bye team
                              <select
                                value={draft.byeMemberId}
                                disabled={
                                  !canManage ||
                                  isSaving ||
                                  isRoundReadOnly ||
                                  Boolean(matchup?.bracketKey)
                                }
                                onChange={(event) =>
                                  setFixtureDrafts((current) => ({
                                    ...current,
                                    [key]: {
                                      ...draft,
                                      byeMemberId: event.target.value,
                                      homeMemberId: event.target.value ? '' : draft.homeMemberId,
                                      awayMemberId: event.target.value ? '' : draft.awayMemberId,
                                    },
                                  }))
                                }
                                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3"
                              >
                                <option value="">Not a bye</option>
                                {snapshot.teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.teamName}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {canManage && !matchup?.bracketKey ? (
                              <div className="flex h-10 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void saveFixture(competitionRound.round, key)}
                                  disabled={
                                    isSaving ||
                                    isRoundReadOnly ||
                                    (!draft.byeMemberId &&
                                      (!draft.homeMemberId || !draft.awayMemberId))
                                  }
                                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[color:var(--league-primary)] px-3 font-semibold text-[color:var(--league-primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
                                >
                                  {matchup ? null : <Plus aria-hidden="true" className="h-4 w-4" />}
                                  {matchup ? 'Save' : 'Add'}
                                </button>
                                {matchup && !matchup.bracketKey ? (
                                  <button
                                    type="button"
                                    aria-label={`Delete ${label} from round ${competitionRound.round}`}
                                    title="Delete fixture"
                                    onClick={() =>
                                      void deleteFixture(competitionRound.round, matchup.id)
                                    }
                                    disabled={isSaving || isRoundReadOnly}
                                    className="inline-flex size-10 items-center justify-center rounded-md border border-[color:var(--league-border)] text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                                  >
                                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
