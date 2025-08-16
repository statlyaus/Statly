// src/components/TradeReview.tsx

"use client";

import React, { useMemo, useState, useEffect, useReducer, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import type { Player } from '@/types/players';

// Helper components & functions (should be moved to a separate file, e.g., src/components/ui/index.ts)
const Pill = ({ tone, children }: { tone?: 'good' | 'bad' | 'neutral', children: React.ReactNode }) => {
    const colors = {
        good: 'bg-green-500/10 text-green-400 ring-green-500/20',
        bad: 'bg-red-500/10 text-red-400 ring-red-500/20',
        neutral: 'bg-gray-500/10 text-gray-400 ring-gray-500/20',
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${colors[tone || 'neutral']}`}>
            {children}
        </span>
    );
};

const StatBadge = ({ label, value }: { label: string, value: string | number }) => (
    <div className="rounded-lg bg-white/5 p-2 text-center ring-1 ring-white/10">
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-sm font-semibold text-white">{value}</div>
    </div>
);

const sum = (items: Player[], key: string) => items.reduce((acc, item) => {
    const value = item.stats?.[key] || item[key as keyof Player] || 0;
    return acc + (Number(value) || 0);
}, 0);
const fmt = (value: number) => (value > 0 ? `+${value}` : value.toString());
const fairnessScore = (outgoing: Player[], incoming: Player[]) => {
    const outScore = sum(outgoing, 'metresGained') + 8 * sum(outgoing, 'clearances');
    const inScore = sum(incoming, 'metresGained') + 8 * sum(incoming, 'clearances');
    const delta = inScore - outScore;
    let tone: 'good' | 'bad' | 'neutral' = 'neutral';
    if (delta > 20) tone = 'good';
    if (delta < -20) tone = 'bad';
    return {
        delta,
        tone,
        label: Math.abs(delta) < 10 ? 'Fair' : delta > 0 ? 'Favorable' : 'Unfavorable',
    };
};

// Extending the Window interface for global firebase app
declare global {
  interface Window {
    _firebaseApp: ReturnType<typeof initializeApp> | undefined;
  }
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export type TradeConstraints = {
  listSpotsAfter?: number | undefined;
};

export interface TradeReviewProps {
  outgoing: Player[];
  incoming: Player[];
  constraints?: TradeConstraints;
  onCancel: () => void;
}

// Trade review engine state type
interface TradeState {
  status: string;
  vetoCount?: number;
  reviewWindowExpiresAt?: number;
  invalidRoster?: boolean;
}

// Reducer for trade review state
interface ReviewState {
  tradeState: TradeState | null;
  auditLog: { timestamp: number; action: string; details?: unknown }[];
  notifications: string[];
  loading: boolean;
  error: string | null;
}

// Defining a more specific type for the API response payload
interface ApiResponsePayload {
  state: TradeState;
  auditLog: { timestamp: number; action: string; details?: unknown }[];
  notifications: string[];
}

type ReviewAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: ApiResponsePayload }
  | { type: 'ACTION_START' }
  | { type: 'ACTION_SUCCESS'; payload: ApiResponsePayload }
  | { type: 'ACTION_FAILURE'; payload: string };

const reviewReducer = (state: ReviewState, action: ReviewAction): ReviewState => {
  switch (action.type) {
    case 'FETCH_START':
    case 'ACTION_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
    case 'ACTION_SUCCESS':
      return {
        ...state,
        loading: false,
        tradeState: action.payload.state,
        auditLog: action.payload.auditLog ?? [],
        notifications: action.payload.notifications ?? [],
        error: null,
      };
    case 'ACTION_FAILURE':
      return { ...state, loading: false, error: action.payload };
    default:
      return state;
  }
};

// All logic, hooks, helpers, and UI inside this function
export default function TradeReview(props: TradeReviewProps) {
  const { outgoing, incoming, constraints, onCancel } = props;
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  // Firebase Auth and role-based controls
  const [_user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  useEffect(() => {
    let firebaseApp: ReturnType<typeof initializeApp> | undefined;
    if (typeof window !== 'undefined') {
      if (!window._firebaseApp) {
        firebaseApp = initializeApp(firebaseConfig);
        window._firebaseApp = firebaseApp;
      } else {
        firebaseApp = window._firebaseApp;
      }
      const auth = getAuth(firebaseApp);
      const unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setIsAdmin(Boolean(u && u.email && u.email.endsWith('admin.com')));
      });
      return () => unsub();
    }
    return undefined;
  }, []);

  // Multi-trade support
  const [tradeId, setTradeId] = useState<string>('current');
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [newTradeName, setNewTradeName] = useState('');

  type TradeSummary = {
    tradeId: string;
    summary: {
      tradeName?: string;
      status: string;
      teamCount: number;
      playerNames: string[];
      lastUpdated: number;
      archived?: boolean;
    };
  };
  const [availableTrades, setAvailableTrades] = useState<TradeSummary[]>([]);

  // Stat calculations
  const mgOut = useMemo(() => sum(outgoing, 'metresGained'), [outgoing]);
  const mgIn = useMemo(() => sum(incoming, 'metresGained'), [incoming]);
  const clrOut = useMemo(() => sum(outgoing, 'clearances'), [outgoing]);
  const clrIn = useMemo(() => sum(incoming, 'clearances'), [incoming]);
  const fairness = useMemo(() => fairnessScore(outgoing, incoming), [outgoing, incoming]);

  // State management with useReducer
  const [reviewState, dispatch] = useReducer(reviewReducer, {
    tradeState: null,
    auditLog: [],
    notifications: [],
    loading: false,
    error: null,
  });
  const { tradeState, auditLog, notifications, loading, error } = reviewState;
  const [overrideStatus, setOverrideStatus] = useState<string>('');

  // Fetch available trades (IDs) and current trade state
  useEffect(() => {
    const fetchAll = async () => {
      dispatch({ type: 'FETCH_START' });
      try {
        const listRes = await fetch('/api/listTrades');
        const listData = await listRes.json();
        setAvailableTrades(listData.trades ?? []);

        const reviewRes = await fetch(`/api/tradeReview?tradeId=${tradeId}`);
        const reviewData = await reviewRes.json();
        dispatch({ type: 'FETCH_SUCCESS', payload: reviewData });
      } catch (_e: unknown) { // Using unknown for better type safety
        dispatch({ type: 'ACTION_FAILURE', payload: 'Failed to fetch trade data.' });
      }
    };
    fetchAll();
    const interval = setInterval(() => {
        fetchAll().catch(console.error);
    }, 3000);
    return () => clearInterval(interval);
  }, [tradeId]);

  // Focus management
  useEffect(() => {
    if (initialFocusRef.current) {
      initialFocusRef.current.focus();
    }
  }, []);

  // Consolidated Trade Action Handler
  const handleTradeAction = async (action: string, bodyData = {}) => {
    dispatch({ type: 'ACTION_START' });
    try {
      const res = await fetch(`/api/tradeReview?tradeId=${tradeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tradeId, ...bodyData }),
      });
      const data: ApiResponsePayload = await res.json();
      if (!res.ok) {
        throw new Error(data.state?.status || 'Something went wrong.');
      }
      dispatch({ type: 'ACTION_SUCCESS', payload: data });
    } catch (error: unknown) {
      console.error('Failed to perform trade action:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      dispatch({ type: 'ACTION_FAILURE', payload: errorMessage });
    }
  };

  // Individual handlers using the consolidated function
  const handleAccept = () => handleTradeAction('accept');
  const handleVeto = () => handleTradeAction('veto');
  const handleProcess = () => handleTradeAction('process');
  const handleAdminOverride = () => {
    if (!overrideStatus) return;
    handleTradeAction('adminOverride', { overrideStatus });
  };
  const handleCreateTrade = async () => {
    const newId = uuidv4();
    await handleTradeAction('process', { tradeId: newId, tradeName: newTradeName });
    setAvailableTrades((prev) => [
      ...prev,
      {
        tradeId: newId,
        summary: {
          tradeName: newTradeName,
          status: 'offered',
          teamCount: 0,
          playerNames: [],
          lastUpdated: Date.now(),
        },
      },
    ]);
    setTradeId(newId);
    setNewTradeName('');
  };
  const handleDeleteTrade = async (id: string) => {
    await handleTradeAction('reset', { tradeId: id });
    setAvailableTrades((prev) => prev.filter((t) => t.tradeId !== id));
    if (tradeId === id) setTradeId('current');
  };

  // Filter trades by search and filters
  const activeTrades = availableTrades.filter(trade => !trade.summary.archived);
  const archivedTrades = availableTrades.filter(trade => !!trade.summary.archived);
  const filteredTrades = activeTrades.filter(trade => {
    const s = search.toLowerCase();
    const nameMatch = (trade.summary.tradeName ?? '').toLowerCase().includes(s);
    const idMatch = trade.tradeId.toLowerCase().includes(s);
    const statusMatch = trade.summary.status.toLowerCase().includes(s);
    const playerMatch = trade.summary.playerNames.join(',').toLowerCase().includes(s);
    const statusDropdownMatch = statusFilter ? trade.summary.status === statusFilter : true;
    let dateDropdownMatch = true;
    if (dateFilter && trade.summary.lastUpdated) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const oneWeekAgo = new Date(today);
      oneWeekAgo.setDate(today.getDate() - 7);
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(today.getMonth() - 1);

      if (dateFilter === 'today') {
        dateDropdownMatch = trade.summary.lastUpdated >= today.getTime();
      } else if (dateFilter === 'week') {
        dateDropdownMatch = trade.summary.lastUpdated >= oneWeekAgo.getTime();
      } else if (dateFilter === 'month') {
        dateDropdownMatch = trade.summary.lastUpdated >= oneMonthAgo.getTime();
      }
    }
    return (
      (nameMatch || idMatch || statusMatch || playerMatch) && statusDropdownMatch && dateDropdownMatch
    );
  });

  // UI rendering
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-gray-900 ring-1 ring-white/10">
        {/* Trade selection UI */}
        <div className="px-5 py-2 border-b border-white/10 flex flex-wrap gap-4 items-center">
          <span className="text-sm text-gray-400">Active Trade:</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search trades..."
            className="rounded bg-white/10 px-2 py-1 text-white w-48"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-white"
          >
            <option value="">All Statuses</option>
            <option value="offered">Offered</option>
            <option value="accepted">Accepted</option>
            <option value="underReview">Under Review</option>
            <option value="processed">Processed</option>
            <option value="vetoed">Vetoed</option>
          </select>
          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-white"
          >
            <option value="">All Dates</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
          <select
            value={tradeId}
            onChange={e => setTradeId(e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-white flex-grow"
          >
            {filteredTrades.map((trade) => (
              <option key={trade.tradeId} value={trade.tradeId}>
                {(trade.summary.tradeName ? trade.summary.tradeName : trade.tradeId.slice(0, 8))}
                {' | ' + trade.summary.status}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newTradeName}
            onChange={e => setNewTradeName(e.target.value)}
            placeholder="New trade name..."
            className="rounded bg-white/10 px-2 py-1 text-white w-36"
          />
          <button
            onClick={handleCreateTrade}
            className="rounded-md bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            disabled={!newTradeName.trim()}
          >
            New Trade
          </button>
          {tradeId !== 'current' && isAdmin && (
            <>
              <button
                onClick={() => handleDeleteTrade(tradeId)}
                className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700"
                aria-label={`Delete trade ${tradeId}`}
              >
                Delete Trade
              </button>
              <button
                onClick={() => handleTradeAction('archive', { tradeId }).then(() => {
                  setAvailableTrades((prev) => prev.map(t => t.tradeId === tradeId ? { ...t, summary: { ...t.summary, archived: true } } : t));
                  setTradeId('current');
                })}
                className="rounded-md bg-gray-600 px-2 py-1 text-white hover:bg-gray-700"
                aria-label={`Archive trade ${tradeId}`}
              >
                Archive Trade
              </button>
            </>
          )}
        </div>

        {/* Trade preview panel */}
        <div className="px-5 py-2 border-b border-white/10">
          {(() => {
            const active = availableTrades.find(t => t.tradeId === tradeId);
            if (!active) return null;
            return (
              <div className="text-xs text-gray-300">
                <span className="font-semibold">Name:</span> {active.summary.tradeName || active.tradeId.slice(0, 8)} |
                <span className="font-semibold">Status:</span> {active.summary.status} |
                <span className="font-semibold">Players:</span> {active.summary.playerNames.join(', ') || 'None'} |
                <span className="font-semibold">Last Updated:</span> {active.summary.lastUpdated ? new Date(active.summary.lastUpdated).toLocaleString() : 'N/A'}
                {active.summary.archived && <span className="ml-2 text-red-400">(Archived)</span>}
              </div>
            );
          })()}
        </div>

        {/* Archived trades section */}
        <div className="px-5 py-2 border-b border-white/10">
          <div className="text-sm text-gray-400 mb-1">Archived Trades:</div>
          <select
            value={tradeId}
            onChange={e => setTradeId(e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-white"
            disabled={archivedTrades.length === 0}
          >
            <option value="">{archivedTrades.length === 0 ? "No archived trades" : "Select an archived trade"}</option>
            {archivedTrades.map((trade) => (
              <option key={trade.tradeId} value={trade.tradeId}>
                {(trade.summary.tradeName ? trade.summary.tradeName : trade.tradeId.slice(0, 8))}
                {' | ' + trade.summary.status}
                {' | ' + trade.summary.playerNames.join(', ')}
              </option>
            ))}
          </select>
        </div>

        {/* Trade review engine state */}
        <div className="px-5 py-2 border-b border-white/10 flex gap-6 items-center">
          <span className="text-sm text-gray-400">Trade Status:</span>
          <span className="font-semibold text-white">{tradeState?.status ?? 'N/A'}</span>
          {typeof tradeState?.vetoCount === 'number' && (
            <span className="text-sm text-gray-400">Vetoes: {tradeState.vetoCount}</span>
          )}
          {tradeState?.reviewWindowExpiresAt && (
            <span className="text-sm text-gray-400">
              Review ends: {new Date(tradeState.reviewWindowExpiresAt).toLocaleString()}
            </span>
          )}
          {tradeState?.invalidRoster && (
            <span className="text-sm text-red-400">Roster Invalid</span>
          )}
        </div>
        {error && (
          <div className="px-5 py-2 text-sm text-red-400 border-b border-white/10">
            Error: {error}
          </div>
        )}

        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Review trade</h2>
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-2 py-1 text-sm text-gray-200 hover:bg-white/20"
            aria-label="Close dialog"
            ref={initialFocusRef}
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_1fr_18rem]">
          {/* Outgoing column */}
          <section aria-label="Trade out" className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Trade out</h3>
            <ul className="space-y-2">
              {outgoing.length === 0 ? (
                <li className="rounded-lg bg-white/5 p-3 text-sm text-gray-400 ring-1 ring-white/10">
                  No players
                </li>
              ) : (
                outgoing.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Pill>MG {Math.round(Number(p.stats?.metresGained ?? 0))}</Pill>
                      <Pill>Clr {Math.round(Number(p.stats?.clearances ?? 0))}</Pill>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Incoming column */}
          <section aria-label="Trade in" className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Trade in</h3>
            <ul className="space-y-2">
              {incoming.length === 0 ? (
                <li className="rounded-lg bg-white/5 p-3 text-sm text-gray-400 ring-1 ring-white/10">
                  No players
                </li>
              ) : (
                incoming.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Pill tone="good">MG {Math.round(Number(p.stats?.metresGained ?? 0))}</Pill>
                      <Pill tone="good">Clr {Math.round(Number(p.stats?.clearances ?? 0))}</Pill>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Summary column */}
          <aside className="space-y-3">
            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-300">Fairness</span>
                <Pill tone={fairness.tone}>{fairness.label}</Pill>
              </div>
              <p className="text-[11px] text-gray-500">
                Heuristic: MG + 8×Clearances • Δ {fairness.delta > 0 ? '+' : ''}
                {Math.round(fairness.delta)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatBadge label="MG Δ" value={fmt(mgIn - mgOut)} />
              <StatBadge label="Clr Δ" value={fmt(clrIn - clrOut)} />
            </div>

            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 text-sm font-medium text-white">Constraints</div>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">List spots (post)</dt>
                  <dd className="tabular-nums">
                    {Number.isFinite(constraints?.listSpotsAfter ?? NaN)
                      ? Math.round(constraints!.listSpotsAfter!)
                      : '–'}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>

        {/* Audit log and notifications */}
        <div className="border-t border-white/10 px-5 py-4">
          <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold text-white mb-2">Audit Log</div>
              <ul className="text-xs text-gray-300 space-y-1 max-h-32 overflow-auto">
                {auditLog.length === 0 ? (
                  <li>No audit log entries</li>
                ) : (
                  auditLog.map((entry, idx) => (
                    <li key={idx}>
                      [{new Date(entry.timestamp).toLocaleString()}] {entry.action}
                      {entry.details ? `: ${JSON.stringify(entry.details)}` : ''}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-white mb-2">Notifications</div>
              <ul className="text-xs text-gray-300 space-y-1 max-h-32 overflow-auto">
                {notifications.length === 0 ? (
                  <li>No notifications</li>
                ) : (
                  notifications.map((note, idx) => <li key={idx}>{note}</li>)
                )}
              </ul>
            </div>
          </div>

          {/* Admin override controls */}
          {isAdmin && (
            <div className="mt-4 flex items-center gap-2">
              <label htmlFor="overrideStatus" className="text-sm text-gray-300">Admin Override Status:</label>
              <select
                id="overrideStatus"
                value={overrideStatus}
                onChange={e => setOverrideStatus(e.target.value)}
                className="rounded bg-white/10 px-2 py-1 text-white"
                disabled={loading}
              >
                <option value="">Select status</option>
                <option value="offered">Offered</option>
                <option value="accepted">Accepted</option>
                <option value="underReview">Under Review</option>
                <option value="processed">Processed</option>
                <option value="vetoed">Vetoed</option>
              </select>
              <button
                onClick={handleAdminOverride}
                className="rounded-md bg-red-600 px-3 py-2 text-white ring-1 ring-white/15 hover:bg-red-700"
                disabled={loading || !overrideStatus}
                aria-label="Override trade status"
              >
                {loading ? 'Overriding...' : 'Override'}
              </button>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-3 py-2 text-white ring-1 ring-white/15 hover:bg-white/20"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            className="rounded-md bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
            disabled={loading || tradeState?.status !== 'offered'}
            aria-label="Accept Trade"
          >
            {loading ? 'Loading...' : 'Accept Trade'}
          </button>
          <button
            onClick={handleVeto}
            className="rounded-md bg-yellow-600 px-4 py-2 font-semibold text-white hover:bg-yellow-700"
            disabled={loading || tradeState?.status !== 'underReview'}
            aria-label="Veto Trade"
          >
            {loading ? 'Loading...' : 'Veto Trade'}
          </button>
          <button
            onClick={handleProcess}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
            disabled={loading || (tradeState?.status !== 'underReview' && tradeState?.status !== 'accepted')}
            aria-label="Process Trade"
          >
            {loading ? 'Loading...' : 'Process Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}