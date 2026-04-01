import type { ReactElement } from 'react';

import { formatStatValue, getDeltaClass } from '@/components/trades/tradeUiUtils';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

import { displayPlayerName, formatPlayerMeta } from './tradePlayerUtils';
import type { RosterPlayer } from './tradeUiTypes';

type LeagueMember = {
  userId: string;
  teamName: string;
};

type TradeCreatePanelProps = {
  currentUserId: string | null;
  createOptionsLoading: boolean;
  createSubmitting: boolean;
  recipients: LeagueMember[];
  recipientUserId: string;
  selectedRecipientName: string | null;
  missingRecipient: boolean;
  createStep: number;
  allKeys: CanonicalStatKey[];
  visibleKeys: CanonicalStatKey[];
  defaultKeys: CanonicalStatKey[];
  labels: Record<string, { label?: string; short?: string }>;
  createSuccess: string | null;
  counterParentTradeId: string | null;
  preselectedIncomingPlayerId?: string;
  rosterPlayers: RosterPlayer[];
  outgoingIds: string[];
  incomingIds: string[];
  missingOutgoing: boolean;
  missingIncoming: boolean;
  recipientRosterPlayers: RosterPlayer[];
  recipientRosterLoading: boolean;
  recipientRosterError: string | null;
  outgoingPlayers: RosterPlayer[];
  incomingPlayers: RosterPlayer[];
  createTopGains: Array<{ key: CanonicalStatKey; delta: number }>;
  createTopRisks: Array<{ key: CanonicalStatKey; delta: number }>;
  createImpact: {
    outTotals: Record<CanonicalStatKey, number>;
    inTotals: Record<CanonicalStatKey, number>;
    deltaTotals: Record<CanonicalStatKey, number>;
  };
  createNetImpact: { net: number; label: string };
  submitDisabled: boolean;
  toggleKey: (key: CanonicalStatKey) => void;
  onRecipientChange: (userId: string) => void;
  onToggleOutgoing: (playerId: string) => void;
  onToggleIncoming: (playerId: string) => void;
  onClearCounter: () => void;
  onClearPlayers: () => void;
  onRequestSubmit: () => void;
};

export default function TradeCreatePanel({
  currentUserId,
  createOptionsLoading,
  createSubmitting,
  recipients,
  recipientUserId,
  selectedRecipientName,
  missingRecipient,
  createStep,
  allKeys,
  visibleKeys,
  defaultKeys,
  labels,
  createSuccess,
  counterParentTradeId,
  preselectedIncomingPlayerId,
  rosterPlayers,
  outgoingIds,
  incomingIds,
  missingOutgoing,
  missingIncoming,
  recipientRosterPlayers,
  recipientRosterLoading,
  recipientRosterError,
  outgoingPlayers,
  incomingPlayers,
  createTopGains,
  createTopRisks,
  createImpact,
  createNetImpact,
  submitDisabled,
  toggleKey,
  onRecipientChange,
  onToggleOutgoing,
  onToggleIncoming,
  onClearCounter,
  onClearPlayers,
  onRequestSubmit,
}: TradeCreatePanelProps): ReactElement {
  return (
    <section aria-label="Create trade" className="min-w-0">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Create Trade</p>
              <h2 className="text-2xl font-semibold text-gray-900">Build a new offer</h2>
              <p className="text-sm text-slate-500">Select a recipient and the players you want to swap.</p>
            </div>
            <label className="text-sm font-semibold text-slate-700">
              Recipient
              <select
                className={`mt-2 w-full min-w-[220px] rounded-md border bg-white px-3 py-1.5 text-sm ${
                  missingRecipient ? 'border-amber-300' : 'border-slate-200'
                }`}
                value={recipientUserId}
                onChange={(event) => {
                  onRecipientChange(event.target.value);
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
              <span className="mt-2 block text-xs text-slate-500">
                {missingRecipient
                  ? 'Pick a manager first to load incoming options.'
                  : `Trading with ${selectedRecipientName ?? 'selected manager'}.`}
              </span>
            </label>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              { step: 1, label: 'Choose opponent' },
              { step: 2, label: 'Select outgoing' },
              { step: 3, label: 'Select incoming' },
            ].map((item) => {
              const isComplete = createStep > item.step;
              const isActive = createStep === item.step;
              return (
                <div
                  key={item.step}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    isComplete
                      ? 'border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
                      : isActive
                        ? 'border-[color:var(--league-accent-soft)] bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]'
                        : 'border-[color:var(--league-border)] bg-white text-[color:var(--league-text-muted)]'
                  }`}
                >
                  <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] ring-1 ring-inset ring-current/20">
                    {item.step}
                  </span>
                  {item.label}
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-7 space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-slate-400">Columns</span>
            <span className="text-xs text-slate-500">League defaults: {defaultKeys.length}</span>
            {allKeys.map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => toggleKey(key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  visibleKeys.includes(key) ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {labels[key]?.short ?? labels[key]?.label ?? key}
              </button>
            ))}
          </div>
          {createSuccess ? (
            <div className="rounded-lg border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] px-3 py-2 text-sm text-[color:var(--league-success)]">
              {createSuccess}
            </div>
          ) : null}
          {counterParentTradeId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span>Counter offer mode</span>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                onClick={onClearCounter}
              >
                Clear counter
              </button>
            </div>
          ) : null}
          {!counterParentTradeId && preselectedIncomingPlayerId ? (
            <div className="rounded-lg border border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)] px-3 py-2 text-sm text-[color:var(--league-primary)]">
              Preselected from player hub.{' '}
              {selectedRecipientName ? `Recipient set to ${selectedRecipientName}. ` : ''}
              Choose your outgoing players and submit.
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Your roster</p>
                  <p className="text-sm font-semibold text-slate-800">Players you send</p>
                </div>
                <span className="text-xs text-slate-500">{outgoingIds.length} selected</span>
              </div>
              <div className="max-h-128 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">Pick</th>
                      <th className="sticky left-12 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">Name</th>
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
                            {(() => {
                              const name = displayPlayerName(player);
                              return (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                  checked={outgoingIds.includes(player.id)}
                                  onChange={() => onToggleOutgoing(player.id)}
                                  disabled={!currentUserId || createSubmitting}
                                  aria-label={`Select ${name}`}
                                />
                              );
                            })()}
                          </td>
                          <td className="sticky left-12 z-10 bg-white px-3 py-3">
                            <div className="font-semibold text-slate-800">{displayPlayerName(player)}</div>
                            <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                              {player.position ? (
                                <span className="rounded-full bg-[color:var(--league-accent-soft)] px-2 py-0.5 font-semibold text-[color:var(--league-accent)]">
                                  {player.position}
                                </span>
                              ) : null}
                              {player.team ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                                  {player.team}
                                </span>
                              ) : null}
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
              <p className={`px-3 py-2 text-xs ${missingOutgoing ? 'text-amber-700' : 'text-slate-500'}`}>
                {missingOutgoing
                  ? 'Select at least one player from your roster.'
                  : `${outgoingIds.length} outgoing player${outgoingIds.length === 1 ? '' : 's'} selected.`}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Their roster</p>
                  <p className="text-sm font-semibold text-slate-800">Players you receive</p>
                </div>
                <span className="text-xs text-slate-500">{incomingIds.length} selected</span>
              </div>
              <div className="max-h-128 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">Pick</th>
                      <th className="sticky left-12 z-20 bg-slate-50 px-3 py-2 text-left font-semibold">Name</th>
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
                            {(() => {
                              const name = displayPlayerName(player);
                              return (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                  checked={incomingIds.includes(player.id)}
                                  onChange={() => onToggleIncoming(player.id)}
                                  disabled={!currentUserId || recipientRosterLoading || createSubmitting}
                                  aria-label={`Select ${name}`}
                                />
                              );
                            })()}
                          </td>
                          <td className="sticky left-12 z-10 bg-white px-3 py-3">
                            <div className="font-semibold text-slate-800">{displayPlayerName(player)}</div>
                            <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                              {player.position ? (
                                <span className="rounded-full bg-[color:var(--league-accent-soft)] px-2 py-0.5 font-semibold text-[color:var(--league-accent)]">
                                  {player.position}
                                </span>
                              ) : null}
                              {player.team ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                                  {player.team}
                                </span>
                              ) : null}
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
                <p className="px-3 py-2 text-xs font-normal text-rose-600">{recipientRosterError}</p>
              ) : null}
              <p className={`px-3 py-2 text-xs ${missingIncoming ? 'text-amber-700' : 'text-slate-500'}`}>
                {missingRecipient
                  ? 'Select a recipient to choose incoming players.'
                  : missingIncoming
                    ? 'Select at least one player to receive.'
                    : `${incomingIds.length} incoming player${incomingIds.length === 1 ? '' : 's'} selected.`}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Trade Impact</p>
              <p className="text-sm font-semibold text-slate-800">You send vs you receive</p>
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
                        <div
                          key={player.id}
                          className="flex min-w-[160px] flex-col rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm"
                        >
                          <span className="text-sm font-semibold text-slate-800">{displayPlayerName(player)}</span>
                          <span className="text-[11px] text-slate-500">{formatPlayerMeta(player)}</span>
                        </div>
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
                        <div
                          key={player.id}
                          className="flex min-w-[160px] flex-col rounded-xl border border-[color:var(--league-accent-soft)] bg-[color:var(--league-accent-soft)] px-3 py-2 shadow-sm"
                        >
                          <span className="text-sm font-semibold text-slate-800">{displayPlayerName(player)}</span>
                          <span className="text-[11px] text-[color:var(--league-accent)]">{formatPlayerMeta(player)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {visibleKeys.length === 0 ? (
                <div className="text-sm text-slate-500">No stat columns selected for this league.</div>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-500">Net impact</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getDeltaClass(createNetImpact.net)}`}
                    >
                      {createNetImpact.label}
                    </span>
                    <span className="text-slate-500">across selected stats</span>
                  </div>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--league-success)]">Top gains</p>
                      <div className="mt-2 space-y-1 text-xs">
                        {createTopGains.length === 0 ? (
                          <p className="text-[color:var(--league-success)]/70">No positive category change.</p>
                        ) : (
                          createTopGains.map((row) => (
                            <div key={row.key} className="flex items-center justify-between">
                              <span className="font-medium text-[color:var(--league-success)]">{labels[row.key]?.label ?? row.key}</span>
                              <span className="font-semibold">+{formatStatValue(row.delta)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-700">Top risks</p>
                      <div className="mt-2 space-y-1 text-xs">
                        {createTopRisks.length === 0 ? (
                          <p className="text-rose-700/70">No negative category change.</p>
                        ) : (
                          createTopRisks.map((row) => (
                            <div key={row.key} className="flex items-center justify-between">
                              <span className="font-medium text-rose-900">{labels[row.key]?.label ?? row.key}</span>
                              <span className="font-semibold">{formatStatValue(row.delta)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Full category table
                    </summary>
                    <div className="mt-3 max-h-64 overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold">Category</th>
                            <th className="px-4 py-2 text-right font-semibold">You send</th>
                            <th className="px-4 py-2 text-right font-semibold">You receive</th>
                            <th
                              className="px-4 py-2 text-right font-semibold"
                              title="Positive = gain, negative = loss. Bigger magnitude is better."
                            >
                              Delta
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleKeys.map((category) => {
                            const delta = createImpact.deltaTotals[category] ?? 0;
                            return (
                              <tr key={category} className="border-t border-slate-100">
                                <td
                                  className="px-4 py-2 text-slate-700"
                                  title={category === 'inside50s' ? 'Inside 50 entries per game' : undefined}
                                >
                                  {labels[category]?.label ?? category}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-600">
                                  {formatStatValue(createImpact.outTotals[category])}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-600">
                                  {formatStatValue(createImpact.inTotals[category])}
                                </td>
                                <td className="px-4 py-2 text-right font-semibold">
                                  <span
                                    className={`inline-flex min-w-[64px] items-center justify-end rounded-full px-2 py-0.5 ${getDeltaClass(
                                      delta
                                    )}`}
                                    title={category === 'inside50s' ? 'Inside 50 entries per game' : 'Higher is better'}
                                  >
                                    {delta > 0 ? '+' : ''}
                                    {formatStatValue(delta)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className={`text-xs ${submitDisabled ? 'text-amber-700' : 'text-slate-500'}`}>
              {missingRecipient
                ? 'Choose a recipient to continue.'
                : missingOutgoing
                  ? 'Add at least one outgoing player.'
                  : missingIncoming
                    ? 'Add at least one incoming player.'
                    : 'Ready to submit this trade.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={onClearPlayers}
                disabled={createSubmitting}
              >
                Clear players
              </button>
              <button
                type="button"
                className="rounded-md bg-[color:var(--league-primary)] px-5 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
                disabled={submitDisabled}
                onClick={onRequestSubmit}
              >
                {createSubmitting ? 'Submitting…' : 'Submit Trade'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
