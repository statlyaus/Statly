import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TradeInboxRail from './TradeInboxRail';

describe('TradeInboxRail', () => {
  it('surfaces retract controls for pending outgoing trades', () => {
    const runActionForTrade = vi.fn(() => Promise.resolve());

    render(
      <TradeInboxRail
        loading={false}
        inboxStatusFilter="ALL"
        setInboxStatusFilter={vi.fn()}
        filteredIncomingTrades={[]}
        filteredOutgoingTrades={[
          {
            tradeId: 'trade-1',
            proposerUserId: 'user-1',
            recipientUserId: 'user-2',
            status: 'PROPOSED',
            createdAt: '2026-03-23T00:00:00.000Z',
          },
        ]}
        pendingIncomingCount={0}
        pendingOutgoingCount={1}
        closedTradeCount={0}
        selectedTradeId="trade-1"
        currentUserId="user-1"
        details={{}}
        teamNameByUserId={new Map([['user-2', 'Dockside FC']])}
        setSelectedTradeId={vi.fn()}
        setShowCreate={vi.fn()}
        actionLoading={false}
        actionType={null}
        actionTradeId={null}
        runActionForTrade={runActionForTrade}
      />
    );

    expect(screen.getByText('Awaiting opponent response')).toBeInTheDocument();
    const retractButton = screen.getByRole('button', { name: 'Retract offer' });
    fireEvent.click(retractButton);

    expect(runActionForTrade).toHaveBeenCalledWith('trade-1', 'cancel');
  });

  it('shows viewed prompts for sent offers the recipient has opened', () => {
    render(
      <TradeInboxRail
        loading={false}
        inboxStatusFilter="ALL"
        setInboxStatusFilter={vi.fn()}
        filteredIncomingTrades={[]}
        filteredOutgoingTrades={[
          {
            tradeId: 'trade-1',
            proposerUserId: 'user-1',
            recipientUserId: 'user-2',
            status: 'PROPOSED',
            createdAt: '2026-03-23T09:00:00.000Z',
            latestActivityAt: '2026-03-23T09:00:00.000Z',
            latestActivityEvent: 'TRADE_PROPOSED',
            latestActivityActorUserId: 'user-1',
            recipientViewedAt: '2026-03-23T10:08:00.000Z',
          },
        ]}
        pendingIncomingCount={0}
        pendingOutgoingCount={1}
        closedTradeCount={0}
        selectedTradeId="trade-1"
        currentUserId="user-1"
        details={{}}
        teamNameByUserId={new Map([['user-2', 'Dockside FC']])}
        setSelectedTradeId={vi.fn()}
        setShowCreate={vi.fn()}
        actionLoading={false}
        actionType={null}
        actionTradeId={null}
        runActionForTrade={vi.fn(() => Promise.resolve())}
      />
    );

    expect(screen.getByText(/Viewed by Dockside FC/i)).toBeInTheDocument();
  });
});
