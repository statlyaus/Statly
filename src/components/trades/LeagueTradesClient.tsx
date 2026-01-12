'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/AuthContext';
import type { TradeDetails, TradeSummary } from '@/components/trades/tradeApi';
import { actOnTrade, getTrade, listTrades } from '@/components/trades/tradeApi';
import { fetchApi } from '@/lib/api';

type InboxFilter = 'incoming' | 'outgoing' | 'all';

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
  return players
    .map((player) => {
      if (!player || typeof player !== 'object') return null;
      const row = player as Record<string, unknown>;
      const id = String(row.id ?? '');
      const name = String(row.name ?? 'Player');
      if (!id) return null;
      return { id, name };
    })
    .filter((item): item is RosterPlayer => Boolean(item));
}

function readSelectValues(target: HTMLSelectElement): string[] {
  return Array.from(target.selectedOptions).map((opt) => opt.value);
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

function TradeStatusBadge({ status }: { status: TradeStatus }) {
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

export default function LeagueTradesClient({ leagueId }: LeagueTradesClientProps) {
  const { user } = useAuth();
  const currentUserId = user?.uid ?? null;
  const [filter, setFilter] = useState<InboxFilter>('incoming');
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
  const recipientRosterRequestRef = useRef(0);

  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (filter === 'incoming') return trade.recipientUserId === currentUserId;
      if (filter === 'outgoing') return trade.proposerUserId === currentUserId;
      return true;
    });
  }, [filter, trades, currentUserId]);

  const selectedTrade =
    filteredTrades.find((trade) => trade.tradeId === selectedTradeId) ??
    filteredTrades[0] ??
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

  useEffect(() => {
    let mounted = true;
    const fetchTrades = async () => {
      if (!currentUserId) {
        setTrades([]);
        setSelectedTradeId('');
        setDetails({});
        setRecipients([]);
        setRosterPlayers([]);
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
    fetchTrades();
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
    fetchRecipientRoster();
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
      } catch (err) {
        if (!mounted || requestId !== createRequestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load trade options.');
      } finally {
        if (mounted && requestId === createRequestRef.current) setCreateOptionsLoading(false);
      }
    };
    fetchCreateData();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

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
    fetchDetails();
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1.5fr]">
        <section aria-label="Trade inbox">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Inbox</h2>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                {(['incoming', 'outgoing', 'all'] as InboxFilter[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      filter === tab
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setFilter(tab)}
                    aria-pressed={filter === tab}
                  >
                    {tab === 'incoming' ? 'Incoming' : tab === 'outgoing' ? 'Outgoing' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            <ul className="divide-y divide-slate-200">
              {loading ? (
                <li className="px-4 py-6 text-sm text-slate-500">Loading trades…</li>
              ) : filteredTrades.length === 0 ? (
                <li className="px-4 py-6 text-sm text-slate-500">No trades yet.</li>
              ) : (
                filteredTrades.map((trade) => (
                  <li key={trade.tradeId}>
                    <button
                      type="button"
                      onClick={() => setSelectedTradeId(trade.tradeId)}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 ${
                        selectedTrade?.tradeId === trade.tradeId ? 'bg-slate-50' : ''
                      }`}
                      aria-current={selectedTrade?.tradeId === trade.tradeId ? 'true' : undefined}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {trade.tradeId.slice(0, 8)}…
                        </p>
                        <p className="text-xs text-slate-500">
                          {trade.proposerUserId === currentUserId
                            ? 'You proposed'
                            : 'Proposed to you'}
                        </p>
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

        <section aria-label="Trade details" className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Trade Review</h2>
                <p className="text-sm text-slate-500">
                  {selectedTrade ? `Trade ${selectedTrade.tradeId}` : 'Select a trade'}
                </p>
              </div>
              {selectedTrade ? <TradeStatusBadge status={selectedTrade.status} /> : null}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-slate-700">You give</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detailLoading ? (
                    <li className="text-slate-400">Loading players…</li>
                  ) : gives.length === 0 ? (
                    <li className="text-slate-400">No outgoing players.</li>
                  ) : (
                    gives.map((item) => (
                      <li key={item.playerId} className="flex justify-between">
                        <span className="font-medium text-slate-800">{item.playerName}</span>
                        <span className="text-slate-400">{item.playerId}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-slate-700">You receive</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detailLoading ? (
                    <li className="text-slate-400">Loading players…</li>
                  ) : receives.length === 0 ? (
                    <li className="text-slate-400">No incoming players.</li>
                  ) : (
                    receives.map((item) => (
                      <li key={item.playerId} className="flex justify-between">
                        <span className="font-medium text-slate-800">{item.playerName}</span>
                        <span className="text-slate-400">{item.playerId}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
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
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
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
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
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
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
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

          {showCreate && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Create Trade</h2>
              <p className="text-sm text-slate-500">Build an offer and send a proposal.</p>

              <div className="mt-4 grid gap-4">
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
                <label className="text-sm font-semibold text-slate-700">
                  Recipient
                  <select
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
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

                <label className="text-sm font-semibold text-slate-700">
                  Players out
                  <select
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    multiple
                    size={3}
                    value={outgoingIds}
                    onChange={(event) => setOutgoingIds(readSelectValues(event.target))}
                    disabled={!currentUserId || createOptionsLoading || createSubmitting}
                  >
                    {rosterPlayers.length === 0 ? (
                      <option value="" disabled>
                        No roster players loaded
                      </option>
                    ) : (
                      rosterPlayers.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Players in
                  <select
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    multiple
                    size={3}
                    value={incomingIds}
                    onChange={(event) => setIncomingIds(readSelectValues(event.target))}
                    disabled={
                      !currentUserId ||
                      !recipientUserId ||
                      recipientRosterLoading ||
                      createSubmitting
                    }
                  >
                    {recipientRosterLoading ? (
                      <option value="" disabled>
                        Loading roster…
                      </option>
                    ) : recipientRosterPlayers.length === 0 ? (
                      <option value="" disabled>
                        No roster players loaded
                      </option>
                    ) : (
                      recipientRosterPlayers.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))
                    )}
                  </select>
                  {recipientRosterError ? (
                    <p className="mt-2 text-xs font-normal text-rose-600">
                      {recipientRosterError}
                    </p>
                  ) : null}
                </label>

                <button
                  type="button"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
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
          )}
        </section>
      </div>
    </div>
  );
}
