'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/types/players';
import OfferDock from '@/components/OfferDock';
import { Column as TeamColumn } from '@/components/SideBySideTeams';

export type TradeCentreShellProps = {
  initialPlayers: Player[];
  /** The signed-in user's team. If omitted, falls back to the first team we find. */
  myTeam?: string;
};

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function TradeCentreShell({
  initialPlayers,
  myTeam,
}: TradeCentreShellProps) {
  // Build team list once
  const teams = useMemo(
    () => unique(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  // Lock the left team to the user; if missing, take the first team in the dataset
  const lockedLeftTeam = (myTeam ?? teams[0] ?? '').trim();

  // Pick an initial right team that's not the left team
  const initialRight =
    teams.find((t) => t && t !== lockedLeftTeam) ?? teams[0] ?? '';

  const [rightTeam, setRightTeam] = useState<string>(initialRight);

  // Keep rightTeam valid if myTeam or teams change
  useEffect(() => {
    if (!rightTeam || rightTeam === lockedLeftTeam || !teams.includes(rightTeam)) {
      const next = teams.find((t) => t && t !== lockedLeftTeam) ?? '';
      setRightTeam(next);
    }
  }, [teams, lockedLeftTeam, rightTeam]);

  const leftPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === lockedLeftTeam),
    [initialPlayers, lockedLeftTeam]
  );

  const rightPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === rightTeam),
    [initialPlayers, rightTeam]
  );

  // Offer drawer
  const [offerOpen, setOfferOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">
      {/* Banner */}
      <section className="rounded-2xl bg-gradient-to-r from-[hsl(260,60%,18%)]/50 via-[hsl(280,65%,18%)]/40 to-[hsl(320,70%,20%)]/35 p-6 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Trade Centre</h1>
            <p className="mt-1 text-sm text-gray-300">
              Compare rosters, build an offer, and send the trade. Click stat chips to sort.
            </p>
          </div>
          <div className="hidden sm:flex gap-2">
            <button
              type="button"
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/15"
              aria-pressed={true}
            >
              Compare &amp; Trade
            </button>
            <button
              type="button"
              className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-300 ring-1 ring-white/10 hover:bg-white/10"
            >
              Market (browse all)
            </button>
          </div>
        </div>

        {/* Team row: left is locked, right selectable */}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <label
              htmlFor="your-team"
              className="block text-xs font-medium uppercase tracking-wide text-gray-300"
            >
              Your team
            </label>
            <input
              id="your-team"
              readOnly
              value={lockedLeftTeam || '—'}
              className="mt-1 w-full rounded-md bg-slate-900/80 px-3 py-2 text-white ring-1 ring-white/10 focus:outline-none"
              aria-readonly="true"
            />
          </div>

          <div>
            <label
              htmlFor="target-team"
              className="block text-xs font-medium uppercase tracking-wide text-gray-300"
            >
              Target team
            </label>
            <select
              id="target-team"
              className="mt-1 w-full rounded-md bg-slate-900/80 px-3 py-2 text-white ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={rightTeam}
              onChange={(e) => setRightTeam(e.target.value)}
              aria-label="Select target team"
            >
              {teams
                .filter((t) => t && t !== lockedLeftTeam)
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </section>

      {/* TWO BIG ROSTER COLUMNS — no space stolen by Offer */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TeamColumn title={lockedLeftTeam || 'Your Team'} side="outgoing" players={leftPlayers} />
        <TeamColumn title={rightTeam || 'Target Team'} side="incoming" players={rightPlayers} />
      </div>

      {/* FLOATING OFFER BUTTON */}
      <button
        type="button"
        onClick={() => setOfferOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
        aria-haspopup="dialog"
        aria-expanded={offerOpen}
      >
        Open Offer
      </button>

      {/* OFFER DRAWER */}
      {offerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end"
        >
          {/* Scrim */}
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOfferOpen(false)}
            aria-label="Close offer"
          />
          {/* Drawer */}
          <div className="relative z-10 h-[80vh] w-full max-w-[420px] rounded-t-2xl sm:rounded-none sm:h-full sm:rounded-l-2xl bg-slate-900 ring-1 ring-white/10 p-4 overflow-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Offer</h2>
              <button
                type="button"
                onClick={() => setOfferOpen(false)}
                className="rounded-md bg-white/5 px-2 py-1 text-sm text-gray-300 ring-1 ring-white/10 hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <div className="mt-3">
              <OfferDock />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}