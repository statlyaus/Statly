'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { useAuth } from '@/AuthContext';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import TradeConfirmModal from '@/components/trades/TradeConfirmModal';
import TradeCreatePanel from '@/components/trades/TradeCreatePanel';
import TradeInboxRail from '@/components/trades/TradeInboxRail';
import TradeReviewPanel from '@/components/trades/TradeReviewPanel';
import { useLeagueTrades } from '@/components/trades/useLeagueTrades';

type LeagueTradesClientProps = {
  leagueId: string;
  leagueName?: string;
  preselectedIncomingPlayerId?: string;
  preselectedRecipientUserId?: string;
  embedded?: boolean;
};

export default function LeagueTradesClient({
  leagueId,
  leagueName,
  preselectedIncomingPlayerId,
  preselectedRecipientUserId,
  embedded = false,
}: LeagueTradesClientProps): ReactElement {
  const { user } = useAuth();
  const currentUserId = user?.uid ?? null;
  const [activeTab, setActiveTab] = useState<'offers' | 'create'>('offers');

  const trades = useLeagueTrades({
    leagueId,
    currentUserId,
    preselectedIncomingPlayerId,
    preselectedRecipientUserId,
  });

  useEffect(() => {
    if (trades.showCreate || preselectedIncomingPlayerId || preselectedRecipientUserId) {
      setActiveTab('create');
      return;
    }
    setActiveTab('offers');
  }, [trades.showCreate, preselectedIncomingPlayerId, preselectedRecipientUserId]);

  const openCreateTab = () => {
    setActiveTab('create');
    trades.setShowCreate(true);
  };

  const openOffersTab = () => {
    setActiveTab('offers');
    trades.setShowCreate(false);
  };

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[1700px] space-y-6 px-4 py-8 sm:px-6 lg:px-8'}>
      {embedded ? (
        <LeagueViewHeader
          eyebrow="Trade centre"
          title="Offers, review, and counter flow"
          description={leagueName || 'Manage league trades in one workspace without losing roster context.'}
          chips={[
            { label: activeTab === 'create' ? 'Create mode' : 'Review mode', tone: activeTab === 'create' ? 'accent' : 'neutral' },
            { label: currentUserId ? 'Signed in' : 'Sign in required', tone: currentUserId ? 'success' : 'warning' },
          ]}
          actions={
            <button
              type="button"
              className="rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
              onClick={() => {
                if (activeTab === 'create') {
                  openOffersTab();
                } else {
                  openCreateTab();
                }
              }}
              aria-expanded={activeTab === 'create'}
            >
              {activeTab === 'create' ? 'Back to Offers' : 'Create Trade'}
            </button>
          }
        />
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">League</p>
            <h1 className="text-2xl font-semibold text-gray-900">Trades</h1>
            <p className="text-sm text-gray-500">{leagueName || 'League trading center'}</p>
          </div>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={() => {
              if (activeTab === 'create') {
                openOffersTab();
              } else {
                openCreateTab();
              }
            }}
            aria-expanded={activeTab === 'create'}
          >
            {activeTab === 'create' ? 'Back to Offers' : 'Create Trade'}
          </button>
        </header>
      )}

      {!currentUserId ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Sign in to view and manage trades.
        </div>
      ) : null}

      {trades.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {trades.error}
        </div>
      ) : null}

      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={openOffersTab}
            className={`rounded-[1.1rem] px-4 py-4 text-left transition ${
              activeTab === 'offers'
                ? 'bg-[color:var(--league-primary)] text-white shadow-[0_18px_40px_-28px_rgba(23,34,48,0.35)]'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
            aria-pressed={activeTab === 'offers'}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${activeTab === 'offers' ? 'text-white/60' : 'text-slate-500'}`}>
              Trade Desk
            </p>
            <h2 className="mt-1 text-lg font-semibold">Pending and sent offers</h2>
            <p className={`mt-1 text-sm ${activeTab === 'offers' ? 'text-white/75' : 'text-slate-600'}`}>
              Review incoming proposals, track what you have sent, and respond quickly.
            </p>
          </button>

          <button
            type="button"
            onClick={openCreateTab}
            className={`rounded-[1.1rem] px-4 py-4 text-left transition ${
              activeTab === 'create'
                ? 'bg-[color:var(--league-accent)] text-white shadow-[0_18px_40px_-28px_rgba(127,96,53,0.35)]'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
            aria-pressed={activeTab === 'create'}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${activeTab === 'create' ? 'text-white/65' : 'text-slate-500'}`}>
              Compose
            </p>
            <h2 className="mt-1 text-lg font-semibold">Create trade</h2>
            <p className={`mt-1 text-sm ${activeTab === 'create' ? 'text-white/80' : 'text-slate-600'}`}>
              Build a fresh offer in a dedicated workspace with both rosters side by side.
            </p>
          </button>
        </div>
      </div>

      {activeTab === 'create' ? (
        <div className="space-y-8">
          <div className="rounded-[1.75rem] border border-[color:var(--league-accent-soft)] bg-[linear-gradient(135deg,var(--league-accent-soft),rgba(255,253,250,0.96))] p-5 shadow-[0_24px_70px_-45px_rgba(127,96,53,0.28)] sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--league-border)] pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-accent)]">
                  Compose Mode
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  Build new offer
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  This is the primary workspace. Choose the other manager, compare both rosters,
                  and shape the offer before you return to the inbox.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[color:var(--league-border)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--league-accent)]">
                  Front and centre
                </span>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={openOffersTab}
                >
                  Back to review
                </button>
              </div>
            </div>

            <TradeCreatePanel
              currentUserId={currentUserId}
              createOptionsLoading={trades.createOptionsLoading}
              createSubmitting={trades.createSubmitting}
              recipients={trades.recipients}
              recipientUserId={trades.recipientUserId}
              selectedRecipientName={trades.selectedRecipientName}
              missingRecipient={trades.missingRecipient}
              createStep={trades.createStep}
              allKeys={trades.allKeys}
              visibleKeys={trades.visibleKeys}
              defaultKeys={trades.defaultKeys}
              labels={trades.labels}
              createSuccess={trades.createSuccess}
              counterParentTradeId={trades.counterParentTradeId}
              preselectedIncomingPlayerId={preselectedIncomingPlayerId}
              rosterPlayers={trades.rosterPlayers}
              outgoingIds={trades.outgoingIds}
              incomingIds={trades.incomingIds}
              missingOutgoing={trades.missingOutgoing}
              missingIncoming={trades.missingIncoming}
              recipientRosterPlayers={trades.recipientRosterPlayers}
              recipientRosterLoading={trades.recipientRosterLoading}
              recipientRosterError={trades.recipientRosterError}
              outgoingPlayers={trades.outgoingPlayers}
              incomingPlayers={trades.incomingPlayers}
              createTopGains={trades.createTopGains}
              createTopRisks={trades.createTopRisks}
              createImpact={trades.createImpact}
              createNetImpact={trades.createNetImpact}
              submitDisabled={trades.submitDisabled}
              toggleKey={trades.toggleKey}
              onRecipientChange={(userId) => {
                trades.setRecipientUserId(userId);
                trades.setIncomingIds([]);
                trades.setRecipientRosterPlayers([]);
              }}
              onToggleOutgoing={(playerId) =>
                trades.setOutgoingIds((prev) =>
                  prev.includes(playerId)
                    ? prev.filter((id) => id !== playerId)
                    : [...prev, playerId]
                )
              }
              onToggleIncoming={(playerId) =>
                trades.setIncomingIds((prev) =>
                  prev.includes(playerId)
                    ? prev.filter((id) => id !== playerId)
                    : [...prev, playerId]
                )
              }
              onClearCounter={trades.clearCounter}
              onClearPlayers={() => {
                trades.setOutgoingIds([]);
                trades.setIncomingIds([]);
              }}
              onRequestSubmit={() => {
                if (trades.submitDisabled) return;
                trades.setConfirmCreate(true);
              }}
            />
          </div>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <TradeReviewPanel
              selectedTrade={trades.selectedTrade}
              selectedDetails={trades.selectedDetails}
              detailLoading={trades.detailLoading}
              gives={trades.gives}
              receives={trades.receives}
              currentUserId={currentUserId}
              teamNameByUserId={trades.teamNameByUserId}
              rosterCache={trades.rosterCache}
              visibleKeys={trades.visibleKeys}
              labels={trades.labels}
              reviewNetImpact={trades.reviewNetImpact}
              reviewTopGains={trades.reviewTopGains}
              reviewTopRisks={trades.reviewTopRisks}
              reviewImpactLoading={trades.reviewImpactLoading}
              reviewImpact={trades.reviewImpact}
              acceptEnabled={trades.acceptEnabled}
              declineEnabled={trades.declineEnabled}
              counterEnabled={trades.counterEnabled}
              cancelEnabled={trades.cancelEnabled}
              actionLoading={trades.actionLoading}
              actionType={trades.actionType}
              actionTradeId={trades.actionTradeId}
              runAction={trades.runAction}
              beginCounter={trades.beginCounter}
            />

            <TradeInboxRail
              loading={trades.loading}
              inboxStatusFilter={trades.inboxStatusFilter}
              setInboxStatusFilter={trades.setInboxStatusFilter}
              filteredIncomingTrades={trades.filteredIncomingTrades}
              filteredOutgoingTrades={trades.filteredOutgoingTrades}
              pendingIncomingCount={trades.pendingIncomingCount}
              pendingOutgoingCount={trades.pendingOutgoingCount}
              closedTradeCount={trades.closedTradeCount}
              selectedTradeId={trades.selectedTrade?.tradeId ?? ''}
              currentUserId={currentUserId}
              details={trades.details}
              teamNameByUserId={trades.teamNameByUserId}
              setSelectedTradeId={trades.setSelectedTradeId}
              actionLoading={trades.actionLoading}
              actionType={trades.actionType}
              actionTradeId={trades.actionTradeId}
              runActionForTrade={trades.runActionForTrade}
              setShowCreate={(value) => {
                trades.setShowCreate(value);
                setActiveTab(value ? 'create' : 'offers');
              }}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)]">
          <TradeInboxRail
            loading={trades.loading}
            inboxStatusFilter={trades.inboxStatusFilter}
            setInboxStatusFilter={trades.setInboxStatusFilter}
            filteredIncomingTrades={trades.filteredIncomingTrades}
            filteredOutgoingTrades={trades.filteredOutgoingTrades}
            pendingIncomingCount={trades.pendingIncomingCount}
            pendingOutgoingCount={trades.pendingOutgoingCount}
            closedTradeCount={trades.closedTradeCount}
            selectedTradeId={trades.selectedTrade?.tradeId ?? ''}
            currentUserId={currentUserId}
            details={trades.details}
            teamNameByUserId={trades.teamNameByUserId}
            setSelectedTradeId={trades.setSelectedTradeId}
            actionLoading={trades.actionLoading}
            actionType={trades.actionType}
            actionTradeId={trades.actionTradeId}
            runActionForTrade={trades.runActionForTrade}
            setShowCreate={(value) => {
              trades.setShowCreate(value);
              setActiveTab(value ? 'create' : 'offers');
            }}
          />

          <TradeReviewPanel
            selectedTrade={trades.selectedTrade}
            selectedDetails={trades.selectedDetails}
            detailLoading={trades.detailLoading}
            gives={trades.gives}
            receives={trades.receives}
            currentUserId={currentUserId}
            teamNameByUserId={trades.teamNameByUserId}
            rosterCache={trades.rosterCache}
            visibleKeys={trades.visibleKeys}
            labels={trades.labels}
            reviewNetImpact={trades.reviewNetImpact}
            reviewTopGains={trades.reviewTopGains}
            reviewTopRisks={trades.reviewTopRisks}
            reviewImpactLoading={trades.reviewImpactLoading}
            reviewImpact={trades.reviewImpact}
            acceptEnabled={trades.acceptEnabled}
            declineEnabled={trades.declineEnabled}
            counterEnabled={trades.counterEnabled}
            cancelEnabled={trades.cancelEnabled}
            actionLoading={trades.actionLoading}
            actionType={trades.actionType}
            actionTradeId={trades.actionTradeId}
            runAction={trades.runAction}
            beginCounter={trades.beginCounter}
          />
        </div>
      )}

      <TradeConfirmModal
        open={trades.confirmCreate}
        createSubmitting={trades.createSubmitting}
        createSummary={trades.createSummary}
        createNetImpact={trades.createNetImpact}
        hasVisibleKeys={trades.visibleKeys.length > 0}
        outgoingPlayers={trades.outgoingPlayers}
        incomingPlayers={trades.incomingPlayers}
        onCancel={() => trades.setConfirmCreate(false)}
        onConfirm={async () => {
          trades.setConfirmCreate(false);
          await trades.submitTrade();
        }}
      />
    </div>
  );
}
