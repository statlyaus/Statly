export const revalidate = 60;
function formatTimestamp(lastUpdated?: { toMillis?: () => number } | number): string {
  if (typeof lastUpdated === 'number') return new Date(lastUpdated).toLocaleString();
  if (lastUpdated && typeof lastUpdated.toMillis === 'function') return new Date(lastUpdated.toMillis()).toLocaleString();
  return '—';
}

import { AppLayout } from '@/components/navigation';
import { tags } from '@/lib/cacheTags';

type TradeSummary = {
  tradeId: string;
  summary: {
    tradeName?: string;
    status: string;
    teamCount: number;
    playerNames: string[];
    lastUpdated?: { toMillis?: () => number } | number;
    archived?: boolean;
  };
};

export default async function LeagueTradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let trades: TradeSummary[] = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`/api/trades/list?leagueId=${encodeURIComponent(id)}&pageSize=50`, {
      next: { tags: [tags.trades(id), tags.league(id)] },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => undefined);
      throw new Error(`Failed trades list ${res.status} ${body ?? ''}`.trim());
    }
    const json = (await res.json()) as { trades?: TradeSummary[] };
    trades = Array.isArray(json.trades) ? json.trades : [];
  } catch (err) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
    console.error('Failed to fetch trades list', { leagueId: id, error: err instanceof Error ? err.message : String(err), timedOut: isAbort });
    trades = [];
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Trades</h1>
        {trades.length === 0 ? (
          <p className="text-gray-600">No trades found.</p>
        ) : (
          <table className="min-w-full border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left text-sm text-gray-700">
                <th className="p-2 border">Trade</th>
                <th className="p-2 border">Status</th>
                <th className="p-2 border">Teams</th>
                <th className="p-2 border">Players</th>
                <th className="p-2 border">Updated</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.tradeId} className="text-sm">
                  <td className="p-2 border">{t.summary.tradeName || t.tradeId.slice(0, 8)}</td>
                  <td className="p-2 border">{t.summary.status}</td>
                  <td className="p-2 border">{t.summary.teamCount}</td>
                  <td className="p-2 border">{t.summary.playerNames.join(', ')}</td>
                  <td className="p-2 border">{formatTimestamp(t.summary.lastUpdated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}


