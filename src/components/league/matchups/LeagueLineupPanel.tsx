'use client';

import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueLineupPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface LineupPlayer {
  id: string;
  playerId: string;
  slot: string;
  slotIndex: number;
  lockedAt?: string | null;
  player?: { name?: string; position?: string };
}

export function LeagueLineupPanel({ leagueId, currentUserId }: LeagueLineupPanelProps) {
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const round = 1;

  async function loadLineup() {
    setIsLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {},
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to load lineup.');
      }
      setPlayers(payload.data?.players ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load lineup.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLineup();
  }, [leagueId, currentUserId]);

  async function saveLineup() {
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            players: players.map((player) => ({
              playerId: player.playerId,
              slot: player.slot,
              slotIndex: player.slotIndex,
            })),
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.details?.join(', ') ?? payload.error ?? 'Failed to save lineup.');
      }
      setPlayers(payload.data?.players ?? []);
      setMessage('Lineup saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save lineup.');
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="league-lineup-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="league-lineup-heading"
            className="text-xl font-semibold text-[color:var(--league-text)]"
          >
            My Lineup
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Active lineup and bench for the current AFL round.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveLineup()}
          className="rounded-md bg-[color:var(--league-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)]"
        >
          Save
        </button>
      </div>

      {message && (
        <div className="rounded-md border border-[color:var(--league-border)] p-3 text-sm">
          {message}
        </div>
      )}
      {isLoading ? (
        <div className="rounded-lg border border-[color:var(--league-border)] p-4">
          Loading lineup
        </div>
      ) : players.length ? (
        <div className="grid gap-2">
          {players.map((player) => (
            <div
              key={player.id}
              className="grid gap-2 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-3 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <div className="font-medium text-[color:var(--league-text)]">
                  {player.player?.name ?? player.playerId}
                </div>
                <div className="text-sm text-[color:var(--league-text-muted)]">
                  {player.slot} {player.slotIndex + 1}
                  {player.lockedAt ? ' - locked' : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No lineup has been submitted for this round.
        </div>
      )}
    </section>
  );
}
