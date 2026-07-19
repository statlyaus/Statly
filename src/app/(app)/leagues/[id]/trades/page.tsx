import { AppLayout } from '@/components/navigation';
import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import { LeagueTradeProposalForm } from '@/components/league/LeagueTradeProposalForm';
import { tags } from '@/lib/cacheTags';
import { cookies, headers } from 'next/headers';

export const revalidate = 60;

function formatTimestamp(lastUpdated?: { toMillis?: () => number } | number): string {
  if (typeof lastUpdated === 'number') return new Date(lastUpdated).toLocaleString();
  if (lastUpdated && typeof lastUpdated.toMillis === 'function')
    return new Date(lastUpdated.toMillis()).toLocaleString();
  return '—';
}

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

export default async function LeagueTradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ playerId?: string; ownerMemberId?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  let trades: TradeSummary[] = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const cookieStore = await cookies();
    const headerStore = await headers();
    const relativePath = `/api/trades/list?leagueId=${encodeURIComponent(id)}&pageSize=50`;
    const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? 'localhost:3000';
    const protocol = headerStore.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : undefined) ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
      process.env.APP_BASE_URL ||
      `${protocol}://${host}`;
    const url = new URL(relativePath, baseUrl).toString();
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      next: { tags: [tags.trades(id), tags.league(id)] },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        trades = [];
        return (
          <AppLayout>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <h1 className="text-2xl font-bold mb-4">Trades</h1>
              <LeagueTradeProposalForm
                leagueId={id}
                requestedPlayerId={query.playerId}
                ownerMemberId={query.ownerMemberId}
              />
              <p className="text-gray-600">Sign in to review existing trades.</p>
            </div>
          </AppLayout>
        );
      }
      const body = await res.text().catch(() => undefined);
      const parts = ['Failed trades list', String(res.status), body].filter(Boolean);
      throw new Error(parts.join(' '));
    }
    const json = (await res.json()) as { trades?: TradeSummary[] };
    trades = Array.isArray(json.trades) ? json.trades : [];
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
    console.error('Failed to fetch trades list', {
      leagueId: id,
      error: err instanceof Error ? err.message : String(err),
      timedOut: isAbort,
    });
    trades = [];
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold mb-4">Trades</h1>
        <LeagueTradeProposalForm
          leagueId={id}
          requestedPlayerId={query.playerId}
          ownerMemberId={query.ownerMemberId}
        />
        {trades.length === 0 ? (
          <p className="text-gray-600">No trades found.</p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
            <table className="min-w-full">
              <caption className="sr-only">Recent league trades</caption>
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="text-left text-sm text-gray-700">
                  <th scope="col" className="p-3 border">
                    Trade
                  </th>
                  <th scope="col" className="p-3 border">
                    Status
                  </th>
                  <th scope="col" className="p-3 border">
                    Teams
                  </th>
                  <th scope="col" className="p-3 border">
                    Players
                  </th>
                  <th scope="col" className="p-3 border">
                    Updated
                  </th>
                  <th scope="col" className="p-3 border">
                    Discuss
                  </th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.tradeId} className="text-sm hover:bg-gray-50">
                    <td
                      className="p-3 border"
                      title={t.summary.tradeName || t.tradeId}
                      aria-label={t.summary.tradeName || t.tradeId}
                    >
                      {t.summary.tradeName ||
                        (t.tradeId.length > 8 ? `${t.tradeId.slice(0, 8)}…` : t.tradeId)}
                    </td>
                    <td className="p-3 border">{t.summary.status}</td>
                    <td className="p-3 border">{t.summary.teamCount}</td>
                    <td className="p-3 border">
                      <span className="line-clamp-1" title={t.summary.playerNames.join(', ')}>
                        {t.summary.playerNames.join(', ')}
                      </span>
                    </td>
                    <td className="p-3 border whitespace-nowrap">
                      {formatTimestamp(t.summary.lastUpdated)}
                    </td>
                    <td className="p-3 border">
                      <LeagueSocialDiscussButton
                        leagueId={id}
                        context={{
                          type: 'trade',
                          id: t.tradeId,
                          title: t.summary.tradeName || `Trade ${t.tradeId.slice(0, 8)}`,
                          subtitle: t.summary.playerNames.join(', ').slice(0, 300) || undefined,
                          metadata: {
                            status: t.summary.status,
                            teams: String(t.summary.teamCount),
                          },
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
