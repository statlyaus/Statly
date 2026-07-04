'use client';

import type { LineupRosterPlayer } from './lineupBuilderTypes';

interface LineupRosterPoolProps {
  players: readonly LineupRosterPlayer[];
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
  setDragPlayer: (playerId: string | null) => void;
  variant?: 'default' | 'stadium';
  embedded?: boolean;
}

export function LineupRosterPool({
  players,
  selectedPlayerId,
  onSelectPlayer,
  setDragPlayer,
  variant = 'default',
  embedded = false,
}: LineupRosterPoolProps) {
  const isStadium = variant === 'stadium';
  const isEmbeddedStadium = isStadium && embedded;

  return (
    <aside
      className={`overflow-hidden rounded-md border shadow-sm ${
        isEmbeddedStadium
          ? 'border-0 bg-transparent text-[color:var(--league-text)] shadow-none'
          : isStadium
            ? 'border-white/45 bg-white/44 text-[color:var(--league-text)] backdrop-blur-md'
            : 'border-[color:var(--league-border)] bg-[color:var(--league-surface)] xl:sticky xl:top-4'
      }`}
    >
      <div
        className={`border-b px-4 py-3 ${
          isEmbeddedStadium
            ? 'border-cyan-100/15 px-0 pb-3 pt-0'
            : isStadium
              ? 'border-white/35 bg-white/24'
              : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)]'
        }`}
      >
        <div
          className={`flex items-center justify-between gap-3 ${isStadium ? 'text-center' : ''}`}
        >
          <div>
            <h3
              className={`font-semibold ${
                isStadium
                  ? 'text-[11px] uppercase text-[color:var(--league-text)]'
                  : 'text-sm text-[color:var(--league-text)]'
              }`}
            >
              Available players
            </h3>
            {!isStadium ? (
              <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
                Unassigned roster pool
              </p>
            ) : null}
          </div>
          <span
            className={`rounded-full border px-2 py-1 text-xs font-semibold tabular-nums ${
              isStadium
                ? 'border-white/45 bg-white/42 text-[color:var(--league-text)]'
                : 'border-[color:var(--league-border)] bg-[color:var(--league-bg)] text-[color:var(--league-text-muted)]'
            }`}
          >
            {players.length}
          </span>
        </div>
      </div>
      <div
        className={`${isStadium ? 'max-h-[230px] lg:max-h-[360px]' : 'max-h-[680px]'} overflow-y-auto ${isEmbeddedStadium ? 'px-0 py-3' : 'p-2'}`}
      >
        {players.length === 0 ? (
          <div
            className={`rounded-md border border-dashed px-3 py-6 text-sm ${
              isStadium
                ? 'border-white/45 text-[color:var(--league-text-muted)]'
                : 'border-[color:var(--league-border)] text-[color:var(--league-text-muted)]'
            }`}
          >
            All roster players are currently assigned.
          </div>
        ) : (
          <ul className={isEmbeddedStadium ? 'grid gap-3 lg:grid-cols-3' : 'space-y-2'}>
            {players.map((player) => {
              const isSelected = player.playerId === selectedPlayerId;

              return (
                <li key={player.playerId}>
                  <button
                    type="button"
                    draggable
                    onClick={() => onSelectPlayer(player.playerId)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', player.playerId);
                      setDragPlayer(player.playerId);
                    }}
                    onDragEnd={() => setDragPlayer(null)}
                    className={`group flex w-full items-center gap-3 border text-left transition ${
                      isSelected
                        ? isStadium
                          ? 'rounded-full border-white/80 bg-white/72 px-3 py-2 shadow-[0_10px_24px_rgba(80,65,45,0.2)] backdrop-blur'
                          : 'border-[color:var(--league-accent)] bg-[color:var(--league-accent-soft)]'
                        : isStadium
                          ? 'rounded-full border-dashed border-white/70 bg-white/34 px-3 py-2 shadow-[0_10px_24px_rgba(80,65,45,0.18)] backdrop-blur hover:-translate-y-0.5 hover:bg-white/50'
                          : 'rounded-md border-[color:var(--league-border)] bg-[color:var(--league-bg)] px-2.5 py-2 hover:-translate-y-0.5 hover:border-[color:var(--league-accent)] hover:shadow-sm'
                    }`}
                    aria-pressed={isSelected}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase ${
                        isStadium
                          ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
                          : 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
                      }`}
                    >
                      {player.position || 'AFL'}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm font-semibold ${
                          isStadium
                            ? 'text-[color:var(--league-text)]'
                            : 'text-[color:var(--league-text)]'
                        }`}
                      >
                        {player.name}
                      </span>
                      <span
                        className={`mt-0.5 flex flex-wrap items-center gap-1 text-[11px] ${
                          isStadium
                            ? 'text-[color:var(--league-text-muted)]'
                            : 'text-[color:var(--league-text-muted)]'
                        }`}
                      >
                        {player.club ? <span>{player.club}</span> : null}
                      </span>
                    </span>
                    {isStadium ? null : (
                      <span className="ml-auto shrink-0 rounded-full border border-[color:var(--league-border)] px-2 py-1 text-[11px] font-semibold text-[color:var(--league-text-muted)] transition group-hover:border-[color:var(--league-accent)]">
                        {isSelected ? 'Selected' : 'Place'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
