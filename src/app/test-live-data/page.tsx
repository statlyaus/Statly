

// src/app/test-live-data/page.tsx
import 'server-only';
import { getLegacyLivePlayerStats } from '@/lib/etlIntegration';

// Helpers: normalize optional fields across sources
function getDisposals(p: any): number {
  const d = (p as any)?.disposals;
  if (typeof d === 'number') return d;
  const k = (p as any)?.kicks ?? 0;
  const h = (p as any)?.handballs ?? 0;
  return k + h;
}

function getGoals(p: any): number {
  const g = (p as any)?.goals;
  return typeof g === 'number' ? g : 0;
}

export const revalidate = 0; // always fresh in dev/testing

export default async function TestLiveDataPage() {
  const data = await getLegacyLivePlayerStats();

  return (
    <main className="px-6 py-8">
      <h1 className="text-2xl font-semibold text-white mb-4">Test: Live Player Data</h1>
      <p className="text-slate-400 mb-6">Showing a simple snapshot of live stats via the canonical ETL transform.</p>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-800 text-slate-300">
            <tr>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Fantasy</th>
              <th className="px-3 py-2">Disposals</th>
              <th className="px-3 py-2">Goals</th>
              <th className="px-3 py-2">Last Update</th>
            </tr>
          </thead>
          <tbody>
            {data.map((player) => (
              <tr key={player.id} className="border-t border-slate-700 hover:bg-slate-800/40">
                <td className="px-3 py-2 text-slate-100">{player.name}</td>
                <td className="px-3 py-2 text-slate-300">{player.team}</td>
                <td className="px-3 py-2 text-blue-400 font-medium">{player.fantasyScore}</td>
                <td className="px-3 py-2 text-slate-300">{getDisposals(player)}</td>
                <td className="px-3 py-2 text-green-400">{getGoals(player)}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">
                  {new Date(player.lastUpdated).toLocaleTimeString()}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  No live data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}