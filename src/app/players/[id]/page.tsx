// src/app/players/[id]/page.tsx
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
// @ts-ignore
import serviceAccount from '../../../serviceAccountKey.json';
import PlayerSummaryCard from '@/components/PlayerSummaryCard';

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as any) });
}

const db = getFirestore();

export default async function PlayerPage({ params }: { params: { id: string } }) {
    const doc = await db.collection('players').doc(params.id).get();
    const data = doc.data();

    if (!data) return <div>Player not found</div>;

    // Construct Player object with required and extra stats
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
        <main className="p-4">
            <PlayerSummaryCard player={player} />

            <section className="mt-4">
                <h2 className="text-lg font-semibold mb-2">Key Stats</h2>
                <ul className="grid grid-cols-2 gap-2">
                    <li>Kicks: {player.kicks ?? '-'}</li>
                    <li>Handballs: {player.handballs ?? '-'}</li>
                    <li>Disposals: {player.disposals ?? '-'}</li>
                    <li>Marks: {player.marks ?? '-'}</li>
                    <li>Tackles: {player.tackles ?? '-'}</li>
                    <li>Goals: {player.goals ?? '-'}</li>
                    <li>Behinds: {player.behinds ?? '-'}</li>
                    <li>Hitouts: {player.hitouts ?? '-'}</li>
                    <li>Frees For: {player.freesFor ?? '-'}</li>
                    <li>Frees Against: {player.freesAgainst ?? '-'}</li>
                    <li>Clearances: {player.clearances ?? '-'}</li>
                    <li>Clangers: {player.clangers ?? '-'}</li>
                    <li>Inside 50s: {player.inside50s ?? '-'}</li>
                    <li>Rebound 50s: {player.rebound50s ?? '-'}</li>
                    <li>Contested Possessions: {player.contestedPossessions ?? '-'}</li>
                    <li>Uncontested Possessions: {player.uncontestedPossessions ?? '-'}</li>
                    <li>Contested Marks: {player.contestedMarks ?? '-'}</li>
                    <li>One Percenters: {player.onePercenters ?? '-'}</li>
                    <li>Goal Assists: {player.goalAssists ?? '-'}</li>
                </ul>
            </section>

            {player.stats && (
                <section className="mt-4">
                    <h2 className="text-lg font-semibold mb-2">Stats</h2>
                    <pre className="bg-gray-100 p-2 rounded">{JSON.stringify(player.stats, null, 2)}</pre>
                </section>
            )}
            {player.summary && (
                <section className="mt-4">
                    <h2 className="text-lg font-semibold mb-2">Summary</h2>
                    <pre className="bg-gray-100 p-2 rounded">{JSON.stringify(player.summary, null, 2)}</pre>
                </section>
            )}
            {player.matchLogs && (
                <section className="mt-4">
                    <h2 className="text-lg font-semibold mb-2">Match Logs</h2>
                    <pre className="bg-gray-100 p-2 rounded">{JSON.stringify(player.matchLogs, null, 2)}</pre>
                </section>
            )}
        </main>
    );
}
