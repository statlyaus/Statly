'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { useAuth } from '@/AuthContext';
import type { TradeDetails, TradeSummary } from '@/components/trades/tradeApi';
import { actOnTrade, getTrade, listTrades } from '@/components/trades/tradeApi';
import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import { fetchApi } from '@/lib/api';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

type LeagueTradesClientProps = {
  leagueId: string;
};

type LeagueMember = {
  id: string;
  userId: string;
  teamName: string;
};

type RosterPlayer = {
  id: string;
  name: string;
  position?: string;
  team?: string;
  stats?: Record<string, unknown>;
};

function createRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type TradeStatus = TradeSummary['status'];

function normalizeMembers(payload: unknown): LeagueMember[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload as Record<string, unknown>;
  const data = raw.data ?? raw;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const member = item as Record<string, unknown>;
      const id = String(member.id ?? '');
      const userId = String(member.userId ?? '');
      const teamName = String(member.teamName ?? '');
      if (!id || !userId || !teamName) return null;
      return { id, userId, teamName };
    })
    .filter((item): item is LeagueMember => Boolean(item));
}

function normalizeRosterPlayers(payload: unknown): RosterPlayer[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload as Record<string, unknown>;
  const data = raw.data ?? raw;
  const roster = (data as Record<string, unknown>)?.roster;
  const players = (roster as Record<string, unknown>)?.players;
  if (!Array.isArray(players)) return [];
  const normalized: RosterPlayer[] = [];
  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const row = player as Record<string, unknown>;
    const id = String(row.id ?? '');
    if (!id) continue;
    const name = String(row.name ?? 'Player');
    const position = row.position ? String(row.position) : undefined;
    const team = row.team ? String(row.team) : undefined;
    const stats =
      row.stats && typeof row.stats === 'object'
        ? (row.stats as Record<string, unknown>)
        : undefined;
    normalized.push({ id, name, position, team, stats });
  }
  return normalized;
}

type StatsContainer = {
  stats?: Record<string, unknown>;
};

function sumByKeys(players: StatsContainer[], keys: CanonicalStatKey[]): Record<CanonicalStatKey, number> {
  const totals = keys.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<CanonicalStatKey, number>);
  players.forEach((player) => {
    const stats = player.stats ?? {};
    keys.forEach((key) => {
      const value = stats[key];
      const asNumber = Number(value ?? 0);
      totals[key] += Number.isFinite(asNumber) ? asNumber : 0;
    });
  });
  return totals;
}

function computeImpact(
  outPlayers: StatsContainer[],
  inPlayers: StatsContainer[],
  keys: CanonicalStatKey[]
) {
  const outTotals = sumByKeys(outPlayers, keys);
  const inTotals = sumByKeys(inPlayers, keys);
  const deltaTotals = keys.reduce((acc, key) => {
    acc[key] = (inTotals[key] ?? 0) - (outTotals[key] ?? 0);
    return acc;
  }, {} as Record<CanonicalStatKey, number>);
  return { outTotals, inTotals, deltaTotals };
}
function formatStatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
    return Number.isInteger(asNumber) ? String(asNumber) : asNumber.toFixed(1);
  }
  return String(value);
}

function statusTone(status: TradeStatus) {
  switch (status) {
    case 'PROPOSED':
      return 'bg-amber-500/15 text-amber-300 ring-amber-400/30';
    case 'EXECUTED':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30';
    case 'DECLINED':
    case 'CANCELLED':
      return 'bg-rose-500/15 text-rose-300 ring-rose-400/30';
    case 'SUPERSEDED':
    case 'EXPIRED':
      return 'bg-slate-500/15 text-slate-300 ring-slate-400/30';
    default:
      return 'bg-slate-500/15 text-slate-300 ring-slate-400/30';
  }
}

function TradeStatusBadge({ status }: { status: TradeStatus }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(
        status
      )}`}
    >
      {status}
    </span>
  );
}

export default function LeagueTradesClient({ leagueId }: LeagueTradesClientProps): ReactElement {
  const { user } = useAuth();
  const currentUserId = user?.uid ?? null;
  const [selectedTradeId, setSelectedTradeId] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [details, setDetails] = useState<Record<string, TradeDetails>>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOptionsLoading, setCreateOptionsLoading] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const createRequestRef = useRef(0);

  const [recipients, setRecipients] = useState<LeagueMember[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([]);
  const [recipientRosterPlayers, setRecipientRosterPlayers] = useState<RosterPlayer[]>([]);
  const [recipientUserId, setRecipientUserId] = useState('');
  const [outgoingIds, setOutgoingIds] = useState<string[]>([]);
  const [incomingIds, setIncomingIds] = useState<string[]>([]);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [counterParentTradeId, setCounterParentTradeId] = useState<string | null>(null);
  const [recipientRosterLoading, setRecipientRosterLoading] = useState(false);
  const [recipientRosterError, setRecipientRosterError] = useState<string | null>(null);
  const [rosterCache, setRosterCache] = useState<Record<string, RosterPlayer[]>>({});
  const [impactLoadingUsers, setImpactLoadingUsers] = useState<Record<string, boolean>>({});
  const recipientRosterRequestRef = useRef(0);
  const {
    visibleKeys,
    allKeys,
    toggleKey,
    defaultKeys,
    labels,
  } = useLeagueStatColumns(leagueId);

  const incomingTrades = useMemo(
    () => trades.filter((trade) => trade.recipientUserId === currentUserId),
    [trades, currentUserId]
  );

  const outgoingTrades = useMemo(
    () => trades.filter((trade) => trade.proposerUserId === currentUserId),
    [trades, currentUserId]
  );

  const selectedTrade =
    trades.find((trade) => trade.tradeId === selectedTradeId) ??
    incomingTrades[0] ??
    outgoingTrades[0] ??
    null;
  const selectedDetails = selectedTrade ? details[selectedTrade.tradeId] : null;

  const gives = selectedDetails
    ? selectedDetails.items.filter((item) => item.fromUserId === currentUserId)
    : [];
  const receives = selectedDetails
    ? selectedDetails.items.filter((item) => item.toUserId === currentUserId)
    : [];

  const isProposer = selectedTrade?.proposerUserId === currentUserId;
  const isRecipient = selectedTrade?.recipientUserId === currentUserId;
  const isPending = selectedTrade?.status === 'PROPOSED';

  const acceptEnabled = Boolean(isRecipient && isPending);
  const declineEnabled = Boolean(isRecipient && isPending);
  const cancelEnabled = Boolean(isProposer && isPending);
  const counterEnabled = Boolean(isRecipient && isPending);

  const outgoingPlayers = rosterPlayers.filter((player) => outgoingIds.includes(player.id));
  const incomingPlayers = recipientRosterPlayers.filter((player) => incomingIds.includes(player.id));
  const createImpact = computeImpact(outgoingPlayers, incomingPlayers, visibleKeys);

  const reviewRosterForProposer = selectedTrade?.proposerUserId
    ? rosterCache[selectedTrade.proposerUserId]
    : undefined;
  const reviewRosterForRecipient = selectedTrade?.recipientUserId
    ? rosterCache[selectedTrade.recipientUserId]
    : undefined;
  const reviewOutPlayers = gives
    .map((item) =>
      reviewRosterForProposer?.find((player) => player.id === item.playerId)
    )
    .filter((player): player is RosterPlayer => Boolean(player));
  const reviewInPlayers = receives
    .map((item) =>
      reviewRosterForRecipient?.find((player) => player.id === item.playerId)
    )
    .filter((player): player is RosterPlayer => Boolean(player));
  const reviewImpact = computeImpact(reviewOutPlayers, reviewInPlayers, visibleKeys);
  const reviewImpactLoading = Boolean(
    selectedTrade &&
      (impactLoadingUsers[selectedTrade.proposerUserId] ||
        impactLoadingUsers[selectedTrade.recipientUserId])
  );

  useEffect(() => {
    let mounted = true;
    const fetchTrades = async () => {
      if (!currentUserId) {
        setTrades([]);
        setSelectedTradeId('');
        setDetails({});
        setRecipients([]);
        setRosterPlayers([]);
        setRosterCache({});
        setImpactLoadingUsers({});
        setRecipientUserId('');
        setOutgoingIds([]);
        setIncomingIds([]);
        setRecipientRosterPlayers([]);
        setRecipientRosterLoading(false);
        setRecipientRosterError(null);
        setCreateOptionsLoading(false);
        setCreateSubmitting(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const requestId = ++listRequestRef.current;
      try {
        const list = await listTrades(leagueId);
        if (!mounted || requestId !== listRequestRef.current) return;
        setTrades(list);
        setSelectedTradeId((prev) => prev || list[0]?.tradeId || '');
      } catch (err) {
        if (!mounted || requestId !== listRequestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load trades.');
      } finally {
        if (mounted && requestId === listRequestRef.current) setLoading(false);
      }
    };
    void fetchTrades();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  useEffect(() => {
    let mounted = true;
    const fetchRecipientRoster = async () => {
      if (!recipientUserId) {
        setRecipientRosterPlayers([]);
        setRecipientRosterLoading(false);
        setRecipientRosterError(null);
        return;
      }
      setRecipientRosterLoading(true);
      setRecipientRosterError(null);
      const requestId = ++recipientRosterRequestRef.current;
      try {
        const rosterResponse = await fetchApi(
          `leagues/${leagueId}/roster/${recipientUserId}`
        );
        if (!mounted || requestId !== recipientRosterRequestRef.current) return;
        const roster = normalizeRosterPlayers(rosterResponse);
        setRecipientRosterPlayers(roster);
        setRosterCache((prev) => ({ ...prev, [recipientUserId]: roster }));
      } catch (err) {
        if (!mounted || requestId !== recipientRosterRequestRef.current) return;
        setRecipientRosterError(
          err instanceof Error ? err.message : 'Failed to load recipient roster.'
        );
      } finally {
        if (mounted && requestId === recipientRosterRequestRef.current) {
          setRecipientRosterLoading(false);
        }
      }
    };
    void fetchRecipientRoster();
    return () => {
      mounted = false;
    };
  }, [leagueId, recipientUserId]);

  useEffect(() => {
    if (!createSuccess) return;
    const timer = setTimeout(() => {
      setCreateSuccess(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [createSuccess]);

  useEffect(() => {
    setCreateSuccess(null);
  }, [recipientUserId, outgoingIds, incomingIds]);

  useEffect(() => {
    let mounted = true;
    const fetchCreateData = async () => {
      if (!currentUserId) return;
      setCreateOptionsLoading(true);
      const requestId = ++createRequestRef.current;
      try {
        const [membersResponse, rosterResponse] = await Promise.all([
          fetchApi(`leagues/${leagueId}/members`),
          fetchApi(`leagues/${leagueId}/roster/${currentUserId}`),
        ]);
        if (!mounted || requestId !== createRequestRef.current) return;
        const members = normalizeMembers(membersResponse);
        const roster = normalizeRosterPlayers(rosterResponse);
        setRecipients(members.filter((m) => m.userId !== currentUserId));
        setRosterPlayers(roster);
        setRosterCache((prev) => ({ ...prev, [currentUserId]: roster }));
      } catch (err) {
        if (!mounted || requestId !== createRequestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load trade options.');
      } finally {
        if (mounted && requestId === createRequestRef.current) setCreateOptionsLoading(false);
      }
    };
    void fetchCreateData();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  useEffect(() => {
    let active = true;
    const ensureRoster = async (userId: string) => {
      if (!userId || rosterCache[userId]) return;
      setImpactLoadingUsers((prev) => ({ ...prev, [userId]: true }));
      try {
        const response = await fetchApi(`leagues/${leagueId}/roster/${userId}`);
        if (!active) return;
        const roster = normalizeRosterPlayers(response);
        setRosterCache((prev) => ({ ...prev, [userId]: roster }));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load roster for impact.');
      } finally {
        if (active) {
          setImpactLoadingUsers((prev) => ({ ...prev, [userId]: false }));
        }
      }
    };
    if (selectedTrade) {
      void ensureRoster(selectedTrade.proposerUserId);
      void ensureRoster(selectedTrade.recipientUserId);
    }
    return () => {
      active = false;
    };
  }, [leagueId, selectedTrade, rosterCache]);

  useEffect(() => {
    let mounted = true;
    const fetchDetails = async () => {
      if (!selectedTrade) return;
      if (details[selectedTrade.tradeId]) return;
      setDetailLoading(true);
      const requestId = ++detailRequestRef.current;
      try {
        const trade = await getTrade(selectedTrade.tradeId);
        if (!trade || !mounted || requestId !== detailRequestRef.current) return;
        setDetails((prev) => ({ ...prev, [selectedTrade.tradeId]: trade }));
      } catch (err) {
        if (!mounted || requestId !== detailRequestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load trade details.');
      } finally {
        if (mounted && requestId === detailRequestRef.current) setDetailLoading(false);
      }
    };
    void fetchDetails();
    return () => {
      mounted = false;
    };
  }, [selectedTrade, details]);

  const refreshTrade = async (tradeId: string) => {
    try {
      const trade = await getTrade(tradeId);
      if (!trade) return;
      setDetails((prev) => ({ ...prev, [tradeId]: trade }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh trade.');
    }
  };

  const runAction = async (action: 'accept' | 'decline' | 'cancel') => {
    if (!selectedTrade) return;
    setActionLoading(true);
    setError(null);
    try {
      const requestId = createRequestId();
      await actOnTrade(selectedTrade.tradeId, action, requestId);
      await refreshTrade(selectedTrade.tradeId);
      const list = await listTrades(leagueId);
      setTrades(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade action failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitTrade = async () => {
    if (!currentUserId) return;
    setError(null);
    if (!recipientUserId) {
      setError('Select a recipient.');
      return;
    }
    if (outgoingIds.length === 0) {
      setError('Select at least one outgoing player.');
      return;
    }
    if (incomingIds.length === 0) {
      setError('Select at least one incoming player.');
      return;
    }
    const combined = [...outgoingIds, ...incomingIds];
    const unique = new Set(combined);
    if (unique.size !== combined.length) {
      setError('Players cannot be selected in both lists.');
      return;
    }
    setCreateSubmitting(true);
    try {
      const items = [
        ...outgoingIds.map((playerId) => ({
          fromUserId: currentUserId,
          toUserId: recipientUserId,
          playerId,
        })),
        ...incomingIds.map((playerId) => ({
          fromUserId: recipientUserId,
          toUserId: currentUserId,
          playerId,
        })),
      ];
      const requestId = createRequestId();
      const response = await fetchApi('trades', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          leagueId,
          recipientUserId,
          parentTradeId: counterParentTradeId,
          items,
        }),
      });
      const tradeId = (response as { data?: { tradeId?: string } })?.data?.tradeId;
      const list = await listTrades(leagueId);
      setTrades(list);
      const nextSelected = tradeId || list[0]?.tradeId || '';
      setSelectedTradeId(nextSelected);
      if (tradeId) {
        const newTrade = await getTrade(tradeId);
        if (newTrade) {
          setDetails((prev) => ({ ...prev, [tradeId]: newTrade }));
        }
      }
      setOutgoingIds([]);
      setIncomingIds([]);
      setRecipientUserId('');
      setCounterParentTradeId(null);
      setCreateSuccess('Trade proposed.');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit trade.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const beginCounter = async () => {
    if (!selectedTrade || !currentUserId) return;
    setShowCreate(true);
    setCreateSuccess(null);
    setCounterParentTradeId(selectedTrade.tradeId);
    setRecipientUserId(selectedTrade.proposerUserId);
    setRecipientRosterPlayers([]);
    setDetailLoading(true);
    try {
      const trade = selectedDetails ?? (await getTrade(selectedTrade.tradeId));
      if (!trade) {
        setError('Failed to load trade details for counter.');
        return;
      }
      setDetails((prev) => ({ ...prev, [selectedTrade.tradeId]: trade }));
      setOutgoingIds(
        trade.items
          .filter((item) => item.fromUserId === currentUserId)
          .map((item) => item.playerId)
      );
      setIncomingIds(
        trade.items
          .filter((item) => item.toUserId === currentUserId)
          .map((item) => item.playerId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trade details for counter.');
    } finally {
      setDetailLoading(false);
    }
  };

  const clearCounter = () => {
    setCounterParentTradeId(null);
    setRecipientUserId('');
    setOutgoingIds([]);
    setIncomingIds([]);
    setRecipientRosterPlayers([]);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">League</p>
          <h1 className="text-2xl font-semibold text-gray-900">Trades Inbox</h1>
          <p className="text-sm text-gray-500">League ID: {leagueId}</p>
        </div>
        <button
          type="button"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          onClick={() => setShowCreate((v) => !v)}
          aria-expanded={showCreate}
        >
          {showCreate ? 'Close Create Panel' : 'Create Trade'}
        </button>
      </header>

      {!currentUserId ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Sign in to view and manage trades.
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-8 space-y-8">
        <section aria-label="Trade review">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-linear-to-r from-slate-50 via-white to-slate-50 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Trade Review</p>
                  <h2 className="text-2xl font-semibold text-gray-900">Review &amp; respond</h2>
                  <p className="text-sm text-slate-500">
                    {selectedTrade ? `Trade ${selectedTrade.tradeId}` : 'Select a trade below'}
                  </p>
                </div>
                {selectedTrade ? <TradeStatusBadge status={selectedTrade.status} /> : null}
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                    You give
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm">
                    {detailLoading ? (
                      <li className="text-slate-400">Loading players…</li>
                    ) : gives.length === 0 ? (
                      <li className="text-slate-400">No outgoing players.</li>
                    ) : (
                      gives.map((item) => (
                        <li
                          key={item.playerId}
                          className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm"
                        >
                          <span className="font-semibold text-slate-800">{item.playerName}</span>
                          <span className="text-xs text-slate-400">{item.playerId}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                    You receive
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm">
                    {detailLoading ? (
                      <li className="text-slate-400">Loading players…</li>
                    ) : receives.length === 0 ? (
                      <li className="text-slate-400">No incoming players.</li>
                    ) : (
                      receives.map((item) => (
                        <li
                          key={item.playerId}
                          className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm"
                        >
                          <span className="font-semibold text-slate-800">{item.playerName}</span>
                          <span className="text-xs text-slate-400">{item.playerId}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Trade Impact
                    </p>
                    <p className="text-sm font-semibold text-slate-800">
                      Category deltas for your roster
                    </p>
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  {reviewImpactLoading ? (
                    <div className="px-4 py-4 text-sm text-slate-500">Loading impact…</div>
                  ) : visibleKeys.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-slate-500">
                      No stat columns selected for this league.
                    </div>
                  ) : (
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">Category</th>
                          <th className="px-4 py-2 text-right font-semibold">You send</th>
                          <th className="px-4 py-2 text-right font-semibold">You receive</th>
                          <th className="px-4 py-2 text-right font-semibold">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleKeys.map((category) => {
                          const delta = reviewImpact.deltaTotals[category] ?? 0;
                          const deltaTone =
                            delta > 0
                              ? 'text-emerald-600'
                              : delta < 0
                              ? 'text-rose-600'
                              : 'text-slate-500';
                          return (
                            <tr key={category} className="border-t border-slate-100">
                              <td className="px-4 py-2 text-slate-700">
                                {labels[category]?.label ?? category}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-600">
                                {formatStatValue(reviewImpact.outTotals[category])}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-600">
                                {formatStatValue(reviewImpact.inTotals[category])}
                              </td>
                              <td className={`px-4 py-2 text-right font-semibold ${deltaTone}`}>
                                {delta > 0 ? '+' : ''}
                                {formatStatValue(delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${
                    acceptEnabled
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                  disabled={!acceptEnabled || actionLoading}
                  onClick={() => runAction('accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${
                    declineEnabled
                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                  disabled={!declineEnabled || actionLoading}
                  onClick={() => runAction('decline')}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${
                    counterEnabled
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                  disabled={!counterEnabled || actionLoading}
                  onClick={beginCounter}
                >
                  Counter
                </button>
                <button
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${
                    cancelEnabled
                      ? 'border border-slate-400 text-slate-700 hover:bg-slate-100'
                      : 'border border-slate-200 text-slate-300'
                  }`}
                  disabled={!cancelEnabled || actionLoading}
                  onClick={() => runAction('cancel')}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>

        {showCreate && (
          <section aria-label="Create trade">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Create Trade</p>
                    <h2 className="text-2xl font-semibold text-gray-900">Build a new offer</h2>
                    <p className="text-sm text-slate-500">
                      Select a recipient and the players you want to swap.
                    </p>
                  </div>
                  <label className="text-sm font-semibold text-slate-700">
                    Recipient
                    <select
                      className="mt-2 w-full min-w-[220px] rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm"
                      value={recipientUserId}
                      onChange={(event) => {
                        setRecipientUserId(event.target.value);
                        setIncomingIds([]);
                        setRecipientRosterPlayers([]);
                      }}
                      disabled={!currentUserId || createOptionsLoading || createSubmitting}
                    >
                      <option value="" disabled>
                        Select recipient
                      </option>
                      {recipients.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.teamName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

                <div className="px-6 py-6 space-y-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-slate-400">
                      Columns
                    </span>
                    <span className="text-xs text-slate-500">League defaults: {defaultKeys.length}</span>
                    {allKeys.map((key) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => toggleKey(key)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          visibleKeys.includes(key)
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {labels[key]?.short ?? labels[key]?.label ?? key}
                      </button>
                    ))}
                  </div>
                {createSuccess ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {createSuccess}
                  </div>
                ) : null}
                {counterParentTradeId ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span>Countering Trade {counterParentTradeId.slice(0, 8)}…</span>
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      onClick={clearCounter}
                    >
                      Clear counter
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                            Your roster
                          </p>
                          <p className="text-sm font-semibold text-slate-800">Players you send</p>
                        </div>
                        <span className="text-xs text-slate-500">
                          {outgoingIds.length} selected
                        </span>
                      </div>
                      <div className="max-h-112 overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">
                                Pick
                              </th>
                              <th className="sticky left-12 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">
                                Player
                              </th>
                              {visibleKeys.map((category) => (
                                <th key={category} className="px-3 py-2 text-right font-semibold">
                                  {labels[category]?.label ?? category}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {createOptionsLoading ? (
                              <tr>
                                <td colSpan={2 + visibleKeys.length} className="px-3 py-4">
                                  <span className="text-slate-400">Loading roster…</span>
                                </td>
                              </tr>
                            ) : rosterPlayers.length === 0 ? (
                              <tr>
                                <td colSpan={2 + visibleKeys.length} className="px-3 py-4">
                                  <span className="text-slate-400">No roster players loaded.</span>
                                </td>
                              </tr>
                            ) : (
                              rosterPlayers.map((player) => (
                                <tr key={player.id} className="border-t border-slate-100">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-3">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                      checked={outgoingIds.includes(player.id)}
                                      onChange={() =>
                                        setOutgoingIds((prev) =>
                                          prev.includes(player.id)
                                            ? prev.filter((id) => id !== player.id)
                                            : [...prev, player.id]
                                        )
                                      }
                                      disabled={!currentUserId || createSubmitting}
                                      aria-label={`Select ${player.name}`}
                                    />
                                  </td>
                                  <td className="sticky left-12 z-10 bg-white px-3 py-3">
                                    <div className="font-semibold text-slate-800">{player.name}</div>
                                    <div className="text-xs text-slate-400">
                                      {player.team ?? 'Team'} · {player.position ?? 'Pos'}
                                    </div>
                                  </td>
                                  {visibleKeys.map((category) => (
                                    <td key={category} className="px-3 py-3 text-right text-slate-600">
                                      {formatStatValue(player.stats?.[category])}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                            Their roster
                          </p>
                          <p className="text-sm font-semibold text-slate-800">
                            Players you receive
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">
                          {incomingIds.length} selected
                        </span>
                      </div>
                      <div className="max-h-112 overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">
                                Pick
                              </th>
                              <th className="sticky left-12 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">
                                Player
                              </th>
                              {visibleKeys.map((category) => (
                                <th key={category} className="px-3 py-2 text-right font-semibold">
                                  {labels[category]?.label ?? category}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {!recipientUserId ? (
                              <tr>
                                <td colSpan={2 + visibleKeys.length} className="px-3 py-4">
                                  <span className="text-slate-400">Select a recipient first.</span>
                                </td>
                              </tr>
                            ) : recipientRosterLoading ? (
                              <tr>
                                <td colSpan={2 + visibleKeys.length} className="px-3 py-4">
                                  <span className="text-slate-400">Loading roster…</span>
                                </td>
                              </tr>
                            ) : recipientRosterPlayers.length === 0 ? (
                              <tr>
                                <td colSpan={2 + visibleKeys.length} className="px-3 py-4">
                                  <span className="text-slate-400">No roster players loaded.</span>
                                </td>
                              </tr>
                            ) : (
                              recipientRosterPlayers.map((player) => (
                                <tr key={player.id} className="border-t border-slate-100">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-3">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                      checked={incomingIds.includes(player.id)}
                                      onChange={() =>
                                        setIncomingIds((prev) =>
                                          prev.includes(player.id)
                                            ? prev.filter((id) => id !== player.id)
                                            : [...prev, player.id]
                                        )
                                      }
                                      disabled={
                                        !currentUserId || recipientRosterLoading || createSubmitting
                                      }
                                      aria-label={`Select ${player.name}`}
                                    />
                                  </td>
                                  <td className="sticky left-12 z-10 bg-white px-3 py-3">
                                    <div className="font-semibold text-slate-800">{player.name}</div>
                                    <div className="text-xs text-slate-400">
                                      {player.team ?? 'Team'} · {player.position ?? 'Pos'}
                                    </div>
                                  </td>
                                  {visibleKeys.map((category) => (
                                    <td key={category} className="px-3 py-3 text-right text-slate-600">
                                      {formatStatValue(player.stats?.[category])}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                      {recipientRosterError ? (
                        <p className="px-3 py-2 text-xs font-normal text-rose-600">
                          {recipientRosterError}
                        </p>
                      ) : null}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Trade Impact
                    </p>
                    <p className="text-sm font-semibold text-slate-800">
                      You send vs you receive
                    </p>
                  </div>
                  <div className="px-4 py-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase text-slate-500">You send</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {outgoingPlayers.length === 0 ? (
                            <span className="text-xs text-slate-400">No players selected.</span>
                          ) : (
                            outgoingPlayers.map((player) => (
                              <span
                                key={player.id}
                                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                              >
                                {player.name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase text-slate-500">You receive</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {incomingPlayers.length === 0 ? (
                            <span className="text-xs text-slate-400">No players selected.</span>
                          ) : (
                            incomingPlayers.map((player) => (
                              <span
                                key={player.id}
                                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                              >
                                {player.name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {visibleKeys.length === 0 ? (
                      <div className="text-sm text-slate-500">
                        No stat columns selected for this league.
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="px-4 py-2 text-left font-semibold">Category</th>
                              <th className="px-4 py-2 text-right font-semibold">You send</th>
                              <th className="px-4 py-2 text-right font-semibold">You receive</th>
                              <th className="px-4 py-2 text-right font-semibold">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleKeys.map((category) => {
                              const delta = createImpact.deltaTotals[category] ?? 0;
                              const deltaTone =
                                delta > 0
                                  ? 'text-emerald-600'
                                  : delta < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-500';
                              return (
                                <tr key={category} className="border-t border-slate-100">
                                  <td className="px-4 py-2 text-slate-700">
                                    {labels[category]?.label ?? category}
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-600">
                                    {formatStatValue(createImpact.outTotals[category])}
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-600">
                                    {formatStatValue(createImpact.inTotals[category])}
                                  </td>
                                  <td className={`px-4 py-2 text-right font-semibold ${deltaTone}`}>
                                    {delta > 0 ? '+' : ''}
                                    {formatStatValue(delta)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">
                    Select at least one player from each side to submit.
                  </p>
                  <button
                    type="button"
                    className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
                    disabled={
                      !currentUserId ||
                      !recipientUserId ||
                      outgoingIds.length === 0 ||
                      incomingIds.length === 0 ||
                      createOptionsLoading ||
                      createSubmitting ||
                      detailLoading
                    }
                    onClick={submitTrade}
                  >
                    {createSubmitting ? 'Submitting…' : 'Submit Trade'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        <section aria-label="Trade inbox" className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Incoming</p>
                <h3 className="text-base font-semibold text-slate-900">
                  Offers to review
                </h3>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {incomingTrades.length} trades
              </span>
            </div>

            <ul className="max-h-[520px] divide-y divide-slate-200 overflow-auto">
              {loading ? (
                <li className="px-4 py-8 text-sm text-slate-500">Loading trades…</li>
              ) : incomingTrades.length === 0 ? (
                <li className="px-4 py-8 text-sm text-slate-500">No incoming trades.</li>
              ) : (
                incomingTrades.map((trade) => (
                  <li key={trade.tradeId}>
                    <button
                      type="button"
                      onClick={() => setSelectedTradeId(trade.tradeId)}
                      className={`flex w-full items-center justify-between px-4 py-4 text-left hover:bg-slate-50 ${
                        selectedTrade?.tradeId === trade.tradeId ? 'bg-slate-50' : ''
                      }`}
                      aria-current={selectedTrade?.tradeId === trade.tradeId ? 'true' : undefined}
                    >
                      <div>
                        <p className="text-base font-semibold text-slate-900">
                          {trade.tradeId.slice(0, 8)}…
                        </p>
                        <p className="text-xs text-slate-500">Proposed to you</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <TradeStatusBadge status={trade.status} />
                        <span className="text-xs text-slate-400">
                          {new Date(trade.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Outgoing</p>
                <h3 className="text-base font-semibold text-slate-900">
                  Trades you proposed
                </h3>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {outgoingTrades.length} trades
              </span>
            </div>

            <ul className="max-h-[520px] divide-y divide-slate-200 overflow-auto">
              {loading ? (
                <li className="px-4 py-8 text-sm text-slate-500">Loading trades…</li>
              ) : outgoingTrades.length === 0 ? (
                <li className="px-4 py-8 text-sm text-slate-500">No outgoing trades.</li>
              ) : (
                outgoingTrades.map((trade) => (
                  <li key={trade.tradeId}>
                    <button
                      type="button"
                      onClick={() => setSelectedTradeId(trade.tradeId)}
                      className={`flex w-full items-center justify-between px-4 py-4 text-left hover:bg-slate-50 ${
                        selectedTrade?.tradeId === trade.tradeId ? 'bg-slate-50' : ''
                      }`}
                      aria-current={selectedTrade?.tradeId === trade.tradeId ? 'true' : undefined}
                    >
                      <div>
                        <p className="text-base font-semibold text-slate-900">
                          {trade.tradeId.slice(0, 8)}…
                        </p>
                        <p className="text-xs text-slate-500">You proposed</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <TradeStatusBadge status={trade.status} />
                        <span className="text-xs text-slate-400">
                          {new Date(trade.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
