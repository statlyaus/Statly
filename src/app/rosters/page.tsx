'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/navigation';
import { useAuth } from '@/AuthContext';
import { useTeamContext } from '@/contexts/TeamContext';
import type { Player } from '@/types/players';

type RosterPlayer = Pick<
  Player,
  'id' | 'name' | 'team' | 'position' | 'injury'
> & {
  // milliseconds since epoch
  waiverExpiresAt?: number;
};

function WaiverTimer({ expiryMs, now }: { expiryMs: number; now: number }) {
  const diff = Math.max(0, expiryMs - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const text =
    diff === 0
      ? 'Available'
      : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  return (
    <span role="timer" aria-live="polite" className="text-xs text-gray-500">
      {text}
    </span>
  );
}

function PlayerCard({
  player,
  children,
}: {
  player: RosterPlayer;
  children?: ReactNode;
}) {
  return (
    <div className="p-4 border rounded shadow-sm bg-white">
      <h2 className="font-semibold text-lg">
        {player.name}
        {player.injury && (
          <span className="ml-2 text-sm text-red-600">{player.injury}</span>
        )}
      </h2>
      <p className="text-sm text-gray-600">
        {player.team} - {player.position}
      </p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export default function RostersPage() {
  const { user } = useAuth();
  const { activeLeague } = useTeamContext();
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([]);
  const [freeAgents, setFreeAgents] = useState<RosterPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Shared clock for all countdowns
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const toMs = (v: any): number | undefined => {
      if (!v) return undefined;
      if (typeof v?.toDate === 'function') return v.toDate().getTime();
      if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
      if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? undefined : ms;
      }
      return undefined;
    };
    const load = async () => {
      if (!user || !activeLeague) return;
      setError(null);
      try {
        const res = await fetch(
          `/api/leagues/${activeLeague}/roster/${user.uid}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const json = await res.json();
          const owned: RosterPlayer[] = (json.data?.roster?.players || []).map(
            (p: any) => ({
              ...p,
              waiverExpiresAt: toMs(p.waiverExpiresAt || p.waiverExpiry),
            })
          );
          if (!controller.signal.aborted) {
            setRosterPlayers(owned);
          }

          const resFa = await fetch(
            `/api/leagues/${activeLeague}/players?owned=false`,
            { signal: controller.signal }
          );
          if (resFa.ok) {
            const jsonFa = await resFa.json();
            const fa: RosterPlayer[] = (jsonFa.items || []).map((d: any) => ({
              id: d.id,
              name: d.name,
              team: d.team,
              position: d.position,
              injury: d.injury ?? d.status,
              waiverExpiresAt: toMs(d.waiverExpiresAt || d.waiverExpiry),
            }));
            if (!controller.signal.aborted) {
              setFreeAgents(fa);
            }
          }
        } else if (!controller.signal.aborted) {
          setError('Failed to load roster data.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          console.error('Failed to load roster', err);
          setError('Failed to load roster data. Please try refreshing the page.');
        }
      }
    };
    load();
    return () => controller.abort();
  }, [user, activeLeague]);

  const handleClaim = (player: RosterPlayer, isWaiver: boolean) => {
    console.log(isWaiver ? 'Submit waiver claim' : 'Add free agent', player.id);
  };

  return (
    <AppLayout>
      <main className="p-6 space-y-8">
        {error && (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        )}
        <section>
          <h1 className="text-2xl font-bold mb-4">My Roster</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rosterPlayers.map((p) => (
              <PlayerCard key={p.id} player={p}>
                <Link
                  href={`/tradecentre?playerOut=${p.id}`}
                  className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                  aria-label={`Propose trade with ${p.name}`}
                >
                  Propose Trade
                </Link>
              </PlayerCard>
            ))}
            {rosterPlayers.length === 0 && (
              <p className="col-span-full text-center text-gray-500">
                No players on roster.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">Available Players</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {freeAgents.map((p) => {
              const expiryMs = p.waiverExpiresAt;
              const underWaiver = expiryMs ? expiryMs > now : false;
              return (
                <PlayerCard key={p.id} player={p}>
                  {underWaiver && expiryMs ? (
                    <WaiverTimer expiryMs={expiryMs} now={now} />
                  ) : (
                    <span className="text-xs text-green-600">FA</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleClaim(p, underWaiver)}
                    className="px-2 py-1 rounded bg-emerald-600 text-white text-sm"
                    aria-label={`${underWaiver ? 'Submit waiver claim for' : 'Add free agent'} ${p.name}`}
                  >
                    {underWaiver ? 'Claim' : 'Add FA'}
                  </button>
                  <Link
                    href={`/tradecentre?playerIn=${p.id}`}
                    className="px-2 py-1 rounded bg-blue-600 text-white text-sm"
                    aria-label={`Open Trade Centre for ${p.name}`}
                  >
                    Trade
                  </Link>
                </PlayerCard>
              );
            })}
            {freeAgents.length === 0 && (
              <p className="col-span-full text-center text-gray-500">
                No available players.
              </p>
            )}
          </div>
        </section>
      </main>
    </AppLayout>
  );
}

