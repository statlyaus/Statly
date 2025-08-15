'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Player } from '@/types/players';

/* ----------------------------- types ----------------------------- */

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

/* --------------------------- stat helpers ------------------------ */

type StatKey = keyof NonNullable<Player['stats']>;
const MG: StatKey = 'metresGained';
const CLR: StatKey = 'clearances';

const sum = (arr: Player[], k: StatKey) => arr.reduce((t, p) => t + Number(p.stats?.[k] ?? 0), 0);

function fmt(n: number | undefined): string {
  if (!Number.isFinite(n ?? NaN)) return '–';
  const v = Math.round(n as number);
  return v >= 0 ? `+${v}` : `${v}`;
}

function fairnessScore(outgoing: Player[], incoming: Player[]) {
  // same heuristic (MG + 8 × CLR)
  const score = (list: Player[]) =>
    list.reduce(
      (t, p) => t + Number(p.stats?.metresGained ?? 0) + 8 * Number(p.stats?.clearances ?? 0),
      0
    );
  const outS = score(outgoing);
  const inS = score(incoming);
  const delta = inS - outS;

  const label = delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
  const tone: Tone = delta > 30 ? 'good' : delta < -30 ? 'bad' : 'neutral';

  return { delta, label, tone };
}

/* --------------------------- small UI bits ----------------------- */

type Tone = 'neutral' | 'good' | 'bad';

interface PillProps {
  children: React.ReactNode;
  tone?: Tone;
}

const Pill: React.FC<PillProps> = ({ children, tone = 'neutral' }) => {
  const map: Record<Tone, string> = {
    neutral: 'bg-white/10 text-gray-200 ring-white/20',
    good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
};

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

/* ------------------------------- UI ------------------------------ */

export default function TradeReview({
  outgoing,
  incoming,
  constraints,
  onCancel,
}: TradeReviewProps) {
  // Multi-trade support
  const [tradeId, setTradeId] = useState<string>('current');
  const [search, setSearch] = useState<string>('');
  type TradeSummary = {
    tradeId: string;
    summary: {
      tradeName?: string;
      status: string;
      teamCount: number;
      playerNames: string[];
      lastUpdated: number;
    };
  };
  const [availableTrades, setAvailableTrades] = useState<TradeSummary[]>([]);
  const mgOut = useMemo(() => sum(outgoing, MG), [outgoing]);
  const mgIn = useMemo(() => sum(incoming, MG), [incoming]);
  const clrOut = useMemo(() => sum(outgoing, CLR), [outgoing]);
  const clrIn = useMemo(() => sum(incoming, CLR), [incoming]);

  const fairness = useMemo(() => fairnessScore(outgoing, incoming), [outgoing, incoming]);

  // Trade review engine state
  const [tradeState, setTradeState] = useState<TradeState | null>(null);
  type AuditLogEntry = { timestamp: number; action: string; details?: unknown };
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<string>('');

  // Fetch available trades (IDs) and current trade state
  useEffect(() => {
    // List all trades with summaries from Firestore
    fetch('/api/listTrades')
      .then((res) => res.json())
      .then((data) => {
        setAvailableTrades(data.trades ?? []);
      });
    // Fetch current trade state
    fetch(`/api/tradeReview?tradeId=${tradeId}`)
      .then((res) => res.json())
      .then((data) => {
        setTradeState(data.state);
        setAuditLog(data.auditLog ?? []);
        setNotifications(data.notifications ?? []);
      });
  }, [tradeId]);

  // Filter trades by search
  const filteredTrades = availableTrades.filter(trade => {
    const s = search.toLowerCase();
    return (
      trade.tradeId.toLowerCase().includes(s) ||
      trade.summary.status.toLowerCase().includes(s) ||
      trade.summary.playerNames.join(',').toLowerCase().includes(s)
    );
  });

  // Trade actions
  const handleAccept = async () => {
    setLoading(true);
    const res = await fetch(`/api/tradeReview?tradeId=${tradeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', tradeId }),
    });
    const data = await res.json();
    setTradeState(data.state);
    setAuditLog(data.auditLog ?? []);
    setNotifications(data.notifications ?? []);
    setLoading(false);
  };

  const handleVeto = async () => {
    setLoading(true);
    const res = await fetch(`/api/tradeReview?tradeId=${tradeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'veto', tradeId }),
    });
    const data = await res.json();
    setTradeState(data.state);
    setAuditLog(data.auditLog ?? []);
    setNotifications(data.notifications ?? []);
    setLoading(false);
  };

  const handleProcess = async () => {
    setLoading(true);
    const res = await fetch(`/api/tradeReview?tradeId=${tradeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process', tradeId }),
    });
    const data = await res.json();
    setTradeState(data.state);
    setAuditLog(data.auditLog ?? []);
    setNotifications(data.notifications ?? []);
    setLoading(false);
  };

  const handleAdminOverride = async () => {
    if (!overrideStatus) return;
    setLoading(true);
    const res = await fetch(`/api/tradeReview?tradeId=${tradeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'adminOverride', overrideStatus, tradeId }),
    });
    const data = await res.json();
    setTradeState(data.state);
    setAuditLog(data.auditLog ?? []);
    setNotifications(data.notifications ?? []);
    setLoading(false);
  };

  // Trade selection and creation UI
  const [newTradeName, setNewTradeName] = useState('');
  const handleCreateTrade = async () => {
    const newId = uuidv4();
    // Create trade in backend with name
    await fetch(`/api/tradeReview?tradeId=${newId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process', tradeId: newId, tradeName: newTradeName }),
    });
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
    await fetch(`/api/tradeReview?tradeId=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', tradeId: id }),
    });
    setAvailableTrades((prev) => prev.filter((t) => t.tradeId !== id));
    if (tradeId === id) setTradeId('current');
  };

  // UI rendering
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-gray-900 ring-1 ring-white/10">
        {/* Trade selection UI */}
        <div className="px-5 py-2 border-b border-white/10 flex gap-6 items-center">
          <span className="text-sm text-gray-400">Active Trade:</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, status, player..."
            className="rounded bg-white/10 px-2 py-1 text-white w-48"
          />
          <select
            value={tradeId}
            onChange={e => setTradeId(e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-white"
          >
            {filteredTrades.map((trade) => (
              <option key={trade.tradeId} value={trade.tradeId}>
                {(trade.summary.tradeName ? trade.summary.tradeName : trade.tradeId.slice(0, 8))}
                {' | ' + trade.summary.status}
                {' | ' + trade.summary.playerNames.join(', ')}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newTradeName}
            onChange={e => setNewTradeName(e.target.value)}
            placeholder="Trade name..."
            className="rounded bg-white/10 px-2 py-1 text-white w-36"
          />
          <button
            onClick={handleCreateTrade}
            className="rounded-md bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            disabled={!newTradeName.trim()}
          >
            New Trade
          </button>
          {tradeId !== 'current' && (
            <button
              onClick={() => handleDeleteTrade(tradeId)}
              className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700"
            >
              Delete Trade
            </button>
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
              </div>
            );
          })()}
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
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Review trade</h2>
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-2 py-1 text-sm text-gray-200 hover:bg-white/20"
            aria-label="Close"
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
            >
              Override
            </button>
          </div>
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
          >
            Accept Trade
          </button>
          <button
            onClick={handleVeto}
            className="rounded-md bg-yellow-600 px-4 py-2 font-semibold text-white hover:bg-yellow-700"
            disabled={loading || tradeState?.status !== 'underReview'}
          >
            Veto Trade
          </button>
          <button
            onClick={handleProcess}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
            disabled={loading || (tradeState?.status !== 'underReview' && tradeState?.status !== 'accepted')}
          >
            Process Trade
          </button>
        </div>
      </div>
    </div>
  );
}
