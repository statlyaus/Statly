'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { AppLayout } from '@/components/navigation';
import { db } from '@/lib/firebaseClient';
import { useAuth } from '@/AuthContext';
import { useTeamContext } from '@/contexts/TeamContext';
import type { Player } from '@/types/players';

type RosterPlayer = Pick<
  Player,
  'id' | 'name' | 'team' | 'position' | 'injury'
> & {
  waiverExpiresAt?: string;
};

function WaiverTimer({ expiry }: { expiry: Date }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = expiry.getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('Available');
      } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setRemaining(
          `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        );
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiry]);

  return <span className="text-xs text-gray-500">{remaining}</span>;
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

  useEffect(() => {
    const load = async () => {
      if (!user || !activeLeague) return;
      try {
        const res = await fetch(
          `/api/leagues/${activeLeague}/roster/${user.uid}`
        );
        if (res.ok) {
          const json = await res.json();
          const owned: RosterPlayer[] = json.roster?.players || [];
          setRosterPlayers(owned);

          if (db) {
            const snap = await getDocs(collection(db, 'players'));
            const ownedIds = new Set(owned.map((p) => String(p.id)));
            const fa: RosterPlayer[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  name: data.name,
                  team: data.team,
                  position: data.position,
                  injury: data.injury ?? data.status,
                  waiverExpiresAt: data.waiverExpiresAt || data.waiverExpiry,
                } as RosterPlayer;
              })
              .filter((p) => !ownedIds.has(String(p.id)));
            setFreeAgents(fa);
          }
        }
      } catch (err) {
        console.error('Failed to load roster', err);
      }
    };
    load();
  }, [user, activeLeague]);

  const handleClaim = (player: RosterPlayer, isWaiver: boolean) => {
    console.log(isWaiver ? 'Submit waiver claim' : 'Add free agent', player.id);
  };

  return (
    <AppLayout>
      <main className="p-6 space-y-8">
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
              const expiry = p.waiverExpiresAt
                ? new Date(p.waiverExpiresAt)
                : null;
              const underWaiver = expiry ? expiry.getTime() > Date.now() : false;
              return (
                <PlayerCard key={p.id} player={p}>
                  {underWaiver && expiry ? (
                    <WaiverTimer expiry={expiry} />
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

