// src/app/players/[id]/page.tsx
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
// @ts-ignore
import serviceAccount from '../../../serviceAccountKey.json';
import PlayerSummaryCard from '@/Components/PlayerSummaryCard';

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as any) });
}

const db = getFirestore();

export default async function PlayerPage({ params }: { params: { id: string } }) {
  const doc = await db.collection('players').doc(params.id).get();
  const data = doc.data();

  if (!data) return <div>Player not found</div>;

  const player = {
    id: doc.id,
    name: data.name,
    position: data.position,
    team: data.team,
    avg: data.avg,
    kicks: data.kicks,
    handballs: data.handballs,
    disposals: data.disposals ?? (typeof data.kicks === 'number' && typeof data.handballs === 'number'
      ? data.kicks + data.handballs
      : undefined),
    marks: data.marks,
    tackles: data.tackles,
    goals: data.goals,
    behinds: data.behinds,
    hitouts: data.hitouts,
    freesFor: data.freesFor,
    freesAgainst: data.freesAgainst,
    clearances: data.clearances,
    clangers: data.clangers,
    inside50s: data.inside50s,
    rebound50s: data.rebound50s,
    contestedPossessions: data.contestedPossessions,
    uncontestedPossessions: data.uncontestedPossessions,
    contestedMarks: data.contestedMarks,
    onePercenters: data.onePercenters,
    goalAssists: data.goalAssists,
    isWatched: data.isWatched,
    games: data.games,
    injury: data.injury,
    stats: data.stats,
    summary: data.summary,
    matchLogs: data.matchLogs,
  };

  return (
    <main className="p-4 max-w-5xl mx-auto">
      <PlayerSummaryCard player={player} />

      <section className="mt-6">
        <h2 className="text-xl font-bold border-b pb-1 mb-3">📊 Key Stats</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
          {Object.entries({
            Kicks: player.kicks,
            Handballs: player.handballs,
            Disposals: player.disposals,
            Marks: player.marks,
            Tackles: player.tackles,
            Goals: player.goals,
            Behinds: player.behinds,
            Hitouts: player.hitouts,
            "Frees For": player.freesFor,
            "Frees Against": player.freesAgainst,
            Clearances: player.clearances,
            Clangers: player.clangers,
            "Inside 50s": player.inside50s,
            "Rebound 50s": player.rebound50s,
            "Contested Possessions": player.contestedPossessions,
            "Uncontested Possessions": player.uncontestedPossessions,
            "Contested Marks": player.contestedMarks,
            "One Percenters": player.onePercenters,
            "Goal Assists": player.goalAssists,
          }).map(([label, value]) => (
            <li key={label} className="bg-white shadow p-2 rounded">
              <strong>{label}:</strong> {value ?? '-'}
            </li>
          ))}
        </ul>
      </section>

      {player.stats && (
        <section className="mt-6">
          <h2 className="text-xl font-bold border-b pb-1 mb-2">📈 Advanced Stats</h2>
          <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
            {JSON.stringify(player.stats, null, 2)}
          </pre>
        </section>
      )}

      {player.summary && (
        <section className="mt-6">
          <h2 className="text-xl font-bold border-b pb-1 mb-2">📝 Summary</h2>
          <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
            {JSON.stringify(player.summary, null, 2)}
          </pre>
        </section>
      )}

      {player.matchLogs && (
        <section className="mt-6">
          <h2 className="text-xl font-bold border-b pb-1 mb-2">📅 Match Logs</h2>
          <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
            {JSON.stringify(player.matchLogs, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}